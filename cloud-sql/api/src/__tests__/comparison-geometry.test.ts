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
  computeLegSplits,
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

/**
 * A "hooked" out-and-back modeled on Crystal Peak: the outbound leg runs east
 * past the summit's bearing, then hooks back north-west to the turnaround —
 * so the sample geodesically farthest from the trailhead is the corner
 * mid-outbound (40 steps east ≈ 1000m), NOT the turnaround (√(30²+25²) ≈
 * 976m away). Splitting at the corner leaves the whole hook in the "return"
 * half, failing the overlap fraction.
 */
export function hookedOutAndBackTrack(): RawPointRow[] {
  const d = DEG_25M;
  const pts: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i <= 40; i++) pts.push({ lat: 0, lng: i * d });
  for (let i = 1; i <= 30; i++) pts.push({ lat: i * d, lng: (40 - i * 0.5) * d });
  const outbound = [...pts];
  for (let i = outbound.length - 2; i >= 0; i--) pts.push(outbound[i]);
  return pts.map((p, i) => ({ time: i * 30_000, lat: p.lat, lng: p.lng, elevation: 1000, speed: 1 }));
}

test("collapseOutAndBack halves a hooked out-and-back whose farthest point is not the turnaround", () => {
  const samples = sampleTrack(hookedOutAndBackTrack(), P.SAMPLE_SPACING_M);
  const c = collapseOutAndBack(samples, P);
  assert.equal(c.isOutAndBack, true);
  const total = samples[samples.length - 1].cumM;
  assert.ok(Math.abs(c.lengthM - total / 2) < total * 0.15, `${c.lengthM} vs ${total}`);
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

test("computeLegSplits splits an out-and-back at the summit with dwell", () => {
  // Approach/depart at 50m spacing rather than the file's usual 25m: with
  // SUMMIT_DWELL_RADIUS_M=60m and 25m spacing, TWO samples on each side of
  // the apex (not just one) fall within the summit radius, leaking ~120s of
  // ascent/descent into the dwell measurement (measured dwellS=1350 vs the
  // asserted 1200±120 below). At 50m spacing only one sample per side is
  // within 60m, keeping the leak to ~60s total and dwellS inside tolerance.
  const DEG_50M = 50 / 111320;
  const DEG_30M = 30 / 111320;
  const out = straightTrack({ n: 80, spacingDeg: DEG_50M });
  // 20 min dwell at the apex. Points wander ±30m (as in the entry-dwell test
  // above) so sampleTrack's ≥25m spacing threshold keeps them as distinct
  // samples instead of collapsing the whole stationary dwell to one point.
  const apexLng = 79 * DEG_50M;
  const dwell: RawPointRow[] = Array.from({ length: 40 }, (_, i) => ({
    time: out[79].time + (i + 1) * 30_000,
    lat: 0, lng: i % 2 === 0 ? apexLng : apexLng + DEG_30M, elevation: 1079, speed: 0,
  }));
  const back = straightTrack({ n: 80, startMs: dwell[39].time + 30_000 })
    .map((r, i) => ({ ...r, lng: out[79 - i].lng }));
  const samples = sampleTrack([...out, ...dwell, ...back], P.SAMPLE_SPACING_M);
  const window = {
    enterMs: samples[0].timeMs,
    exitMs: samples[samples.length - 1].timeMs,
    startM: 0,
    endM: samples[samples.length - 1].cumM,
    outAndBack: true,
  };
  const legs = computeLegSplits(samples, window, { lat: 0, lng: apexLng }, P);
  assert.ok(legs, "expected splittable");
  // dwell ≈ 40 * 30s = 1200s
  assert.ok(Math.abs(legs!.dwellS - 1200) < 120, `dwell=${legs!.dwellS}`);
  // ascent ≈ descent ≈ 80 * 30s = 2400s
  assert.ok(Math.abs(legs!.ascentS - 2400) < 300, `ascent=${legs!.ascentS}`);
  assert.ok(Math.abs(legs!.descentS - 2400) < 300, `descent=${legs!.descentS}`);
});

test("computeLegSplits returns null when summit is outside the window interior", () => {
  const samples = sampleTrack(straightTrack({ n: 80 }), P.SAMPLE_SPACING_M);
  const window = {
    enterMs: samples[0].timeMs,
    exitMs: samples[samples.length - 1].timeMs,
    startM: 0,
    endM: samples[samples.length - 1].cumM,
    outAndBack: false,
  };
  // summit at the very end of a one-way — inside last 10% → not splittable
  const legs = computeLegSplits(samples, window, { lat: 0, lng: 79 * DEG_25M }, P);
  assert.equal(legs, null);
});

test("computeLegSplits returns null when the track never reaches the summit", () => {
  const samples = sampleTrack(straightTrack({ n: 80 }), P.SAMPLE_SPACING_M);
  const window = {
    enterMs: samples[0].timeMs, exitMs: samples[samples.length - 1].timeMs,
    startM: 0, endM: samples[samples.length - 1].cumM, outAndBack: false,
  };
  assert.equal(computeLegSplits(samples, window, { lat: 0.5, lng: 0 }, P), null);
});

test("far-end-first tracks are rejected despite majority-increasing crossings", () => {
  // b starts AT the corridor's far end, walks down to the start, then hikes
  // the whole corridor up: most adjacent first-crossing pairs increase, but
  // firstMs[cpEnd] < firstMs[cpStart] — the net-forward invariant the window
  // math depends on is violated (prod stored negative windows this way).
  const a = straightTrack({ n: 200 });
  // Brief far-end touch (2 samples at the last coordinate), then a clean
  // full ascent: the inc/dec majority vote sees almost all increasing pairs
  // and passes, so only the net-forward invariant rejects this track.
  const farTouch = straightTrack({ n: 2, startMs: 10_000_000, startLng: 192 * DEG_25M });
  const up = straightTrack({ n: 200, startMs: 10_000_000 + 600_000 });
  const { cps, cross: aCross } = crossingsFor(a, a);
  const { cross: bCross } = crossingsFor([...farTouch, ...up], a);
  assert.equal(computeOverlap(aCross, bCross, cps, P), null);
});
