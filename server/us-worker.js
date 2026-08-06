// Serverless proxy (Cloudflare Worker) for the international indices served from
// Yahoo Finance: Dow Jones Industrial Average (?index=dow), Nasdaq-100
// (?index=nasdaq), BSE Sensex (?index=sensex) and Nifty 50 (?index=nifty).
// Fetches daily bars from Yahoo Finance, computes 寄与度, and returns the exact
// JSON the frontend expects:
//   { "1D": { asOf, constituents:[{code,name,sector,changePct,contribution}] }, ... }
//
// Yahoo Finance has no auth (no key/secret needed) but doesn't allow in-browser
// CORS calls and rate-limits, so we proxy it. Constituent daily series come from
// the *spark* endpoint, which takes many symbols per request (?symbols=A,B,C…),
// so a full refresh is only a handful of subrequests (~2 for Dow, ~5 for Nasdaq)
// plus 1 for the index level — well under Cloudflare's free-plan 50-subrequest
// cap. (An earlier one-request-per-constituent design made ~101 subrequests for
// the Nasdaq 100 and tripped that cap, so Nasdaq fell back to the sample.)
// Cached for 10 minutes.
//
// 寄与度 (area ∝ |contribution|):
//   Dow    (price-weighted): contribution = (close − base) / divisor
//          divisor derived live from Σ(latest close) / ^DJI level (self-correcting).
//   Nasdaq (cap-weighted):   contribution = NDX level × weight% × changePct%
//          i.e. the name's point contribution to the index move.
//
// Var (wrangler [vars]): ALLOW_ORIGIN (comma-separated allowlist or '*').

import PARAMS from './us-index-params.json' with { type: 'json' };

const YCHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YSPARK = 'https://query1.finance.yahoo.com/v7/finance/spark';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const PERIODS = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y'];
const PAYLOAD_TTL = 600; // seconds
const SPARK_BATCH = 20;  // symbols per spark request (keeps URLs + subrequests small)
const INDEX_SYMBOL = { dow: '^DJI', nasdaq: '^NDX', sensex: '^BSESN', nifty: '^NSEI' };
// Cap-weighted indices carry a per-name index weight% and get 寄与度 =
// level × weight% × change% (vs. the price-weighted Dow's (close−base)/divisor).
const CAP_WEIGHTED = new Set(['nasdaq', 'sensex', 'nifty']);

const _cache = new Map(); // index -> { data, exp }

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    const index = (url.searchParams.get('index') || 'dow').toLowerCase();
    if (!INDEX_SYMBOL[index]) {
      return json({ error: `unknown index '${index}' (use dow, nasdaq, sensex or nifty)` }, 400, cors);
    }
    try {
      const now = Date.now();
      const hit = _cache.get(index);
      if (!hit || now > hit.exp) {
        _cache.set(index, { data: await buildIndex(index), exp: now + PAYLOAD_TTL * 1000 });
      }
      return json(_cache.get(index).data, 200, cors, PAYLOAD_TTL);
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 502, cors);
    }
  },
};

function json(obj, status, cors, ttl) {
  const h = { ...cors, 'content-type': 'application/json; charset=utf-8' };
  if (ttl) h['cache-control'] = `public, max-age=${ttl}`;
  return new Response(JSON.stringify(obj), { status, headers: h });
}

// ---- CORS (same policy as the Nikkei worker) --------------------------------
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

// ---- assemble one index -----------------------------------------------------
async function buildIndex(index) {
  const cfg = PARAMS[index];
  if (!cfg || !cfg.constituents?.length) throw new Error(`no params for ${index}`);

  // Fetch each constituent's 1y daily series + the index level series.
  const codes = cfg.constituents.map((c) => c.code);
  const seriesByCode = await fetchAllSeries(codes);
  const indexSeries = await fetchSeries(INDEX_SYMBOL[index]);
  const indexLevel = indexSeries ? lastClose(indexSeries) : null;

  const ok = codes.filter((c) => seriesByCode.get(c)?.length).length;
  if (ok < Math.ceil(codes.length * 0.5)) {
    throw new Error(`Yahoo returned too few series (${ok}/${codes.length}) — rate limited?`);
  }

  const out = shapeAllPeriods(index, cfg, seriesByCode, indexLevel);
  out.TIMELINE = buildTimeline(index, cfg, seriesByCode, indexSeries);
  return out;
}

// ---- timeline: last N trading days (daily change) with a FIXED footprint -----
// The area (contribution) is pinned to a stable per-name weight (share price for
// the price-weighted Dow, cap weight% for the Nasdaq) so the treemap layout is the
// same on every frame — only height/color (that day's change%) animate. Pure over
// the already-fetched series (no extra requests). Exported for unit tests.
const TIMELINE_DAYS = 5;
function fixedSize(index, c, s) {
  if (CAP_WEIGHTED.has(index)) return Math.max(c.weight ?? 0, 0); // cap weight%
  return s && s.length ? lastClose(s) : 0; // dow: share price
}
function longestSeries(seriesByCode) {
  let best = null;
  for (const s of seriesByCode.values()) if (s && (!best || s.length > best.length)) best = s;
  return best;
}
function buildTimeline(index, cfg, seriesByCode, indexSeries, n = TIMELINE_DAYS) {
  const ref = indexSeries && indexSeries.length >= 2 ? indexSeries : longestSeries(seriesByCode);
  if (!ref || ref.length < 2) return { frames: [] };
  const dates = ref.slice(-(n + 1)).map((p) => p.t); // ascending, up to n+1 dates
  const frames = [];
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1];
    const constituents = cfg.constituents.map((c) => {
      const s = seriesByCode.get(c.code);
      const size = fixedSize(index, c, s);
      const close = s && s.length ? closeOnOrBefore(s, d) : null;
      const base = s && s.length ? closeOnOrBefore(s, prev) : null;
      const changePct = (close != null && base) ? ((close - base) / base) * 100 : 0;
      return { code: c.code, name: c.name, sector: c.sector, changePct: round2(changePct), contribution: round2(size) };
    });
    frames.push({ asOf: fmtDash(d), constituents });
  }
  return { frames };
}

// Pure: build all 7 periods from fetched series. Exported for unit tests.
function shapeAllPeriods(index, cfg, seriesByCode, indexLevel) {
  // latest trading date = the most recent timestamp across all series.
  let latest = null;
  for (const s of seriesByCode.values()) {
    if (s && s.length) { const t = s[s.length - 1].t; if (!latest || t > latest) latest = t; }
  }
  if (!latest) throw new Error('no dated closes');

  // Dow divisor: derive from Σ(latest close) / index level; fall back to nominal.
  let divisor = cfg.divisor || 1;
  if (index === 'dow' && indexLevel) {
    let sum = 0;
    for (const c of cfg.constituents) { const s = seriesByCode.get(c.code); if (s?.length) sum += lastClose(s); }
    if (sum > 0) divisor = sum / indexLevel;
  }

  const baseDates = periodBaseDates(latest);
  const out = {};
  for (const p of PERIODS) {
    out[p] = shapePeriod(index, cfg, seriesByCode, { p, baseDate: baseDates[p], latest, divisor, indexLevel });
  }
  return out;
}

function shapePeriod(index, cfg, seriesByCode, { p, baseDate, latest, divisor, indexLevel }) {
  const constituents = cfg.constituents.map((c) => {
    const s = seriesByCode.get(c.code);
    const zero = { code: c.code, name: c.name, sector: c.sector, changePct: 0, contribution: 0 };
    if (!s || !s.length) return zero;
    const close = lastClose(s);
    const base = p === '1D' ? prevClose(s) : closeOnOrBefore(s, baseDate);
    if (close == null || base == null || !base) return zero;
    const diff = close - base;
    const changePct = (diff / base) * 100;
    let contribution;
    if (CAP_WEIGHTED.has(index)) {
      // point contribution to a cap-weighted index ≈ level × weight × return.
      const level = indexLevel || 100;
      contribution = level * ((c.weight ?? 0) / 100) * (changePct / 100);
    } else {
      contribution = diff / (divisor || 1); // price-weighted
    }
    return {
      code: c.code, name: c.name, sector: c.sector,
      changePct: round2(changePct), contribution: round2(contribution),
    };
  });
  return { asOf: fmtDash(latest), constituents };
}

// ---- Yahoo chart fetch ------------------------------------------------------
// Returns a sorted-ascending array of { t: Date, c: number } (adjusted closes).
async function fetchSeries(symbol) {
  const url = `${YCHART}/${encodeURIComponent(symbol)}?range=1y&interval=1d&includeAdjustedClose=true`;
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!r.ok) return null;
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res || !Array.isArray(res.timestamp)) return null;
  const ts = res.timestamp;
  const adj = res.indicators?.adjclose?.[0]?.adjclose;
  const cl = res.indicators?.quote?.[0]?.close;
  const closes = adj || cl;
  if (!Array.isArray(closes)) return null;
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c != null && Number.isFinite(c)) out.push({ t: new Date(ts[i] * 1000), c: Number(c) });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// Spark endpoint: many symbols per request. Returns Map<symbol, series> for the
// symbols in one batch (missing/failed symbols are simply absent from the map).
async function fetchSparkBatch(symbols) {
  const url = `${YSPARK}?symbols=${encodeURIComponent(symbols.join(','))}&range=1y&interval=1d`;
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!r.ok) return new Map();
  return parseSpark(await r.json());
}

// Pure parser for a Yahoo spark payload → Map<symbol, [{t:Date,c:number}]>.
// Shape: { spark: { result: [ { symbol, response: [ { timestamp:[…],
//          indicators: { quote: [ { close:[…] } ] }, meta:{ symbol } } ] } ] } }.
function parseSpark(j) {
  const map = new Map();
  const results = j?.spark?.result;
  if (!Array.isArray(results)) return map;
  for (const item of results) {
    const resp = item?.response?.[0];
    const sym = item?.symbol || resp?.meta?.symbol;
    const ts = resp?.timestamp;
    const closes = resp?.indicators?.quote?.[0]?.close;
    if (!sym || !Array.isArray(ts) || !Array.isArray(closes)) continue;
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c != null && Number.isFinite(c)) out.push({ t: new Date(ts[i] * 1000), c: Number(c) });
    }
    out.sort((a, b) => a.t - b.t);
    map.set(sym, out);
  }
  return map;
}

async function fetchAllSeries(codes) {
  const map = new Map();
  const batches = [];
  for (let i = 0; i < codes.length; i += SPARK_BATCH) batches.push(codes.slice(i, i + SPARK_BATCH));
  const parts = await Promise.all(batches.map(async (b) => {
    try { return await fetchSparkBatch(b); } catch { return new Map(); }
  }));
  for (let bi = 0; bi < batches.length; bi++) {
    const part = parts[bi];
    for (const code of batches[bi]) map.set(code, part.get(code) || null);
  }
  return map;
}

// ---- series helpers ---------------------------------------------------------
function lastClose(s) { return s.length ? s[s.length - 1].c : null; }
function prevClose(s) { return s.length >= 2 ? s[s.length - 2].c : (s.length ? s[0].c : null); }
function closeOnOrBefore(s, target) {
  let val = null;
  for (const pt of s) { if (pt.t <= target) val = pt.c; else break; }
  return val ?? (s.length ? s[0].c : null);
}

// ---- date helpers -----------------------------------------------------------
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
function fmtDash(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
const round2 = (x) => Math.round(x * 100) / 100;

// exported for unit tests (ignored by the Worker runtime)
export const _internals = { shapeAllPeriods, shapePeriod, periodBaseDates, closeOnOrBefore, prevClose, lastClose, corsHeaders, buildTimeline, fixedSize, parseSpark };
