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
import { DOW30, NASDAQ100, SENSEX, NIFTY50 } from './us-constituents.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QQQ_CSV = resolve(__dirname, 'qqq_holdings.csv');
const SENSEX_CSV = resolve(__dirname, 'sensex_weights.csv');
const NIFTY_CSV = resolve(__dirname, 'nifty_weights.csv');

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

// India indices (cap-weighted, like Nasdaq): weight = published index %. Rows come
// from us-constituents.mjs; an optional Ticker,Weight CSV (server/sensex_weights.csv
// / server/nifty_weights.csv, Ticker matching the code e.g. HDFCBANK.NS / RELIANCE.NS)
// overrides those weights with the latest official figures.
const sensexConstituents = capConstituents(SENSEX, SENSEX_CSV);
const niftyConstituents = capConstituents(NIFTY50, NIFTY_CSV);

const params = {
  _note: 'International index params for us-worker.js. Dow = price-weighted (weight = live price). Nasdaq/Sensex/Nifty = cap-weighted (weight = index %).',
  asOfParams: new Date().toISOString().slice(0, 10),
  dow: { divisor: DOW_DIVISOR, constituents: dowConstituents },
  nasdaq: { constituents: nasdaqConstituents },
  sensex: { constituents: sensexConstituents },
  nifty: { constituents: niftyConstituents },
};

writeFileSync(resolve(__dirname, 'us-index-params.json'), JSON.stringify(params, null, 2));
console.log(`wrote us-index-params.json — Dow ${dowConstituents.length}, Nasdaq ${nasdaqConstituents.length}, Sensex ${sensexConstituents.length}, Nifty ${niftyConstituents.length}`);
console.log(`nasdaq source: ${nasdaqSource}`);
if (dowConstituents.length !== 30) console.log(`NOTE: expected 30 Dow names, got ${dowConstituents.length}.`);
if (nasdaqConstituents.length < 99) console.log(`NOTE: expected ~100 Nasdaq names, got ${nasdaqConstituents.length}.`);
if (sensexConstituents.length !== 30) console.log(`NOTE: expected 30 Sensex names, got ${sensexConstituents.length}.`);
if (niftyConstituents.length !== 50) console.log(`NOTE: expected 50 Nifty names, got ${niftyConstituents.length}.`);

// ---- cap-weighted universe [ticker,name,sector,weight] (+ optional CSV override) --
function capConstituents(seed, csvPath) {
  const rows = seed.map(([code, name, sector, weight]) => ({ code, name, sector, weight }));
  if (!existsSync(csvPath)) return rows;
  const overrides = parseWeightCsv(readFileSync(csvPath, 'utf8')); // Map<UPPER ticker, weight>
  for (const r of rows) {
    const w = overrides.get(r.code.toUpperCase());
    if (Number.isFinite(w)) r.weight = w;
  }
  return rows;
}

// Minimal Ticker,Weight CSV → Map<UPPER ticker, weight%>. Locates the ticker and
// weight columns by header name (case-insensitive); ignores other columns.
function parseWeightCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const map = new Map();
  if (!lines.length) return map;
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const ti = header.findIndex((h) => h.includes('ticker') || h.includes('symbol') || h.includes('code'));
  const wi = header.findIndex((h) => h.includes('weight') || h.includes('%'));
  if (ti < 0 || wi < 0) return map;
  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i]);
    const code = (f[ti] || '').toUpperCase().trim();
    const weight = Number(String(f[wi] || '').replace(/[%\s,]/g, ''));
    if (code && Number.isFinite(weight) && weight > 0) map.set(code, Math.round(weight * 1000) / 1000);
  }
  return map;
}

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
