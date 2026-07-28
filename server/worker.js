// Serverless proxy (Cloudflare Worker style; adaptable to Vercel/Lambda).
//
// Holds J-Quants credentials, fetches daily prices for each period, computes
// 寄与度 from index params, and returns the exact JSON the frontend expects:
//   { "1D": { asOf, constituents:[{code,name,sector,changePct,contribution}] }, ... }
//
// J-Quants (https://jpx-jquants.com) is END-OF-DAY (daily) data, not intraday, so
// "1D" = latest close vs the previous close. Longer periods compare the latest
// close with the close at the start of the period. Data freshness depends on your
// J-Quants plan (Free is delayed ~12 weeks; paid plans are near previous-day).
//
// Secrets (wrangler secret put ...):
//   JQUANTS_REFRESH_TOKEN            (preferred)  — or —
//   JQUANTS_MAILADDRESS + JQUANTS_PASSWORD        (used to obtain a refresh token)
// Vars (wrangler.toml [vars]): ALLOW_ORIGIN (default '*')
//
// Frontend: js/data-source.js → CONFIG.endpoint = '<worker-url>'

import PARAMS from './index-params.json' with { type: 'json' }; // bundled by Wrangler/esbuild

const JQ = 'https://api.jquants.com/v1';
const PERIODS = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y'];
const PAYLOAD_TTL = 600; // seconds; EOD data changes at most daily

let _idToken = { token: null, exp: 0 };
let _payload = { data: null, exp: 0 };

export default {
  async fetch(request, env) {
    const cors = {
      'access-control-allow-origin': env.ALLOW_ORIGIN || '*',
      'access-control-allow-methods': 'GET, OPTIONS',
    };
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

// ---- assemble all periods ---------------------------------------------------
async function buildAllPeriods(env) {
  const idToken = await getIdToken(env);
  const todayJst = new Date(Date.now() + 9 * 3600 * 1000); // JST calendar date via UTC getters

  const latest = await quotesOnOrBefore(todayJst, idToken);
  if (!latest.map.size) throw new Error('No J-Quants quotes returned (check plan freshness / credentials).');

  const baseDates = periodBaseDates(latest.date);
  const out = {};
  for (const p of PERIODS) {
    const base = await quotesOnOrBefore(baseDates[p], idToken);
    out[p] = shapePeriod(latest.map, base.map);
  }
  return out;
}

// ---- 寄与度 math ------------------------------------------------------------
// close/base use AdjustmentClose (split-adjusted). contribution over the period is
// approximated as PAF × (close − base) / current-divisor (index points).
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

// ---- J-Quants: tokens -------------------------------------------------------
async function getIdToken(env) {
  const now = Date.now();
  if (_idToken.token && now < _idToken.exp) return _idToken.token;

  const haveLogin = env.JQUANTS_MAILADDRESS && env.JQUANTS_PASSWORD;
  const cache = (t) => { _idToken = { token: t, exp: now + 23 * 3600 * 1000 }; return t; };

  // 1) try a provided refresh token
  if (env.JQUANTS_REFRESH_TOKEN) {
    const t = await tryRefresh(env.JQUANTS_REFRESH_TOKEN);
    if (t) return cache(t);
    if (!haveLogin) throw new Error('auth_refresh failed (refresh token expired/invalid?) and no JQUANTS_MAILADDRESS/PASSWORD fallback set.');
  }
  // 2) obtain a fresh refresh token via mail + password
  if (haveLogin) {
    const t = await tryRefresh(await authUser(env));
    if (t) return cache(t);
    throw new Error('auth_refresh failed after auth_user.');
  }
  throw new Error('Set JQUANTS_REFRESH_TOKEN, or JQUANTS_MAILADDRESS + JQUANTS_PASSWORD.');
}

async function tryRefresh(refresh) {
  const r = await fetch(`${JQ}/token/auth_refresh?refreshtoken=${encodeURIComponent(refresh)}`, { method: 'POST' });
  return r.ok ? (await r.json()).idToken : null;
}

async function authUser(env) {
  const r = await fetch(`${JQ}/token/auth_user`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mailaddress: env.JQUANTS_MAILADDRESS, password: env.JQUANTS_PASSWORD }),
  });
  if (!r.ok) throw new Error(`auth_user ${r.status}`);
  return (await r.json()).refreshToken;
}

// ---- J-Quants: daily quotes -------------------------------------------------
// All stocks for one date (paginated) → Map<code4, AdjustmentClose>.
async function quotesForDate(dateStr, idToken) {
  const map = new Map();
  let key = null;
  do {
    const url = `${JQ}/prices/daily_quotes?date=${dateStr}` + (key ? `&pagination_key=${encodeURIComponent(key)}` : '');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!r.ok) throw new Error(`daily_quotes ${r.status}`);
    const j = await r.json();
    for (const q of j.daily_quotes || []) {
      const price = q.AdjustmentClose ?? q.Close;
      if (price != null) map.set(code4(q.Code), price);
    }
    key = j.pagination_key || null;
  } while (key);
  return map;
}

// Nearest trading day on/before target (steps back up to 7 days for holidays).
async function quotesOnOrBefore(target, idToken) {
  for (let i = 0; i < 8; i++) {
    const d = addDays(target, -i);
    const map = await quotesForDate(fmt(d), idToken);
    if (map.size) return { date: d, map };
  }
  return { date: target, map: new Map() };
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
function addMonths(d, n) {
  const x = new Date(d.getTime());
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}
function fmt(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function code4(code) { return String(code).slice(0, 4); } // J-Quants uses 5-digit (4-digit + '0')
const round2 = (x) => Math.round(x * 100) / 100;

// exported for unit tests (ignored by the Worker runtime)
export const _internals = { shapePeriod, periodBaseDates, addMonths, addDays, fmt, code4 };
