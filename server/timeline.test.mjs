// Unit tests for the timeline (last-N-sessions) shapers in both workers.
// Run: node --test server/timeline.test.mjs
//
// These cover the pure logic (daily change% + FIXED footprint) without hitting
// J-Quants / Yahoo. The key invariant: a name's `contribution` (area) is identical
// on every frame (so the treemap layout holds still), while `changePct` reflects
// each day's close-over-close move.

import test from 'node:test';
import assert from 'node:assert/strict';
import { _internals as NIKKEI } from './worker.js';
import { _internals as US } from './us-worker.js';

// ---- US worker: buildTimeline is pure over the fetched series ---------------
test('us buildTimeline (nasdaq): 5 frames, fixed weight footprint, daily change%', () => {
  const cfg = {
    constituents: [
      { code: 'AAA', name: 'Alpha', sector: 'Tech', weight: 10 },
      { code: 'BBB', name: 'Beta', sector: 'Health', weight: 4 },
    ],
  };
  // 6 ascending daily closes → 5 daily frames.
  const dates = [0, 1, 2, 3, 4, 5].map((i) => new Date(Date.UTC(2026, 6, 20 + i)));
  const mk = (vals) => dates.map((t, i) => ({ t, c: vals[i] }));
  const seriesByCode = new Map([
    ['AAA', mk([100, 110, 99, 99, 108, 108])], // +10%, -10%, 0%, +9.09%, 0%
    ['BBB', mk([50, 50, 55, 55, 55, 60])],
  ]);
  const indexSeries = mk([1000, 1010, 1000, 1000, 1005, 1005]);

  const { frames } = US.buildTimeline('nasdaq', cfg, seriesByCode, indexSeries);
  assert.equal(frames.length, 5);

  // footprint (weight%) == cap weight% and is identical on every frame
  for (const f of frames) {
    const a = f.constituents.find((c) => c.code === 'AAA');
    const b = f.constituents.find((c) => c.code === 'BBB');
    assert.equal(a.weight, 10);
    assert.equal(b.weight, 4);
  }
  // frame 0 = day1 vs day0 → AAA +10%
  assert.equal(frames[0].constituents.find((c) => c.code === 'AAA').changePct, 10);
  // frame 1 = day2 vs day1 → AAA -10%
  assert.equal(frames[1].constituents.find((c) => c.code === 'AAA').changePct, -10);
  // ascending dates on the frames
  assert.deepEqual(frames.map((f) => f.asOf), ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25']);
});

test('us buildTimeline (dow): footprint = normalized price weight%, constant across frames', () => {
  const cfg = { constituents: [{ code: 'CCC', name: 'Gamma', sector: 'Ind', priceProxy: 0 }] };
  const dates = [0, 1, 2, 3, 4, 5].map((i) => new Date(Date.UTC(2026, 6, 20 + i)));
  const closes = [200, 202, 198, 198, 210, 220];
  const seriesByCode = new Map([['CCC', dates.map((t, i) => ({ t, c: closes[i] }))]]);
  const { frames } = US.buildTimeline('dow', cfg, seriesByCode, seriesByCode.get('CCC'));
  assert.equal(frames.length, 5);
  for (const f of frames) assert.equal(f.constituents[0].weight, 100); // sole name → 100%
  // frame 0: 202 vs 200 = +1%
  assert.equal(frames[0].constituents[0].changePct, 1);
});

test('us cap-weighted (sensex/nifty): weight footprint + level×weight%×change% 寄与度', () => {
  const cfg = { constituents: [{ code: '500325.BO', name: 'Reliance', sector: 'Energy', weight: 9.6 }] };
  const dates = [0, 1, 2, 3, 4, 5].map((i) => new Date(Date.UTC(2026, 6, 20 + i)));
  const closes = [1000, 1010, 1000, 1000, 1020, 1050]; // latest 1050, 1D base 1020 → +2.94%
  const seriesByCode = new Map([['500325.BO', dates.map((t, i) => ({ t, c: closes[i] }))]]);
  const indexSeries = dates.map((t, i) => ({ t, c: 80000 + i })); // ^BSESN level ≈ 80005

  // timeline footprint (weight%) == cap weight (like nasdaq), constant across frames
  const { frames } = US.buildTimeline('sensex', cfg, seriesByCode, indexSeries);
  assert.equal(frames.length, 5);
  for (const f of frames) assert.equal(f.constituents[0].weight, 9.6);

  // shapePeriod (1D): area = weight%, height/color = change%, contribution (volume)
  // = level × weight% × change%.
  const level = 80005;
  const period = US.shapePeriod('sensex', cfg, seriesByCode, {
    p: '1D', baseDate: dates[4], latest: dates[5], divisor: 1, indexLevel: level,
  });
  const c = period.constituents[0];
  assert.equal(c.weight, 9.6); // area source
  const expChange = ((1050 - 1020) / 1020) * 100;
  assert.ok(Math.abs(c.changePct - Math.round(expChange * 100) / 100) < 1e-9);
  const expContrib = level * (9.6 / 100) * (expChange / 100);
  assert.ok(Math.abs(c.contribution - Math.round(expContrib * 100) / 100) < 1e-9);
});

test('us weightSnapshot (dow): price share of Σ latest close, as a percent', () => {
  const cfg = { constituents: [
    { code: 'A', name: 'A', sector: 's' },
    { code: 'B', name: 'B', sector: 's' },
  ] };
  const d = (i) => new Date(Date.UTC(2026, 6, 20 + i));
  const seriesByCode = new Map([
    ['A', [d(0), d(1)].map((t, i) => ({ t, c: [90, 300][i] }))], // latest 300
    ['B', [d(0), d(1)].map((t, i) => ({ t, c: [80, 100][i] }))], // latest 100
  ]);
  const map = US.weightSnapshot('dow', cfg, seriesByCode); // total 400
  assert.ok(Math.abs(map.get('A') - 75) < 1e-9);  // 300/400
  assert.ok(Math.abs(map.get('B') - 25) < 1e-9);  // 100/400
});

test('us capWeightMap: weights track price move since ref date, renormalized to 100', () => {
  const cfg = { constituents: [
    { code: 'A', name: 'A', sector: 's', weight: 10 },
    { code: 'B', name: 'B', sector: 's', weight: 4 },
  ] };
  const d = (i) => new Date(Date.UTC(2026, 6, 20 + i));
  const seriesByCode = new Map([
    ['A', [d(0), d(1), d(2), d(3)].map((t, i) => ({ t, c: [90, 100, 150, 200][i] }))], // ref@d1=100, now=200 → ×2
    ['B', [d(0), d(1), d(2), d(3)].map((t, i) => ({ t, c: [50, 50, 50, 50][i] }))],     // unchanged → ×1
  ]);
  const map = US.capWeightMap(cfg, seriesByCode, d(1));
  // raw scaled: A=20, B=4 → total 24 → A=83.33.., B=16.66..
  assert.ok(Math.abs(map.get('A') - (20 / 24) * 100) < 1e-9);
  assert.ok(Math.abs(map.get('B') - (4 / 24) * 100) < 1e-9);
  assert.ok(Math.abs((map.get('A') + map.get('B')) - 100) < 1e-9); // sums to 100
});

test('us capWeightMap: no ref date → static weights, just renormalized', () => {
  const cfg = { constituents: [
    { code: 'A', name: 'A', sector: 's', weight: 30 },
    { code: 'B', name: 'B', sector: 's', weight: 10 },
  ] };
  const map = US.capWeightMap(cfg, new Map(), null);
  assert.ok(Math.abs(map.get('A') - 75) < 1e-9); // 30/40
  assert.ok(Math.abs(map.get('B') - 25) < 1e-9); // 10/40
});

test('us buildTimeline: too-short series → no frames', () => {
  const cfg = { constituents: [{ code: 'X', name: 'x', sector: 's', weight: 1 }] };
  const one = new Map([['X', [{ t: new Date(), c: 5 }]]]);
  assert.deepEqual(US.buildTimeline('nasdaq', cfg, one, one.get('X')).frames, []);
});

// ---- US worker: spark payload parsing (batched multi-symbol fetch) ----------
test('us parseSpark: multiple symbols → sorted close series per symbol', () => {
  const payload = {
    spark: {
      result: [
        {
          symbol: 'AAA',
          response: [{
            timestamp: [1000, 2000, 3000],
            indicators: { quote: [{ close: [10, null, 12] }] }, // null gap dropped
          }],
        },
        {
          // symbol taken from meta when the top-level field is absent
          response: [{
            meta: { symbol: 'BBB' },
            timestamp: [3000, 1000], // out of order → sorted ascending
            indicators: { quote: [{ close: [22, 20] }] },
          }],
        },
        { symbol: 'CCC', response: [{}] }, // malformed → skipped
      ],
    },
  };
  const map = US.parseSpark(payload);
  assert.deepEqual(map.get('AAA').map((p) => p.c), [10, 12]);
  const bbb = map.get('BBB');
  assert.deepEqual(bbb.map((p) => p.c), [20, 22]);
  assert.ok(bbb[0].t < bbb[1].t); // ascending by date
  assert.equal(map.has('CCC'), false);
});

test('us parseSpark: junk payload → empty map', () => {
  assert.equal(US.parseSpark({}).size, 0);
  assert.equal(US.parseSpark({ spark: { result: null } }).size, 0);
});

// ---- Nikkei worker: series-based shapers (per-code continuous series) --------
// The refactor fetches one adjusted series per constituent so latest and base
// share a single adjustment basis (no cross-snapshot split leak). These cover the
// pure shaping over that series. Codes are real bundled-params codes so PARAMS hits.
test('nikkei buildTimeline: fixed footprint (paf×latest close), daily change%', () => {
  const dates = [0, 1, 2, 3, 4, 5].map((i) => new Date(Date.UTC(2026, 6, 20 + i)));
  const mk = (vals) => dates.map((t, i) => ({ t, c: vals[i] }));
  const seriesByCode = new Map([
    ['6857', mk([100, 110, 99, 99, 108, 108])], // +10%, -10%, 0%, +9.09%, 0%
    ['8035', mk([50, 50, 55, 55, 55, 60])],
  ]);
  const { frames } = NIKKEI.buildTimeline(seriesByCode);
  assert.equal(frames.length, 5);

  const pick = (f, code) => f.constituents.find((c) => c.code === code);
  // frame 0 = day1 vs day0 → 6857 +10%; frame 1 = day2 vs day1 → 6857 −10%.
  assert.equal(pick(frames[0], '6857').changePct, 10);
  assert.equal(pick(frames[1], '6857').changePct, -10);
  // footprint (weight%) identical across every frame, and > 0.
  const a = pick(frames[0], '6857').weight, b = pick(frames[1], '6857').weight;
  assert.equal(a, b);
  assert.ok(a > 0);
  assert.deepEqual(frames.map((f) => f.asOf), ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25']);
});

test('nikkei weightSnapshot: paf×close share of Σ, as a percent summing ~100', () => {
  const d = (i) => new Date(Date.UTC(2026, 6, 20 + i));
  const mk = (vals) => [d(0), d(1)].map((t, i) => ({ t, c: vals[i] }));
  const seriesByCode = new Map([['6857', mk([90, 100])], ['8035', mk([90, 100])]]);
  const map = NIKKEI.weightSnapshot(seriesByCode);
  const a = map.get('6857'), b = map.get('8035');
  assert.ok(a > 0 && b > 0);
  // only these two names have a series, so their weights sum to 100.
  assert.ok(Math.abs(a + b - 100) < 1e-9);
});

test('nikkei shapePeriod (1D): change from the same series (split-safe, no basis leak)', () => {
  const d = (i) => new Date(Date.UTC(2026, 6, 20 + i));
  // ANA-like: latest 3163 vs prev 3200 → −1.16% — NOT the spurious −33.95% a
  // cross-snapshot adjustment-basis mismatch produced (prev day at 4789).
  const seriesByCode = new Map([['9202', [d(0), d(1), d(2)].map((t, i) => ({ t, c: [3100, 3200, 3163][i] }))]]);
  const periods = NIKKEI.shapeAllPeriods(seriesByCode);
  const c = periods['1D'].constituents.find((x) => x.code === '9202');
  const exp = ((3163 - 3200) / 3200) * 100;
  assert.ok(Math.abs(c.changePct - Math.round(exp * 100) / 100) < 1e-9);
  assert.ok(c.weight > 0); // sole name with a series → 100%
  assert.equal(c.nameEn, 'ANA HOLDINGS'); // English name flows through
});

test('nikkei buildTimeline: too-short series → no frames', () => {
  const one = new Map([['6857', [{ t: new Date(), c: 5 }]]]);
  assert.deepEqual(NIKKEI.buildTimeline(one).frames, []);
});
