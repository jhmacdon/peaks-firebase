import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  haversineM,
  sampleTrack,
  SpatialIndex,
  RawPointRow,
  collapseOutAndBack,
  buildCheckpoints,
  computeCrossings,
  computeOverlap,
  computeMovingSeconds,
} from "../comparison-geometry";
import * as P from "../comparison-params";

// ~25m of longitude at the equator is 25/111320 degrees.
const DEG_25M = 25 / 111320;

export function straightTrack(opts: {
  n: number;            // number of raw points
  startMs?: number;     // default 0
  stepMs?: number;      // default 30_000 (30s per point)
  spacingDeg?: number;  // default DEG_25M (≈25m at lat 0)
  lat?: number;         // default 0
  startLng?: number;    // default 0
  reverse?: boolean;    // walk east→west instead
}): RawPointRow[] {
  const {
    n, startMs = 0, stepMs = 30_000, spacingDeg = DEG_25M,
    lat = 0, startLng = 0, reverse = false,
  } = opts;
  return Array.from({ length: n }, (_, i) => ({
    time: startMs + i * stepMs,
    lat,
    lng: startLng + (reverse ? -(i * spacingDeg) : i * spacingDeg),
    elevation: 1000 + i,
    speed: 1.0,
  }));
}

test("haversineM: ~111.32km per degree of latitude", () => {
  const d = haversineM(0, 0, 1, 0);
  assert.ok(Math.abs(d - 111_195) < 500, `got ${d}`);
});

test("sampleTrack keeps ≥spacing between samples and computes cumulative meters", () => {
  // 100 raw points ~12.5m apart → ~every other point kept at 25m spacing
  const rows = straightTrack({ n: 100, spacingDeg: DEG_25M / 2 });
  const samples = sampleTrack(rows, 25);
  assert.ok(samples.length < 70 && samples.length > 40, `got ${samples.length}`);
  assert.equal(samples[0].cumM, 0);
  const last = samples[samples.length - 1];
  // total length ≈ 99 * 12.5m ≈ 1237m
  assert.ok(Math.abs(last.cumM - 1237) < 50, `got ${last.cumM}`);
  // strictly increasing cumM
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i].cumM > samples[i - 1].cumM);
  }
  // last raw point always kept
  assert.equal(last.timeMs, rows[rows.length - 1].time);
});

test("SpatialIndex finds a nearby point and rejects a far one", () => {
  const samples = sampleTrack(straightTrack({ n: 50 }), 25);
  const idx = new SpatialIndex(samples, 60);
  assert.ok(idx.near(0, 10 * DEG_25M, 60) !== null);
  assert.equal(idx.near(0.5, 0, 60), null); // ~55km away
});

export function outAndBackTrack(n: number, opts: { startMs?: number; stepMs?: number } = {}): RawPointRow[] {
  const out = straightTrack({ n, ...opts });
  const startMs = opts.startMs ?? 0;
  const stepMs = opts.stepMs ?? 30_000;
  const back = straightTrack({ n, startMs: startMs + n * stepMs, stepMs })
    .map((r, i) => ({ ...r, lng: out[n - 1 - i].lng }));
  return [...out, ...back];
}

test("collapseOutAndBack halves an out-and-back and keeps a one-way intact", () => {
  const onb = sampleTrack(outAndBackTrack(80), P.SAMPLE_SPACING_M);
  const c1 = collapseOutAndBack(onb, P);
  assert.equal(c1.isOutAndBack, true);
  // corridor ≈ half the total traveled distance
  const total = onb[onb.length - 1].cumM;
  assert.ok(Math.abs(c1.lengthM - total / 2) < total * 0.15, `${c1.lengthM} vs ${total}`);

  const oneWay = sampleTrack(straightTrack({ n: 80 }), P.SAMPLE_SPACING_M);
  const c2 = collapseOutAndBack(oneWay, P);
  assert.equal(c2.isOutAndBack, false);
  assert.ok(Math.abs(c2.lengthM - oneWay[oneWay.length - 1].cumM) < 1);
});

test("buildCheckpoints spaces checkpoints along the corridor", () => {
  const samples = sampleTrack(straightTrack({ n: 100 }), P.SAMPLE_SPACING_M);
  const corridor = collapseOutAndBack(samples, P);
  const cps = buildCheckpoints(corridor, 200);
  // ~2475m / 200m ≈ 12-13 checkpoints, first at m=0
  assert.ok(cps.length >= 11 && cps.length <= 14, `got ${cps.length}`);
  assert.equal(cps[0].m, 0);
  for (let i = 1; i < cps.length; i++) {
    assert.ok(Math.abs(cps[i].m - cps[i - 1].m - 200) < 1);
  }
});

function crossingsFor(rows: RawPointRow[], corridorRows: RawPointRow[]) {
  const corridorSamples = sampleTrack(corridorRows, P.SAMPLE_SPACING_M);
  const corridor = collapseOutAndBack(corridorSamples, P);
  const cps = buildCheckpoints(corridor, P.CHECKPOINT_SPACING_M);
  const samples = sampleTrack(rows, P.SAMPLE_SPACING_M);
  return { cps, cross: computeCrossings(samples, cps, P.CROSSING_RADIUS_M), samples };
}

test("out-and-back vs out-and-back: scope=full, elapsed = whole window", () => {
  const a = outAndBackTrack(80);                                  // corridor source
  const b = outAndBackTrack(80, { startMs: 10_000_000 });         // repeat, later
  const { cps, cross: aCross } = crossingsFor(a, a);
  const { cross: bCross } = crossingsFor(b, a);
  const r = computeOverlap(aCross, bCross, cps, P);
  assert.ok(r, "expected an overlap");
  assert.equal(r!.scope, "full");
  assert.equal(r!.a.outAndBack, true);
  assert.equal(r!.b.outAndBack, true);
  // full window: enter at start of range, exit when finally back at entry cp.
  // a: 160 points * 30s ≈ whole hike duration
  const aDur = (r!.a.exitMs - r!.a.enterMs) / 1000;
  assert.ok(aDur > 0.8 * 160 * 30, `aDur=${aDur}`);
});

test("traverse ⊃ out-and-back ridge: mixed topology → scope=outbound", () => {
  // a: out-and-back on the first 80 points of the corridor (EARLIER session)
  const a = outAndBackTrack(80);
  // b: one-way traverse across 160 points — first 80 share a's corridor
  const b = straightTrack({ n: 160, startMs: 10_000_000 });
  const { cps, cross: aCross } = crossingsFor(a, a);
  const { cross: bCross } = crossingsFor(b, a);
  const r = computeOverlap(aCross, bCross, cps, P);
  assert.ok(r, "expected an overlap");
  assert.equal(r!.scope, "outbound");
  assert.equal(r!.a.outAndBack, true);
  assert.equal(r!.b.outAndBack, false);
  // outbound scope: a's window is its ASCENT only (~half its duration)
  const aDur = (r!.a.exitMs - r!.a.enterMs) / 1000;
  assert.ok(aDur < 0.7 * 160 * 30, `aDur=${aDur} should be ~ascent only`);
});

test("reversed direction is rejected", () => {
  const a = straightTrack({ n: 100 });
  const b = straightTrack({ n: 100, startMs: 10_000_000, reverse: true, startLng: 99 * DEG_25M });
  const { cps, cross: aCross } = crossingsFor(a, a);
  const { cross: bCross } = crossingsFor(b, a);
  assert.equal(computeOverlap(aCross, bCross, cps, P), null);
});

test("partial overlap yields the consecutive shared checkpoint range", () => {
  const a = straightTrack({ n: 200 });                            // 200 pts ≈ 5km
  // b covers only the middle: points 60..140 of the same line
  const b = straightTrack({ n: 81, startMs: 10_000_000, startLng: 60 * DEG_25M });
  const { cps, cross: aCross } = crossingsFor(a, a);
  const { cross: bCross } = crossingsFor(b, a);
  const r = computeOverlap(aCross, bCross, cps, P);
  assert.ok(r);
  // shared ≈ 80 pts * 25m ≈ 2000m of corridor
  assert.ok(Math.abs(r!.overlapM - 2000) < 450, `got ${r!.overlapM}`);
  assert.ok(r!.cpStart > 0, "range must not start at corridor start");
});

test("disjoint tracks produce no overlap", () => {
  const a = straightTrack({ n: 100 });
  const b = straightTrack({ n: 100, startMs: 10_000_000, lat: 1 }); // ~111km north
  const { cps, cross: aCross } = crossingsFor(a, a);
  const { cross: bCross } = crossingsFor(b, a);
  assert.equal(computeOverlap(aCross, bCross, cps, P), null);
});

test("computeMovingSeconds excludes stopped stretches and caps gaps", () => {
  const rows = straightTrack({ n: 20 });                 // moving, 30s steps
  // insert a 30-minute stationary gap (same coord, speed 0)
  const stopped: RawPointRow[] = Array.from({ length: 10 }, (_, i) => ({
    time: rows[19].time + (i + 1) * 180_000,
    lat: rows[19].lat, lng: rows[19].lng, elevation: 1000, speed: 0,
  }));
  const moving2 = straightTrack({ n: 20, startMs: stopped[9].time + 30_000, startLng: 19 * DEG_25M });
  const samples = sampleTrack([...rows, ...stopped, ...moving2], P.SAMPLE_SPACING_M);
  const total = (samples[samples.length - 1].timeMs - samples[0].timeMs) / 1000;
  const moving = computeMovingSeconds(samples, samples[0].timeMs, samples[samples.length - 1].timeMs, P);
  assert.ok(moving < total - 1500, `moving=${moving} total=${total} — 30min stop must be excluded`);
});

test("entry dwell before a single-pass hike is not classified out-and-back", () => {
  const a = straightTrack({ n: 200 });
  // b: 2h parked at the corridor start (GPS wander between two spots ~30m
  // apart — within CROSSING_RADIUS_M=60m of cp0 but each step ≥25m so
  // sampleTrack keeps every point instead of collapsing the dwell to one
  // sample), then a single-pass 50-minute walk. Dwell (7200s) intentionally
  // LONGER than the walk (~2970s) so entry.lastMs - entry.firstMs at cp0
  // exceeds half the total span — the exact condition that made the old
  // (pre-fix) heuristic misclassify this as out-and-back.
  const DEG_30M = 30 / 111320;
  const DWELL_START = 10_000_000;
  const dwell: RawPointRow[] = Array.from({ length: 240 }, (_, i) => ({
    time: DWELL_START + i * 30_000,
    lat: 0, lng: i % 2 === 0 ? 0 : DEG_30M, elevation: 1000, speed: 0,
  }));
  const walk = straightTrack({ n: 100, startMs: DWELL_START + 240 * 30_000 });
  const { cps, cross: aCross } = crossingsFor(a, a);
  const { cross: bCross } = crossingsFor([...dwell, ...walk], a);
  const r = computeOverlap(aCross, bCross, cps, P);
  assert.ok(r, "expected an overlap");
  assert.equal(r!.b.outAndBack, false, "entry dwell must not classify as out-and-back");
  assert.equal(r!.scope, "full");
  // b's window must span the traversal, not close at the end of the dwell
  const bDur = (r!.b.exitMs - r!.b.enterMs) / 1000;
  assert.ok(bDur > 0.5 * 100 * 30, `bDur=${bDur} — window must include the walk`);
});
