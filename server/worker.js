// Serverless proxy (Cloudflare Worker style; adaptable to Vercel/Lambda).
//
// Holds the J-Quants V2 API key, fetches daily price bars per period, computes
// weight% + 寄与度 from index params, and returns the JSON the frontend expects:
//   { "1D": { asOf, constituents:[{code,name,nameEn,sector,changePct,weight,contribution}] }, ... }
// Encoding: area ∝ weight (price weight = paf×close / Σ), height ∝ changePct, so a
// bar's volume (area × height) ≈ contribution (the name's index-point impact).
//
// Fetch strategy (free-plan friendly): one market snapshot per needed date
// (bars/daily?date=YYYYMMDD returns every stock), memoized so each date is fetched
// once. ~14 dates × pagination stays under Cloudflare's free-plan 50-subrequest
// cap. (Fetching one 1y series per constituent — ~225 subrequests — would need the
// Workers Paid plan; this design deliberately avoids that.)
//
// Split / adjustment safety WITHOUT a continuous series: each snapshot carries both
// the adjusted close (AdjC) and the raw close (Close). Two independently-fetched
// date snapshots can straddle a corporate-action ex-date and disagree — a genuine
// split moves the RAW close, while a stale adjustment close moves the ADJUSTED one
// (this produced ANA's spurious 1D −33.95%). reconcileChange() compares both: on
// normal days they agree (trust adjusted); when they diverge, the true economic
// move is the smaller-magnitude one, so splits and adjustment glitches both cancel.
//
// J-Quants V2 (https://jpx-jquants.com) uses API-KEY auth (x-api-key header; no
// token exchange, no expiry) and is END-OF-DAY (daily) data, not intraday. So
// "1D" = latest close vs the previous close; longer periods compare the latest
// close with the close at the start of the period. Data freshness depends on your
// J-Quants plan.
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
const PAYLOAD_TTL = 600; // seconds; EOD data changes at most daily
// When adjusted vs raw % change disagree by more than this many percentage points,
// a split or an adjustment-close glitch is in play → reconcile (see reconcileChange).
const DIVERGE_TOL = 5;

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
  const cache = new Map(); // dateStr -> Map<code4,{a,r}> so each date is fetched once

  const latest = await quotesOnOrBefore(todayJst, key, cache);
  if (!latest.map.size) throw new Error('No J-Quants quotes returned (check API key / plan freshness).');

  const baseDates = periodBaseDates(latest.date);
  const out = {};
  for (const p of PERIODS) {
    const base = await quotesOnOrBefore(baseDates[p], key, cache);
    out[p] = shapePeriod(latest.map, base.map, latest.date);
  }
  out.TIMELINE = await buildTimeline(latest, key, cache);
  return out;
}

// ---- timeline: last N trading days (daily change) with a FIXED footprint -----
// Walks back from the latest trading date collecting N+1 daily snapshots, then
// shapes N frames whose area (weight%) is pinned to each name's fixed footprint
// (paf × latest close, normalized) so the treemap holds still while height/color
// (that day's change%) animate. Reuses the memoized daily-bars fetch.
const TIMELINE_DAYS = 5;
async function buildTimeline(latest, key, cache, n = TIMELINE_DAYS) {
  const days = [latest];
  let cursor = addDays(latest.date, -1);
  for (let guard = 0; days.length < n + 1 && guard < 20; guard++) {
    const q = await quotesOnOrBefore(cursor, key, cache);
    if (!q.map.size) break;
    days.push(q);
    cursor = addDays(q.date, -1);
  }
  days.reverse(); // ascending (oldest → newest); newest === latest
  return shapeTimeline(days, latest.map);
}

// Pure: N+1 ascending { date, map } snapshots + the latest-close map → N frames.
// Exported for unit tests.
function shapeTimeline(days, latestMap) {
  if (!days || days.length < 2) return { frames: [] };
  const wmap = weightMapFromLatest(latestMap); // FIXED footprint → weight% (area)
  const frames = [];
  for (let i = 1; i < days.length; i++) {
    const cur = days[i].map, prev = days[i - 1].map;
    const constituents = PARAMS.constituents.map((c) => {
      const c4 = code4(c.code);
      const rec = reconcileChange(cur.get(c4), prev.get(c4));
      return { code: c.code, name: c.name, nameEn: c.nameEn, sector: c.sector, changePct: round2(rec ? rec.pct : 0), weight: round2(wmap.get(c.code) ?? 0) };
    });
    frames.push({ asOf: fmtDash(days[i].date), constituents });
  }
  return { frames };
}

// ---- weight% + 寄与度 math --------------------------------------------------
// Price weight (area): each name's share of the price-weighted index =
// paf × close / Σ(paf × close), as a percent. A snapshot from the latest closes
// (adjusted, or raw if adjusted is absent), so it is period-independent (the
// treemap footprint holds still across 1D…1Y). Exported for unit tests.
function weightMapFromLatest(latestMap) {
  const px = (v) => (v ? (v.a ?? v.r) : null);
  let total = 0;
  for (const c of PARAMS.constituents) {
    const v = px(latestMap.get(code4(c.code)));
    if (v != null) total += (c.paf ?? 1) * v;
  }
  const map = new Map();
  for (const c of PARAMS.constituents) {
    const v = px(latestMap.get(code4(c.code)));
    map.set(c.code, (v != null && total > 0) ? (((c.paf ?? 1) * v) / total) * 100 : 0);
  }
  return map;
}

// (cur - base)/base as a percent + the raw diff, or null when either side missing.
function ratioOf(cur, base) {
  return (cur != null && base != null && base !== 0) ? { pct: ((cur - base) / base) * 100, diff: cur - base } : null;
}
// Reconcile adjusted (AdjC) vs raw (Close) % change so neither a split nor a stale
// adjustment close leaks into the number. Normal days: both agree → trust adjusted.
// When they diverge past DIVERGE_TOL, the real economic move is the smaller-
// magnitude one — a split inflates only the raw move; an adjustment glitch inflates
// only the adjusted move. Returns { pct, diff } for the chosen basis, or null.
// Exported for unit tests. (This is what fixes ANA's spurious 1D −33.95%.)
function reconcileChange(cur, base) {
  if (!cur || !base) return null;
  const adj = ratioOf(cur.a, base.a);
  const raw = ratioOf(cur.r, base.r);
  if (!adj && !raw) return null;
  if (!adj) return raw;
  if (!raw) return adj;
  if (Math.abs(adj.pct - raw.pct) <= DIVERGE_TOL) return adj;
  return Math.abs(adj.pct) <= Math.abs(raw.pct) ? adj : raw;
}

// contribution over the period ≈ PAF × (close − base) / current-divisor (index
// points) ≈ the bar's volume (area × height), using the reconciled diff/basis.
function shapePeriod(latestMap, baseMap, asOfDate) {
  const divisor = PARAMS.divisor;
  const wmap = weightMapFromLatest(latestMap);
  const constituents = PARAMS.constituents.map((c) => {
    const c4 = code4(c.code);
    const w = round2(wmap.get(c.code) ?? 0);
    const rec = reconcileChange(latestMap.get(c4), baseMap.get(c4));
    if (!rec) {
      return { code: c.code, name: c.name, nameEn: c.nameEn, sector: c.sector, changePct: 0, weight: w, contribution: 0 };
    }
    return {
      code: c.code, name: c.name, nameEn: c.nameEn, sector: c.sector,
      changePct: round2(rec.pct),
      weight: w,
      contribution: round2(((c.paf ?? 1) * rec.diff) / divisor),
    };
  });
  // asOf = the latest trading date the data reflects (JST), not the fetch time.
  return { asOf: asOfDate ? fmtDash(asOfDate) : new Date().toISOString().slice(0, 10), constituents };
}

// ---- J-Quants V2: daily bars for a date (all stocks) → Map<code4,{a,r}> ------
// a = adjusted close (AdjC), r = raw close (Close). Both kept so reconcileChange
// can compare them. Missing fields are null.
async function quotesForDate(dateStr, key) {
  const map = new Map();
  let pkey = null;
  do {
    const url = `${BARS}?date=${dateStr}` + (pkey ? `&pagination_key=${encodeURIComponent(pkey)}` : '');
    const r = await fetch(url, { headers: { 'x-api-key': key, accept: 'application/json' } });
    if (!r.ok) throw new Error(`equities/bars/daily ${r.status}`);
    const j = await r.json();
    for (const q of firstArray(j)) {
      const code = q.Code ?? q.code;
      if (code == null) continue;
      const a = pickAdj(q), raw = pickRaw(q);
      if (a != null || raw != null) map.set(code4(code), { a, r: raw });
    }
    pkey = j.pagination_key || j.paginationKey || null;
  } while (pkey);
  return map;
}

// Nearest trading day on/before target (steps back up to 7 days for holidays).
// Memoized by date string so a date shared across periods is fetched once.
async function quotesOnOrBefore(target, key, cache) {
  for (let i = 0; i < 8; i++) {
    const d = addDays(target, -i);
    const ds = fmt(d);
    let map = cache && cache.get(ds);
    if (!map) { map = await quotesForDate(ds, key); if (cache) cache.set(ds, map); }
    if (map.size) return { date: d, map };
  }
  return { date: target, map: new Map() };
}

// V2 field names are abbreviated (AdjC = adjustment close); be tolerant.
function pickAdj(q) {
  for (const k of ['AdjC', 'AdjustmentClose', 'adjustmentClose']) if (q[k] != null) return Number(q[k]);
  return null;
}
function pickRaw(q) {
  for (const k of ['Cl', 'Close', 'close']) if (q[k] != null) return Number(q[k]);
  return null;
}
function firstArray(j) {
  if (Array.isArray(j)) return j;
  for (const k of ['daily_quotes', 'bars', 'data', 'quotes']) if (Array.isArray(j[k])) return j[k];
  for (const v of Object.values(j)) if (Array.isArray(v)) return v;
  return [];
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
function code4(code) { return String(code).slice(0, 4); } // J-Quants uses 5-digit (4-digit + '0')
const round2 = (x) => Math.round(x * 100) / 100;

// exported for unit tests (ignored by the Worker runtime)
export const _internals = { shapePeriod, shapeTimeline, weightMapFromLatest, reconcileChange, periodBaseDates, addMonths, addDays, fmt, code4, pickAdj, pickRaw, firstArray, corsHeaders };
