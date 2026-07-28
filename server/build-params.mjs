// Builds server/index-params.json — the index parameters the proxy needs to turn
// J-Quants quotes into 寄与度: constituent list (code/name/sector) + PAF + divisor.
//
//   node server/build-params.mjs
//
// Source priority:
//  1. OFFICIAL Nikkei PAF CSV, if present at server/nikkei_225_price_adjustment_factor_jp.csv
//     (download: https://indexes.nikkei.co.jp/nkave/archives/file/nikkei_225_price_adjustment_factor_jp.csv)
//     → authoritative 225 membership + PAF. This is the recommended input.
//  2. Otherwise server/constituents.mjs (hand-compiled candidate list, PAF=1).
//
// Company name + sector are placeholders here; run `node server/enrich-params.mjs`
// afterwards to fill authoritative CompanyName + Sector33CodeName from J-Quants.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSTITUENTS } from './constituents.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(__dirname, 'nikkei_225_price_adjustment_factor_jp.csv');
const DIVISOR = 29.92; // ≈ current Nikkei 225 divisor; update from the daily publication

// name/sector lookup from the hand list (placeholder until J-Quants enrichment)
const META = new Map(CONSTITUENTS.map(([code, name, sector]) => [code, { name, sector }]));

let constituents;
let source;
if (existsSync(CSV_PATH)) {
  source = 'official PAF CSV';
  const paf = parsePafCsv(readFileSync(CSV_PATH));
  constituents = paf.map(({ code, paf }) => {
    const m = META.get(code) || {};
    return { code, name: m.name || code, sector: m.sector || '未分類', paf };
  });
} else {
  source = 'constituents.mjs (candidate superset — provide the official CSV to pin exactly 225)';
  constituents = CONSTITUENTS.map(([code, name, sector]) => ({ code, name, sector, paf: 1 }));
}

const params = {
  _note: 'Run enrich-params.mjs to fill authoritative name/sector from J-Quants. PAF from official CSV when provided; else 1.',
  _source: source,
  asOfParams: new Date().toISOString().slice(0, 10),
  divisor: DIVISOR,
  constituents,
};

writeFileSync(resolve(__dirname, 'index-params.json'), JSON.stringify(params, null, 2));
console.log(`wrote index-params.json — ${constituents.length} constituents, divisor ${DIVISOR}`);
console.log(`source: ${source}`);
if (constituents.length !== 225) {
  console.log(`NOTE: expected 225, got ${constituents.length}. Provide the official PAF CSV to fix membership.`);
}

// Tolerant CSV parse: extract { code, paf } without depending on encoding/columns.
// code  = a 4-digit ticker or 3-digit+letter (new TSE code); PAF = a number in (0,1].
function parsePafCsv(buf) {
  const text = buf.toString('latin1'); // only ASCII (codes/numbers) matter here
  const rows = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    let code = null;
    for (const x of fields) {
      if (/^(\d{4}|\d{3}[A-Za-z])$/.test(x) && +x !== 0) { code = x.toUpperCase(); break; }
    }
    if (!code || seen.has(code)) continue;
    let paf = 1;
    for (const x of fields) {
      if (x === code) continue;
      const n = Number(x);
      if (Number.isFinite(n) && n > 0 && n <= 1) { paf = n; break; }
    }
    seen.add(code);
    rows.push({ code, paf });
  }
  return rows;
}
