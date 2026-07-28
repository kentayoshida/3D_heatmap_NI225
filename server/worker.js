// Serverless proxy (Cloudflare Worker style; adaptable to Vercel/Lambda).
//
// Responsibility: hold the JPX API key, fetch quotes for each period, compute
// 寄与度 from index params, and return the exact JSON the frontend expects:
//   { "1D": { asOf, constituents:[{code,name,sector,changePct,contribution}] }, ... }
//
// The ONLY JPX-specific code is fetchPeriodPrices() below — fill it in from your
// JPX API spec. Everything else (math, shaping, CORS, cache) is done.
//
// Deploy (Cloudflare):  wrangler deploy   (set secret: wrangler secret put JPX_API_KEY)
// Then in the frontend: js/data-source.js → CONFIG.endpoint = '<worker-url>'

import PARAMS from './index-params.json'; // Wrangler/esbuild bundles JSON imports

const PERIODS = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y'];
const CACHE_TTL = 60; // seconds; align with your JPX data freshness (e.g. 15-min delay)

export default {
  async fetch(request, env, ctx) {
    const cors = {
      'access-control-allow-origin': env.ALLOW_ORIGIN || '*',
      'access-control-allow-methods': 'GET, OPTIONS',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      const payload = await buildAllPeriods(env);
      return new Response(JSON.stringify(payload), {
        headers: {
          ...cors,
          'content-type': 'application/json; charset=utf-8',
          'cache-control': `public, max-age=${CACHE_TTL}`,
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err && err.message || err) }), {
        status: 502,
        headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
      });
    }
  },
};

async function buildAllPeriods(env) {
  const out = {};
  // fetch all periods in parallel
  const results = await Promise.all(PERIODS.map((p) => fetchPeriodPrices(p, env).then((prices) => [p, prices])));
  for (const [period, prices] of results) {
    out[period] = shapePeriod(prices);
  }
  return out;
}

// prices: Map<code, { close:number, base:number }>
//   close = latest price for the period, base = price at the start of the period
//           (prevClose for 1D, ~1 week ago for 1W, year start for YTD, etc.)
function shapePeriod(prices) {
  const divisor = PARAMS.divisor;
  const constituents = PARAMS.constituents.map((c) => {
    const q = prices.get(c.code);
    if (!q || !q.base) return { code: c.code, name: c.name, sector: c.sector, changePct: 0, contribution: 0 };
    const diff = q.close - q.base;
    const changePct = round2((diff / q.base) * 100);
    const contribution = round2(((c.paf ?? 1) * diff) / divisor);
    return { code: c.code, name: c.name, sector: c.sector, changePct, contribution };
  });
  return { asOf: new Date().toISOString(), constituents };
}

const round2 = (x) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// JPX ADAPTER — the one piece to implement from your JPX API spec.
// Return Map<code, { close, base }> for the given period.
//   - "close": latest/current price (or last daily close)
//   - "base":  reference price at the START of the period
//       1D  → previous day's close
//       1W  → close ~5 trading days ago
//       1M/3M/6M/1Y → close N months/years ago
//       YTD → last close of the previous year
// Use env.JPX_API_KEY for auth. The 15-min delayed API gives current values;
// historical baselines come from JPX's daily/historical endpoint.
// ---------------------------------------------------------------------------
async function fetchPeriodPrices(period, env) {
  if (!env.JPX_API_KEY) {
    throw new Error('JPX_API_KEY not set. Configure the secret and implement fetchPeriodPrices().');
  }
  const codes = PARAMS.constituents.map((c) => c.code);

  // TODO: replace with real JPX API calls. Example skeleton:
  //
  // const quote = await fetch(`${env.JPX_BASE_URL}/quotes?codes=${codes.join(',')}`, {
  //   headers: { Authorization: `Bearer ${env.JPX_API_KEY}` },
  // }).then((r) => r.json());
  // const baseDate = periodBaseDate(period);           // compute the baseline date
  // const hist = await fetch(`${env.JPX_BASE_URL}/history?date=${baseDate}&codes=${codes.join(',')}`, {
  //   headers: { Authorization: `Bearer ${env.JPX_API_KEY}` },
  // }).then((r) => r.json());
  //
  // const map = new Map();
  // for (const code of codes) {
  //   map.set(code, { close: quote[code].price, base: hist[code].close });
  // }
  // return map;

  throw new Error(`fetchPeriodPrices('${period}') not implemented — awaiting JPX API spec.`);
}
