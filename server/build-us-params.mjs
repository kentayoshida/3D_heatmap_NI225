// Builds server/us-index-params.json — the constituent parameters the US proxy
// (us-worker.js) needs to turn Yahoo quotes into 寄与度.
//
//   node server/build-us-params.mjs
//
// Dow 30 is price-weighted, so only code/name/sector are needed (the weight is the
// live share price, fetched by the Worker). Nasdaq-100 is cap-weighted, so each
// name carries an index weight (%). Weights come from:
//   1. server/qqq_holdings.csv if present — the Invesco QQQ holdings export
//      (columns include Ticker, Name, Weight, Sector). This is the authoritative,
//      up-to-date source. Download from the QQQ fund page → "Holdings" → Download.
//   2. Otherwise the bundled seed in server/us-constituents.mjs (approximate).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOW30, NASDAQ100 } from './us-constituents.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QQQ_CSV = resolve(__dirname, 'qqq_holdings.csv');

// Nominal Dow divisor (fallback only; the Worker derives it live from ^DJI).
const DOW_DIVISOR = 0.16268;

const dowConstituents = DOW30.map(([code, name, sector]) => ({ code, name, sector }));

let nasdaqConstituents;
let nasdaqSource;
if (existsSync(QQQ_CSV)) {
  nasdaqSource = 'Invesco QQQ holdings CSV';
  nasdaqConstituents = parseQqqCsv(readFileSync(QQQ_CSV, 'utf8'));
} else {
  nasdaqSource = 'seed in us-constituents.mjs (approximate weights — drop qqq_holdings.csv to refresh)';
  nasdaqConstituents = NASDAQ100.map(([code, name, sector, weight]) => ({ code, name, sector, weight }));
}

const params = {
  _note: 'US index params for us-worker.js. Dow = price-weighted (weight = live price). Nasdaq = cap-weighted (weight = index %).',
  asOfParams: new Date().toISOString().slice(0, 10),
  dow: { divisor: DOW_DIVISOR, constituents: dowConstituents },
  nasdaq: { constituents: nasdaqConstituents },
};

writeFileSync(resolve(__dirname, 'us-index-params.json'), JSON.stringify(params, null, 2));
console.log(`wrote us-index-params.json — Dow ${dowConstituents.length}, Nasdaq ${nasdaqConstituents.length}`);
console.log(`nasdaq source: ${nasdaqSource}`);
if (dowConstituents.length !== 30) console.log(`NOTE: expected 30 Dow names, got ${dowConstituents.length}.`);
if (nasdaqConstituents.length < 99) console.log(`NOTE: expected ~100 Nasdaq names, got ${nasdaqConstituents.length}.`);

// ---- Invesco QQQ holdings CSV → [{code,name,sector,weight}] ------------------
// Header varies but includes a ticker column, a "% Weight"/"Weight" column, and
// usually Name + Sector. We locate columns by header name (case-insensitive).
function parseQqqCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const findCol = (...keys) => header.findIndex((h) => keys.some((k) => h.includes(k)));
  const ti = findCol('ticker', 'symbol', 'holding ticker');
  const ni = findCol('name', 'security');
  const wi = findCol('weight', '% of fund', 'percentweight');
  const si = findCol('sector', 'gics');
  const out = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i]);
    const code = (f[ti] || '').toUpperCase().trim();
    if (!/^[A-Z][A-Z.\-]{0,5}$/.test(code) || seen.has(code)) continue;
    const weight = Number(String(f[wi] || '').replace(/[%\s,]/g, ''));
    if (!Number.isFinite(weight) || weight <= 0) continue;
    out.push({
      code: code.replace('.', '-'), // Yahoo uses BRK-B style
      name: (f[ni] || code).trim(),
      sector: (si >= 0 ? f[si] : '') || 'Other',
      weight: Math.round(weight * 1000) / 1000,
    });
    seen.add(code);
  }
  return out;
}

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
