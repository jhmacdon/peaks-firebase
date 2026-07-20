import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  haversineM,
  sampleTrack,
  SpatialIndex,
  RawPointRow,
  collapseOutAndBack,
  buildCheckpoints,
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
