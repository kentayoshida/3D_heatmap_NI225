// Fills authoritative CompanyName + Sector33CodeName into index-params.json using
// J-Quants /listed/info, and flags codes J-Quants doesn't recognize (likely stale
// membership). Run after build-params.mjs.
//
//   JQUANTS_REFRESH_TOKEN=... node server/enrich-params.mjs
//   # or: JQUANTS_MAILADDRESS=... JQUANTS_PASSWORD=... node server/enrich-params.mjs
//
// Requires Node 18+ (global fetch).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JQ = 'https://api.jquants.com/v1';
const PARAMS_PATH = resolve(__dirname, 'index-params.json');

const env = process.env;
const params = JSON.parse(readFileSync(PARAMS_PATH, 'utf8'));

const idToken = await getIdToken();
const info = await listedInfoAll(idToken); // Map<code4, { name, sector }>

let filled = 0;
const unknown = [];
for (const c of params.constituents) {
  const hit = info.get(code4(c.code));
  if (hit) {
    c.name = hit.name || c.name;
    c.sector = hit.sector || c.sector;
    filled++;
  } else {
    unknown.push(c.code);
  }
}
params._enrichedAt = new Date().toISOString();
writeFileSync(PARAMS_PATH, JSON.stringify(params, null, 2));

console.log(`enriched ${filled}/${params.constituents.length} constituents from J-Quants`);
if (unknown.length) {
  console.log(`WARNING: ${unknown.length} code(s) not found in J-Quants (verify membership): ${unknown.join(', ')}`);
}

// ---- J-Quants helpers -------------------------------------------------------
async function getIdToken() {
  const haveLogin = env.JQUANTS_MAILADDRESS && env.JQUANTS_PASSWORD;
  if (env.JQUANTS_REFRESH_TOKEN) {
    const t = await tryRefresh(env.JQUANTS_REFRESH_TOKEN);
    if (t) return t;
    if (!haveLogin) throw new Error('auth_refresh failed (refresh token expired/invalid?) and no JQUANTS_MAILADDRESS/PASSWORD fallback set.');
  }
  if (haveLogin) {
    const t = await tryRefresh(await authUser());
    if (t) return t;
    throw new Error('auth_refresh failed after auth_user.');
  }
  throw new Error('Set JQUANTS_REFRESH_TOKEN, or JQUANTS_MAILADDRESS + JQUANTS_PASSWORD.');
}

async function tryRefresh(refresh) {
  const r = await fetch(`${JQ}/token/auth_refresh?refreshtoken=${encodeURIComponent(refresh)}`, { method: 'POST' });
  return r.ok ? (await r.json()).idToken : null;
}

async function authUser() {
  const r = await fetch(`${JQ}/token/auth_user`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mailaddress: env.JQUANTS_MAILADDRESS, password: env.JQUANTS_PASSWORD }),
  });
  if (!r.ok) throw new Error(`auth_user ${r.status}`);
  return (await r.json()).refreshToken;
}

async function listedInfoAll(idToken) {
  const map = new Map();
  let key = null;
  do {
    const url = `${JQ}/listed/info` + (key ? `?pagination_key=${encodeURIComponent(key)}` : '');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!r.ok) throw new Error(`listed/info ${r.status}`);
    const j = await r.json();
    for (const it of j.info || []) {
      map.set(code4(it.Code), { name: it.CompanyName, sector: it.Sector33CodeName });
    }
    key = j.pagination_key || null;
  } while (key);
  return map;
}

function code4(code) { return String(code).slice(0, 4); }
