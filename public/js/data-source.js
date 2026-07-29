// Data source layer. Default = the bundled sample (window.NI225_DATA).
// To go live, set CONFIG.endpoint to a backend that returns the SAME shape:
//   { "1D": { asOf, constituents:[{code,name,sector,changePct,contribution}] }, ... }
//
// Why a backend? The JPX price API is a paid, authenticated service and does not
// allow direct in-browser (CORS) calls, and it returns *quotes*, not 寄与度.
// A small server proxy holds the API key, fetches quotes, computes contribution,
// and serves this JSON. `fromJpxQuotes()` below is the reference transform for
// that proxy (also usable in Node).

export const CONFIG = {
  // J-Quants-fed serverless proxy (returns the shape above). Set to null to use
  // the bundled sample data instead.
  endpoint: 'https://ni225-heatmap-proxy.kenta0117.workers.dev',
};

/**
 * Load all periods. Returns { data: { period: { asOf, constituents } }, live: bool }
 * where live=true means it came from the API (not the bundled sample fallback).
 */
export async function loadData() {
  if (CONFIG.endpoint) {
    try {
      const res = await fetch(CONFIG.endpoint, { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!res.ok) throw new Error(`data endpoint responded ${res.status}`);
      const json = await res.json();
      if (json && json.error) throw new Error(`proxy error: ${json.error}`);
      return { data: normalize(json), live: true };
    } catch (err) {
      // Don't break the page during setup — fall back to the bundled sample.
      console.warn('[ni225] live data unavailable, using bundled sample:', err.message);
      if (typeof window !== 'undefined' && window.NI225_DATA) return { data: window.NI225_DATA, live: false };
      throw err;
    }
  }
  if (typeof window !== 'undefined' && window.NI225_DATA) return { data: window.NI225_DATA, live: false };
  throw new Error('No data source configured (set CONFIG.endpoint or include data/ni225.js).');
}

function normalize(json) {
  if (!json || typeof json !== 'object') throw new Error('bad data payload');
  for (const [period, block] of Object.entries(json)) {
    if (!block || !Array.isArray(block.constituents)) {
      throw new Error(`period ${period} missing constituents[]`);
    }
  }
  return json;
}

// ---- JPX adapter (reference — intended for the server proxy) -----------------
// The Nikkei 225 is a price-weighted index with per-constituent presentation
// adjustment factors (PAF / 株価換算係数) and an index Divisor (除数):
//
//   index          = Σ(price × paf) / divisor
//   changePct(%)   = (close − prevClose) / prevClose × 100
//   contribution   = paf × (close − prevClose) / divisor      [index points]
//
// So computing 寄与度 needs, in addition to JPX quotes: each name's PAF and the
// current Divisor (both published by the index owner). Provide them to this fn.
//
// @param quotes  [{ code, name, sector, close, prevClose, paf }]
// @param opts    { divisor:number, asOf?:string }
// @returns       { asOf, constituents:[{code,name,sector,changePct,contribution}] }
export function fromJpxQuotes(quotes, { divisor, asOf } = {}) {
  if (!divisor) throw new Error('fromJpxQuotes: divisor required');
  const r2 = (x) => Math.round(x * 100) / 100;
  const constituents = quotes.map((q) => {
    const paf = q.paf ?? 1;
    const diff = q.close - q.prevClose;
    const changePct = q.prevClose ? (diff / q.prevClose) * 100 : 0;
    const contribution = (paf * diff) / divisor;
    return { code: q.code, name: q.name, sector: q.sector, changePct: r2(changePct), contribution: r2(contribution) };
  });
  return { asOf: asOf || new Date().toISOString(), constituents };
}
