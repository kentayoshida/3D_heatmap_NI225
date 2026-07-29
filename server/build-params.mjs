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
// The official CSV includes 銘柄名 and 業種, so name + sector come straight from it
// (works for new-style codes like 285A too). enrich-params.mjs is optional and only
// needed if you'd rather use J-Quants' own name/sector labels.

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
  const rows = parsePafCsv(readFileSync(CSV_PATH));
  constituents = rows.map(({ code, name, sector, paf }) => {
    const m = META.get(code) || {};
    return { code, name: name || m.name || code, sector: sector || m.sector || '未分類', paf };
  });
} else {
  source = 'constituents.mjs (candidate superset — provide the official CSV to pin exactly 225)';
  constituents = CONSTITUENTS.map(([code, name, sector]) => ({ code, name, sector, paf: 1 }));
}

const params = {
  _note: 'Built from official Nikkei PAF CSV (code/name/sector/PAF). enrich-params.mjs is optional (switches sector to J-Quants Sector33CodeName).',
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
const noName = constituents.filter((c) => c.name === c.code);
const noSector = constituents.filter((c) => c.sector === '未分類');
if (noName.length) console.log(`WARNING: ${noName.length} without a name (shown as code): ${noName.map((c) => c.code).join(', ')}`);
if (noSector.length) console.log(`WARNING: ${noSector.length} without a sector (未分類): ${noSector.map((c) => c.code).join(', ')}`);
if (!noName.length && !noSector.length) console.log('all constituents have name + sector ✓');

// Column-aware CSV parse → { code, name, sector, paf } for every row.
// Header: 対象日付,コード,銘柄名,株価換算係数,業種,セクター (fields are quoted).
// Handles UTF-8 or Shift_JIS, normalizes full-width ASCII in names (ＩＮＰＥＸ→INPEX).
function parsePafCsv(buf) {
  const lines = decodeCsv(buf).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]);
  const find = (...keys) => header.findIndex((h) => keys.some((k) => h.includes(k)));
  let ci = find('コード', 'Code', 'code');
  let ni = find('銘柄名', '名称', 'Name');
  let pi = find('換算係数', '係数', 'PAF');
  let si = find('業種');
  const hasHeader = ci !== -1;
  if (!hasHeader) { ci = 1; ni = 2; pi = 3; si = 4; } // fixed layout fallback

  const rows = [];
  const seen = new Set();
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const f = splitCsvLine(lines[i]);
    const code = (f[ci] || '').toUpperCase();
    if (!/^[0-9A-Z]{4}$/.test(code) || seen.has(code)) continue;
    const pafNum = Number(f[pi]);
    rows.push({
      code,
      name: toHalfWidth(f[ni] || '') || null,
      sector: (si >= 0 ? f[si] : '') || null,
      paf: Number.isFinite(pafNum) && pafNum > 0 && pafNum <= 1 ? pafNum : 1,
    });
    seen.add(code);
  }
  return rows;
}

// Decode as UTF-8; fall back to Shift_JIS if that yields replacement chars.
function decodeCsv(buf) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (!utf8.includes('�')) return utf8;
  try { return new TextDecoder('shift_jis', { fatal: false }).decode(buf); } catch { return utf8; }
}

// Quote-aware CSV line splitter (handles "" escapes); trims each field.
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Full-width ASCII/space → half-width (ＩＮＰＥＸ → INPEX).
function toHalfWidth(s) {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
}
