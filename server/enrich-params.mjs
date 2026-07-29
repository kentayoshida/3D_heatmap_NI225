// OPTIONAL. The official PAF CSV already gives name + sector + PAF, so this step
// is only needed if you'd rather use J-Quants' own company names / sector labels.
// Fills name + sector into index-params.json from the J-Quants V2 equities master,
// and flags codes J-Quants doesn't recognize. Run after build-params.mjs.
//
//   JQUANTS_API_KEY=... node server/enrich-params.mjs
//
// Requires Node 18+ (global fetch). Endpoint/field names are best-effort for V2;
// adjust MASTER_PATH / sector keys if your account returns different names.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JQ = 'https://api.jquants.com/v2';
const MASTER_PATH = `${JQ}/equities/master`; // V2 listed master (get_eq_master)
const PARAMS_PATH = resolve(__dirname, 'index-params.json');

const key = process.env.JQUANTS_API_KEY;
if (!key) throw new Error('Set JQUANTS_API_KEY (V2 API key from the J-Quants dashboard).');

const params = JSON.parse(readFileSync(PARAMS_PATH, 'utf8'));
const info = await masterAll(); // Map<code4, { name, sector }>

let filled = 0;
const unknown = [];
for (const c of params.constituents) {
  const hit = info.get(code4(c.code));
  if (hit) {
    if (hit.name) c.name = hit.name;
    if (hit.sector) c.sector = hit.sector;
    filled++;
  } else {
    unknown.push(c.code);
  }
}
params._enrichedAt = new Date().toISOString();
writeFileSync(PARAMS_PATH, JSON.stringify(params, null, 2));

console.log(`enriched ${filled}/${params.constituents.length} constituents from J-Quants V2`);
if (unknown.length) {
  console.log(`WARNING: ${unknown.length} code(s) not found (verify membership): ${unknown.join(', ')}`);
}

// ---- J-Quants V2 helpers ----------------------------------------------------
async function masterAll() {
  const map = new Map();
  let pkey = null;
  do {
    const url = MASTER_PATH + (pkey ? `?pagination_key=${encodeURIComponent(pkey)}` : '');
    const r = await fetch(url, { headers: { 'x-api-key': key, accept: 'application/json' } });
    if (!r.ok) throw new Error(`equities/master ${r.status}`);
    const j = await r.json();
    for (const it of firstArray(j)) {
      const code = it.Code ?? it.code;
      if (code == null) continue;
      map.set(code4(code), { name: pickName(it), sector: pickSector(it) });
    }
    pkey = j.pagination_key || j.paginationKey || null;
  } while (pkey);
  return map;
}

function pickName(it) {
  for (const k of ['CompanyName', 'Name', 'company_name', 'name']) if (it[k]) return it[k];
  return null;
}
function pickSector(it) {
  for (const k of ['Sector33CodeName', 'Sec33Name', 'Sector33Name', 'sector33CodeName', 'Sector', 'sector']) if (it[k]) return it[k];
  return null;
}
function firstArray(j) {
  if (Array.isArray(j)) return j;
  for (const k of ['info', 'master', 'data', 'equities']) if (Array.isArray(j[k])) return j[k];
  for (const v of Object.values(j)) if (Array.isArray(v)) return v;
  return [];
}
function code4(code) { return String(code).slice(0, 4); }
