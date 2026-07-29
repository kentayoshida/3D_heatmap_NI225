// Serverless proxy (Cloudflare Worker style; adaptable to Vercel/Lambda).
//
// Holds the J-Quants V2 API key, fetches daily price bars per period, computes
// 寄与度 from index params, and returns the exact JSON the frontend expects:
//   { "1D": { asOf, constituents:[{code,name,sector,changePct,contribution}] }, ... }
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

  const latest = await quotesOnOrBefore(todayJst, key);
  if (!latest.map.size) throw new Error('No J-Quants quotes returned (check API key / plan freshness).');

  const baseDates = periodBaseDates(latest.date);
  const out = {};
  for (const p of PERIODS) {
    const base = await quotesOnOrBefore(baseDates[p], key);
    out[p] = shapePeriod(latest.map, base.map);
  }
  return out;
}

// ---- 寄与度 math ------------------------------------------------------------
// close/base use the adjustment close (split-adjusted). contribution over the
// period is approximated as PAF × (close − base) / current-divisor (index points).
function shapePeriod(latestMap, baseMap) {
  const divisor = PARAMS.divisor;
  const constituents = PARAMS.constituents.map((c) => {
    const c4 = code4(c.code);
    const close = latestMap.get(c4);
    const base = baseMap.get(c4);
    if (close == null || base == null || !base) {
      return { code: c.code, name: c.name, sector: c.sector, changePct: 0, contribution: 0 };
    }
    const diff = close - base;
    return {
      code: c.code, name: c.name, sector: c.sector,
      changePct: round2((diff / base) * 100),
      contribution: round2(((c.paf ?? 1) * diff) / divisor),
    };
  });
  return { asOf: new Date().toISOString(), constituents };
}

// ---- J-Quants V2: daily bars for a date (all stocks) → Map<code4, adjClose> --
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
      const price = pickPrice(q);
      if (code != null && price != null) map.set(code4(code), price);
    }
    pkey = j.pagination_key || j.paginationKey || null;
  } while (pkey);
  return map;
}

// Nearest trading day on/before target (steps back up to 7 days for holidays).
async function quotesOnOrBefore(target, key) {
  for (let i = 0; i < 8; i++) {
    const d = addDays(target, -i);
    const map = await quotesForDate(fmt(d), key);
    if (map.size) return { date: d, map };
  }
  return { date: target, map: new Map() };
}

// V2 field names are abbreviated (AdjC = adjustment close); be tolerant.
function pickPrice(q) {
  for (const k of ['AdjC', 'AdjustmentClose', 'Cl', 'Close', 'close', 'adjustmentClose']) {
    if (q[k] != null) return Number(q[k]);
  }
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
function code4(code) { return String(code).slice(0, 4); } // J-Quants uses 5-digit (4-digit + '0')
const round2 = (x) => Math.round(x * 100) / 100;

// exported for unit tests (ignored by the Worker runtime)
export const _internals = { shapePeriod, periodBaseDates, addMonths, addDays, fmt, code4, pickPrice, firstArray, corsHeaders };
