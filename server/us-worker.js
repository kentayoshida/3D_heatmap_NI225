// Serverless proxy (Cloudflare Worker) for the US indices: Dow Jones Industrial
// Average (?index=dow) and Nasdaq-100 (?index=nasdaq). Fetches daily bars from
// Yahoo Finance, computes 寄与度, and returns the exact JSON the frontend expects:
//   { "1D": { asOf, constituents:[{code,name,sector,changePct,contribution}] }, ... }
//
// Yahoo Finance has no auth (no key/secret needed) but doesn't allow in-browser
// CORS calls and rate-limits, so we proxy it. One chart request per constituent
// (range=1y) supplies every period's base close, so a full refresh is ~30 (Dow)
// or ~100 (Nasdaq) requests, cached for 10 minutes.
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
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const PERIODS = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y'];
const PAYLOAD_TTL = 600; // seconds
const CONCURRENCY = 8;   // parallel Yahoo requests
const INDEX_SYMBOL = { dow: '^DJI', nasdaq: '^NDX' };

const _cache = new Map(); // index -> { data, exp }

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    const index = (url.searchParams.get('index') || 'dow').toLowerCase();
    if (!INDEX_SYMBOL[index]) {
      return json({ error: `unknown index '${index}' (use dow or nasdaq)` }, 400, cors);
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

  return shapeAllPeriods(index, cfg, seriesByCode, indexLevel);
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
    if (index === 'nasdaq') {
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

async function fetchAllSeries(codes) {
  const map = new Map();
  for (let i = 0; i < codes.length; i += CONCURRENCY) {
    const batch = codes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (code) => {
      try { return [code, await fetchSeries(code)]; } catch { return [code, null]; }
    }));
    for (const [code, s] of results) map.set(code, s);
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
export const _internals = { shapeAllPeriods, shapePeriod, periodBaseDates, closeOnOrBefore, prevClose, lastClose, corsHeaders };
