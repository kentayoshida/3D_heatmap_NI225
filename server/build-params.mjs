// Builds server/index-params.json — the index parameters the proxy needs to turn
// JPX quotes into 寄与度: constituent list (code/name/sector) + PAF + divisor.
//
//   node server/build-params.mjs
//
// SEED SOURCE: currently derived from data/ni225.js (codes/names/sectors) with
// paf = 1 for every name. Before going live, replace names/sectors/PAF with the
// OFFICIAL Nikkei list (日経平均プロフィル 構成銘柄 / Premium Data Package) and set
// the correct PAF for value-heavy stocks (PAF ≠ 1). Divisor is published daily.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIVISOR = 29.92; // ≈ current Nikkei 225 divisor; update from daily publication

const win = {};
new Function('window', readFileSync(resolve(__dirname, '../data/ni225.js'), 'utf8'))(win);
const seed = win.NI225_DATA['1D'].constituents;

const constituents = seed.map((c) => ({
  code: c.code,
  name: c.name,
  sector: c.sector,
  paf: 1, // TODO: set official PAF (0.1–0.9) for value-heavy names; most are 1
}));

const params = {
  _note: 'SEED derived from sample data. Replace names/sectors/PAF with official Nikkei data before production.',
  asOfParams: new Date().toISOString().slice(0, 10),
  divisor: DIVISOR,
  constituents,
};

const out = resolve(__dirname, 'index-params.json');
writeFileSync(out, JSON.stringify(params, null, 2));
console.log(`wrote ${out} — ${constituents.length} constituents, divisor ${DIVISOR}`);
