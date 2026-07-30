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

  // footprint (contribution) == cap weight% and is identical on every frame
  for (const f of frames) {
    const a = f.constituents.find((c) => c.code === 'AAA');
    const b = f.constituents.find((c) => c.code === 'BBB');
    assert.equal(a.contribution, 10);
    assert.equal(b.contribution, 4);
  }
  // frame 0 = day1 vs day0 → AAA +10%
  assert.equal(frames[0].constituents.find((c) => c.code === 'AAA').changePct, 10);
  // frame 1 = day2 vs day1 → AAA -10%
  assert.equal(frames[1].constituents.find((c) => c.code === 'AAA').changePct, -10);
  // ascending dates on the frames
  assert.deepEqual(frames.map((f) => f.asOf), ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25']);
});

test('us buildTimeline (dow): footprint = latest share price, constant across frames', () => {
  const cfg = { constituents: [{ code: 'CCC', name: 'Gamma', sector: 'Ind', priceProxy: 0 }] };
  const dates = [0, 1, 2, 3, 4, 5].map((i) => new Date(Date.UTC(2026, 6, 20 + i)));
  const closes = [200, 202, 198, 198, 210, 220];
  const seriesByCode = new Map([['CCC', dates.map((t, i) => ({ t, c: closes[i] }))]]);
  const { frames } = US.buildTimeline('dow', cfg, seriesByCode, seriesByCode.get('CCC'));
  assert.equal(frames.length, 5);
  for (const f of frames) assert.equal(f.constituents[0].contribution, 220); // latest close
  // frame 0: 202 vs 200 = +1%
  assert.equal(frames[0].constituents[0].changePct, 1);
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

// ---- Nikkei worker: shapeTimeline is pure over daily quote maps -------------
test('nikkei shapeTimeline: fixed footprint (paf×latest close), daily change%', () => {
  // Use a real constituent code from the bundled params so PARAMS lookup hits.
  const CODE = '6857'; // Advantest (4-digit key used internally)
  const mkDay = (dstr, price) => ({ date: new Date(dstr), map: new Map([[CODE, price]]) });
  const days = [
    mkDay('2026-07-22', 100),
    mkDay('2026-07-23', 110), // +10%
    mkDay('2026-07-24', 99),  // -10%
  ];
  const latestMap = new Map([[CODE, 99]]);
  const { frames } = NIKKEI.shapeTimeline(days, latestMap);
  assert.equal(frames.length, 2);

  const pick = (f) => f.constituents.find((c) => String(c.code).startsWith(CODE));
  // change%: frame0 = +10, frame1 = -10
  assert.equal(pick(frames[0]).changePct, 10);
  assert.equal(pick(frames[1]).changePct, -10);
  // footprint identical across frames (paf × 99), and > 0
  const a = pick(frames[0]).contribution, b = pick(frames[1]).contribution;
  assert.equal(a, b);
  assert.ok(a > 0);
  assert.deepEqual(frames.map((f) => f.asOf), ['2026-07-23', '2026-07-24']);
});

test('nikkei shapeTimeline: fewer than 2 days → no frames', () => {
  assert.deepEqual(NIKKEI.shapeTimeline([{ date: new Date(), map: new Map() }], new Map()).frames, []);
});
