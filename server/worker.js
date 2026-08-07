// Serverless proxy (Cloudflare Worker style; adaptable to Vercel/Lambda).
//
// Holds the J-Quants V2 API key, fetches each constituent's daily *adjusted* price
// series once, and returns the JSON the frontend expects:
//   { "1D": { asOf, constituents:[{code,name,nameEn,sector,changePct,weight,contribution}] }, ... }
// Encoding: area ∝ weight (price weight = paf×close / Σ), height ∝ changePct, so a
// bar's volume (area × height) ≈ contribution (the name's index-point impact).
//
// Why per-constituent series (not per-date market snapshots): J-Quants' adjustment
// close is only guaranteed self-consistent WITHIN one code's requested range. Two
// independently-fetched date snapshots can straddle a corporate-action ex-date and
// land on different adjustment bases — which produced a spurious −33.95% "1D" for
// ANA (9202) when its prev-day snapshot stayed on the old basis. Fetching one
// continuous adjusted series per name (like the US worker) makes latest vs. base
// share a single basis, so splits/consolidations never leak into the % change.
//
// J-Quants V2 (https://jpx-jquants.com) uses API-KEY auth (x-api-key header; no
// token exchange, no expiry) and is END-OF-DAY (daily) data, not intraday. So
// "1D" = latest close vs the previous close; longer periods compare the latest
// close with the close at the start of the period. Data freshness depends on your
// J-Quants plan.
//
// Subrequests: one range fetch per constituent (~225), issued with bounded
// concurrency. That is above Cloudflare's free-plan 50-subrequest cap, so this
// worker expects the Workers Paid (Bundled) plan (1000/req). Results are cached
// for 10 minutes, so only a cold refresh pays the full fetch cost.
//
// Secret (wrangler secret put JQUANTS_API_KEY): the V2 API key from the dashboard
//   https://jpx-jquants.com/dashboard/api-keys
// Var (wrangler.toml [vars]): ALLOW_ORIGIN (default '*')
//
// Frontend: js/data-source.js → CONFIG.endpoint = '<worker-url>'

import PARAMS from './index-params.json' with { type: 'json' }; // bundled by Wrangler/esbuild

const JQ = 'https://api.jquants.com/v2';
const BARS = `${JQ}/equities/bars/daily`;
const PERIODS = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y'];
const PAYLOAD_TTL = 600;      // seconds; EOD data changes at most daily
const RANGE_DAYS = 420;       // ~1y + buffer so the 1Y/YTD base is always covered
const FETCH_CONCURRENCY = 12; // parallel per-code range fetches

let _payload = { data: null, exp: 0 };

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      const now = Date.now();
      if (!_payload.data || now > _payload.exp) {
        _payload = { data: await buildAllPeriods(env), exp: now + PAYLOAD_TTL * 1000 };
      }
      return new Response(JSON.stringify(_payload.data), {
        headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${PAYLOAD_TTL}` },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String((err && err.message) || err) }), {
        status: 502, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
      });
    }
  },
};

// ---- CORS -------------------------------------------------------------------
// ALLOW_ORIGIN is a comma-separated allowlist (or '*'). The matching request
// Origin is echoed back so multiple sites (prod + localhost dev) work, while any
// other site's browser JS is blocked. Public read-only data, so this just limits
// who can hotlink the endpoint from a browser.
function corsHeaders(request, env) {
  const allow = (env.ALLOW_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const h = { 'access-control-allow-methods': 'GET, OPTIONS' };
  if (allow.includes('*')) {
    h['access-control-allow-origin'] = '*';
  } else {
    h['vary'] = 'Origin';
    h['access-control-allow-origin'] = allow.includes(origin) ? origin : allow[0] || 'null';
  }
  return h;
}

// ---- assemble all periods ---------------------------------------------------
async function buildAllPeriods(env) {
  const key = env.JQUANTS_API_KEY;
  if (!key) throw new Error('Set JQUANTS_API_KEY (V2 API key from the J-Quants dashboard).');
  const todayJst = new Date(Date.now() + 9 * 3600 * 1000); // JST calendar date via UTC getters
  const from = fmt(addDays(todayJst, -RANGE_DAYS));
  const to = fmt(todayJst);

  const codes = PARAMS.constituents.map((c) => c.code);
  const seriesByCode = await fetchAllSeries(codes, from, to, key);

  const ok = codes.filter((c) => seriesByCode.get(c)?.length).length;
  if (!ok) throw new Error('No J-Quants series returned (check API key / plan freshness).');
  if (ok < Math.ceil(codes.length * 0.5)) {
    throw new Error(`J-Quants returned too few series (${ok}/${codes.length}) — rate limited?`);
  }

  const out = shapeAllPeriods(seriesByCode);
  out.TIMELINE = buildTimeline(seriesByCode);
  return out;
}

// ---- weight% + 寄与度 math --------------------------------------------------
// Price weight (area): each name's share of the price-weighted index =
// paf × close / Σ(paf × close), as a percent. A snapshot from the latest closes,
// so it is period-independent (the treemap footprint holds still across 1D…1Y).
// Exported for unit tests.
function weightSnapshot(seriesByCode) {
  let total = 0;
  for (const c of PARAMS.constituents) {
    const s = seriesByCode.get(c.code);
    if (s?.length) total += (c.paf ?? 1) * lastClose(s);
  }
  const map = new Map();
  for (const c of PARAMS.constituents) {
    const s = seriesByCode.get(c.code);
    map.set(c.code, (s?.length && total > 0) ? (((c.paf ?? 1) * lastClose(s)) / total) * 100 : 0);
  }
  return map;
}

// Pure: build all 7 periods from the fetched per-code series. Exported for tests.
function shapeAllPeriods(seriesByCode) {
  // latest trading date = the most recent timestamp across all series.
  let latest = null;
  for (const s of seriesByCode.values()) {
    if (s && s.length) { const t = s[s.length - 1].t; if (!latest || t > latest) latest = t; }
  }
  if (!latest) throw new Error('no dated closes');

  const weightByCode = weightSnapshot(seriesByCode); // shared footprint (area) for every period
  const baseDates = periodBaseDates(latest);
  const out = {};
  for (const p of PERIODS) {
    out[p] = shapePeriod(seriesByCode, { p, baseDate: baseDates[p], latest, weightByCode });
  }
  return out;
}

// close/base come from the SAME adjusted series, so split adjustment can't leak in.
// contribution over the period ≈ PAF × (close − base) / current-divisor (index
// points) ≈ the bar's volume (area × height). Exported for unit tests.
function shapePeriod(seriesByCode, { p, baseDate, latest, weightByCode }) {
  const divisor = PARAMS.divisor;
  const constituents = PARAMS.constituents.map((c) => {
    const w = round2(weightByCode?.get(c.code) ?? 0);
    const s = seriesByCode.get(c.code);
    const zero = { code: c.code, name: c.name, nameEn: c.nameEn, sector: c.sector, changePct: 0, weight: w, contribution: 0 };
    if (!s || !s.length) return zero;
    const close = lastClose(s);
    const base = p === '1D' ? prevClose(s) : closeOnOrBefore(s, baseDate);
    if (close == null || base == null || !base) return zero;
    const diff = close - base;
    return {
      code: c.code, name: c.name, nameEn: c.nameEn, sector: c.sector,
      changePct: round2((diff / base) * 100),
      weight: w,
      contribution: round2(((c.paf ?? 1) * diff) / divisor),
    };
  });
  // asOf = the latest trading date the data reflects (JST), not the fetch time.
  return { asOf: fmtDash(latest), constituents };
}

// ---- timeline: last N trading days (daily change) with a FIXED footprint -----
// The area (weight%) is pinned to each name's fixed price-weight (paf × latest
// close, normalized) so the treemap holds still while height/color (that day's
// change%) animate. Pure over the already-fetched series. Exported for unit tests.
const TIMELINE_DAYS = 5;
function longestSeries(seriesByCode) {
  let best = null;
  for (const s of seriesByCode.values()) if (s && (!best || s.length > best.length)) best = s;
  return best;
}
function buildTimeline(seriesByCode, n = TIMELINE_DAYS) {
  const ref = longestSeries(seriesByCode);
  if (!ref || ref.length < 2) return { frames: [] };
  const weightByCode = weightSnapshot(seriesByCode); // FIXED footprint → stable layout
  const dates = ref.slice(-(n + 1)).map((p) => p.t);  // ascending, up to n+1 sessions
  const frames = [];
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1];
    const constituents = PARAMS.constituents.map((c) => {
      const s = seriesByCode.get(c.code);
      const weight = round2(weightByCode.get(c.code) ?? 0);
      const close = s && s.length ? closeOnOrBefore(s, d) : null;
      const base = s && s.length ? closeOnOrBefore(s, prev) : null;
      const changePct = (close != null && base) ? ((close - base) / base) * 100 : 0;
      return { code: c.code, name: c.name, nameEn: c.nameEn, sector: c.sector, changePct: round2(changePct), weight };
    });
    frames.push({ asOf: fmtDash(d), constituents });
  }
  return { frames };
}

// ---- J-Quants V2: one code's adjusted daily series over [from,to] ------------
// Returns a sorted-ascending array of { t: Date, c: adjClose }, or null on error.
// One code's range is internally adjustment-consistent (the whole point of the
// per-code refactor). Uses AdjC (adjustment close) when present.
async function fetchSeries(code, from, to, key) {
  const out = [];
  let pkey = null;
  do {
    const url = `${BARS}?code=${encodeURIComponent(code)}&from=${from}&to=${to}`
      + (pkey ? `&pagination_key=${encodeURIComponent(pkey)}` : '');
    const r = await fetch(url, { headers: { 'x-api-key': key, accept: 'application/json' } });
    if (!r.ok) return out.length ? finishSeries(out) : null;
    const j = await r.json();
    for (const q of firstArray(j)) {
      const t = pickDate(q);
      const price = pickPrice(q);
      if (t && price != null) out.push({ t, c: price });
    }
    pkey = j.pagination_key || j.paginationKey || null;
  } while (pkey);
  return finishSeries(out);
}
function finishSeries(out) {
  out.sort((a, b) => a.t - b.t);
  return out;
}

// Fetch every constituent's series with bounded concurrency. Missing/failed codes
// map to null (rendered as 0% change / 0 weight). Exported piece: none (I/O).
async function fetchAllSeries(codes, from, to, key) {
  const map = new Map();
  let i = 0;
  async function worker() {
    while (i < codes.length) {
      const code = codes[i++];
      try { map.set(code, await fetchSeries(code, from, to, key)); }
      catch { map.set(code, null); }
    }
  }
  const n = Math.min(FETCH_CONCURRENCY, codes.length);
  await Promise.all(Array.from({ length: n }, worker));
  return map;
}

// V2 field names are abbreviated (AdjC = adjustment close); be tolerant.
function pickPrice(q) {
  for (const k of ['AdjC', 'AdjustmentClose', 'Cl', 'Close', 'close', 'adjustmentClose']) {
    if (q[k] != null) return Number(q[k]);
  }
  return null;
}
// Row date (YYYY-MM-DD). Parsed as UTC midnight so comparisons with the UTC-based
// period base dates line up.
function pickDate(q) {
  for (const k of ['Date', 'date', 'Dt', 'TradeDate', 'tradeDate']) {
    if (q[k]) { const d = new Date(q[k]); if (!Number.isNaN(d.getTime())) return d; }
  }
  return null;
}
function firstArray(j) {
  if (Array.isArray(j)) return j;
  for (const k of ['daily_quotes', 'bars', 'data', 'quotes']) if (Array.isArray(j[k])) return j[k];
  for (const v of Object.values(j)) if (Array.isArray(v)) return v;
  return [];
}

// ---- series helpers ---------------------------------------------------------
function lastClose(s) { return s.length ? s[s.length - 1].c : null; }
function prevClose(s) { return s.length >= 2 ? s[s.length - 2].c : (s.length ? s[0].c : null); }
function closeOnOrBefore(s, target) {
  let val = null;
  for (const pt of s) { if (pt.t <= target) val = pt.c; else break; }
  return val ?? (s.length ? s[0].c : null);
}

// ---- date helpers (UTC getters on a JST-shifted Date) -----------------------
function periodBaseDates(latest) {
  const y = latest.getUTCFullYear();
  return {
    '1D': addDays(latest, -1),
    '1W': addDays(latest, -7),
    '1M': addMonths(latest, -1),
    '3M': addMonths(latest, -3),
    '6M': addMonths(latest, -6),
    'YTD': new Date(Date.UTC(y - 1, 11, 31)),
    '1Y': addMonths(latest, -12),
  };
}
function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
function addMonths(d, n) { const x = new Date(d.getTime()); x.setUTCMonth(x.getUTCMonth() + n); return x; }
function fmt(d) { // YYYYMMDD (V2 date param format)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
function fmtDash(d) { // YYYY-MM-DD (display)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
const round2 = (x) => Math.round(x * 100) / 100;

// exported for unit tests (ignored by the Worker runtime)
export const _internals = { shapeAllPeriods, shapePeriod, buildTimeline, weightSnapshot, periodBaseDates, closeOnOrBefore, prevClose, lastClose, addMonths, addDays, fmt, pickPrice, pickDate, firstArray, corsHeaders };
