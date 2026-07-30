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

// Per-index display metadata: switcher label, legend/page title per language,
// and whether the constituent `name` is already English (US) or Japanese (Nikkei).
// For Japanese-named indices the English view uses `nameEn` if present, else the
// stock code.
export const INDEX_META = {
  NIKKEI:    { label: 'NIKKEI',     namesEnglish: false, title: { ja: '日経平均225 3D ヒートマップ',    en: 'Nikkei 225 · 3D Heatmap' } },
  DOW30:     { label: 'DOW30',      namesEnglish: true,  title: { ja: 'NYダウ工業株30種 3D ヒートマップ', en: 'Dow Jones 30 · 3D Heatmap' } },
  NASDAQ100: { label: 'NASDAQ 100', namesEnglish: true,  title: { ja: 'NASDAQ 100 3D ヒートマップ',       en: 'Nasdaq 100 · 3D Heatmap' } },
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
    if (period === 'TIMELINE') {
      // Optional animation block: { frames: [{ asOf, constituents:[…] }, …] }.
      if (!block || !Array.isArray(block.frames)) throw new Error('TIMELINE missing frames[]');
      for (const f of block.frames) {
        if (!f || !Array.isArray(f.constituents)) throw new Error('TIMELINE frame missing constituents[]');
      }
      continue;
    }
    if (!block || !Array.isArray(block.constituents)) {
      throw new Error(`period ${period} missing constituents[]`);
    }
  }
  return json;
}

// True if a loaded payload carries a usable timeline (≥2 frames to animate).
export function hasTimeline(data) {
  return !!(data && data.TIMELINE && Array.isArray(data.TIMELINE.frames) && data.TIMELINE.frames.length >= 2);
}
