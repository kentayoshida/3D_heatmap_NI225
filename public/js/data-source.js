// Data source layer for the multi-index heatmap. Each index (NIKKEI / DOW30 /
// NASDAQ100) is served by a small backend proxy that returns the SAME shape:
//   { "1D": { asOf, constituents:[{code,name,sector,changePct,contribution}] }, ... }
//
// Why a backend? The upstream price APIs (JPX / J-Quants for Nikkei, Yahoo Finance
// for the US indices) don't allow direct in-browser (CORS) calls, and they return
// *quotes*, not 寄与度. A small server proxy holds any keys, fetches quotes,
// computes contribution, and serves this JSON. See server/worker.js (Nikkei) and
// server/us-worker.js (US). If a proxy is unreachable we fall back to the bundled
// sample in window.HEATMAP_SAMPLE[index].

export const INDICES = ['NIKKEI', 'DOW30', 'NASDAQ100'];

// Per-index display metadata (switcher label + legend/page title).
export const INDEX_META = {
  NIKKEI:    { label: 'NIKKEI',     title: '日経平均225 3D ヒートマップ' },
  DOW30:     { label: 'DOW30',      title: 'NYダウ工業株30種 3D ヒートマップ' },
  NASDAQ100: { label: 'NASDAQ 100', title: 'NASDAQ 100 3D ヒートマップ' },
};

export const CONFIG = {
  // One endpoint per index (the proxies that return the shape above). Set an entry
  // to null to always use that index's bundled sample data instead.
  endpoints: {
    NIKKEI:    'https://ni225-heatmap-proxy.kenta0117.workers.dev',
    DOW30:     'https://us-heatmap-proxy.kenta0117.workers.dev?index=dow',
    NASDAQ100: 'https://us-heatmap-proxy.kenta0117.workers.dev?index=nasdaq',
  },
};

/**
 * Load all periods for one index.
 * @returns { data: { period: { asOf, constituents } }, live: bool }
 *   live=true means it came from the API (not the bundled sample fallback).
 */
export async function loadData(index) {
  const endpoint = CONFIG.endpoints[index];
  if (endpoint) {
    try {
      const res = await fetch(endpoint, { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!res.ok) throw new Error(`data endpoint responded ${res.status}`);
      const json = await res.json();
      if (json && json.error) throw new Error(`proxy error: ${json.error}`);
      return { data: normalize(json), live: true };
    } catch (err) {
      // Don't break the page during setup — fall back to the bundled sample.
      console.warn(`[heatmap] live data unavailable for ${index}, using bundled sample:`, err.message);
      const sample = getSample(index);
      if (sample) return { data: sample, live: false };
      throw err;
    }
  }
  const sample = getSample(index);
  if (sample) return { data: sample, live: false };
  throw new Error(`No data source for ${index} (set CONFIG.endpoints.${index} or include the sample).`);
}

function getSample(index) {
  if (typeof window === 'undefined') return null;
  return (window.HEATMAP_SAMPLE && window.HEATMAP_SAMPLE[index]) || null;
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
