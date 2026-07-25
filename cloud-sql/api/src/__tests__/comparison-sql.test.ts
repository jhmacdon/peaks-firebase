import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildComparisonCandidateSql,
  buildCompleteRouteEffortCurves,
  buildCompleteSummitRouteModel,
  buildCommonSummitSql,
  buildComparisonUpsertSql,
  buildEffortCurves,
  buildPairModel,
  buildPrunePairsSql,
  ComparisonRow,
  matchComparisons,
  orientComparison,
  Queryable,
  shapeComparisonList,
} from "../comparisons";
import { RawPointRow, sampleTrack as st2 } from "../comparison-geometry";
import * as P from "../comparison-params";

test("candidate SQL is planar-prefiltered, user-scoped, ended-only, capped", () => {
  const { text, values } = buildComparisonCandidateSql("sess1", "user1");
  assert.match(text, /s2\.user_id = \$2/);
  assert.match(text, /s2\.ended = true/);
  assert.match(text, /s2\.path IS NOT NULL/);
  // Planar prefilter only — an exact geography line-line ST_DWithin here would
  // repeat the route-candidate 30s-timeout bug.
  assert.match(text, /ST_Expand\(s1\.path::geometry, 0\.005\)/);
  assert.doesNotMatch(text, /ST_DWithin\(s2\.path, s1\.path/);
  assert.match(text, new RegExp(`LIMIT ${P.MAX_CANDIDATES_PER_RUN}`));
  assert.deepEqual(values, ["sess1", "user1"]);
});

test("common-summit SQL requires reached summits shared by both sessions", () => {
  const { text, values } = buildCommonSummitSql("a1", "b1");
  assert.match(text, /'summit'::destination_feature = ANY\(d\.features\)/);
  assert.match(text, /relation = 'reached'/);
  assert.match(text, /ORDER BY d\.elevation DESC NULLS LAST/);
  assert.deepEqual(values, ["a1", "b1"]);
});

function fakeRow(): ComparisonRow {
  return {
    user_id: "u", session_a: "a", session_b: "b", scope: "full",
    overlap_m: 1000, a_frac: 0.95, b_frac: 0.9,
    a_enter_ms: 1, a_exit_ms: 2, b_enter_ms: 3, b_exit_ms: 4,
    a_start_m: 0, a_end_m: 1000, b_start_m: 0, b_end_m: 1000,
    a_out_and_back: true, b_out_and_back: true,
    a_elapsed_s: 100, b_elapsed_s: 90, a_moving_s: 80, b_moving_s: 70,
    summit_destination_id: null,
    a_arrival_ms: null, a_departure_ms: null, b_arrival_ms: null, b_departure_ms: null,
    a_ascent_s: null, a_dwell_s: null, a_descent_s: null,
    b_ascent_s: null, b_dwell_s: null, b_descent_s: null,
    matcher_version: P.MATCHER_VERSION, legs_version: P.LEGS_VERSION,
  };
}

test("upsert SQL targets the pair PK and updates on conflict", () => {
  const { text, values } = buildComparisonUpsertSql(fakeRow());
  assert.match(text, /INSERT INTO session_comparisons/);
  assert.match(text, /ON CONFLICT \(session_a, session_b\) DO UPDATE/);
  assert.equal(values.length, 32);
});

test("prune SQL keeps the top pairs by overlap for a session", () => {
  const { text, values } = buildPrunePairsSql("sess1");
  assert.match(text, /ORDER BY overlap_m DESC/);
  assert.match(text, new RegExp(`LIMIT ${P.MAX_PAIRS_PER_SESSION}`));
  assert.deepEqual(values, ["sess1"]);
});

test("matchComparisons prunes both sides of each written pair", async () => {
  const queries: string[] = [];
  const pruneValues: unknown[][] = [];
  const t0 = Date.parse("2026-05-01T08:00:00Z");
  // ~3km straight track, 25m/30s per point, timestamps in ms. Identical rows
  // for both sessions guarantee a full-length overlap well above MIN_OVERLAP_M.
  const mkRows = (startMs: number) =>
    Array.from({ length: 120 }, (_, i) => ({
      time: startMs + i * 30_000,
      lat: 0,
      lng: (i * 25) / 111_320,
      elevation: 1000,
      speed: 1,
    }));

  const fake: Queryable = {
    query: async (text: string, _values?: unknown[]) => {
      queries.push(text);
      if (text.includes("FROM tracking_sessions WHERE id = $1")) {
        // self session ("new") is the later of the two
        return { rows: [{ id: "new", start_time: new Date(t0 + 86_400_000) }], rowCount: 1 };
      }
      if (text.includes("ST_Expand")) {
        // single candidate ("old"), earlier start
        return { rows: [{ id: "old", start_time: new Date(t0) }], rowCount: 1 };
      }
      if (text.includes("FROM tracking_points")) {
        // loadSampledTrack is called for both sessions; identical rows are
        // fine and guarantee overlap.
        return { rows: mkRows(t0), rowCount: 120 };
      }
      if (text.includes("session_destinations")) {
        // no common reached summit
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("INSERT INTO session_comparisons")) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("DELETE FROM session_comparisons")) {
        pruneValues.push(_values ?? []);
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected query in fake: ${text}`);
    },
  };

  const written = await matchComparisons(fake, "new", "user1");

  assert.equal(written, 1);

  const pruneQueries = queries.filter((t) => t.includes("DELETE FROM session_comparisons"));
  assert.equal(pruneQueries.length, 2);
  assert.deepEqual(pruneValues, [["new"], ["old"]]);
});

function dbRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    user_id: "u", session_a: "earlier", session_b: "later", scope: "full",
    overlap_m: 4000, a_frac: 1, b_frac: 1,
    a_enter_ms: 0, a_exit_ms: 7_200_000, b_enter_ms: 0, b_exit_ms: 6_000_000,
    a_start_m: 0, a_end_m: 8000, b_start_m: 0, b_end_m: 8000,
    a_out_and_back: true, b_out_and_back: true,
    a_elapsed_s: 7200, b_elapsed_s: 6000, a_moving_s: 6800, b_moving_s: 5800,
    summit_destination_id: null,
    a_arrival_ms: null, a_departure_ms: null, b_arrival_ms: null, b_departure_ms: null,
    a_ascent_s: null, a_dwell_s: null, a_descent_s: null,
    b_ascent_s: null, b_dwell_s: null, b_descent_s: null,
    other_id: "earlier", other_name: "First try", other_start_time: "2026-05-01T08:00:00Z",
    other_distance: 8000, other_total_time: 7200,
    ...over,
  };
}

test("orientComparison maps sides relative to the viewed session", () => {
  const o = orientComparison(dbRow(), "later"); // viewing the b side
  assert.equal(o.this.elapsed_s, 6000);
  assert.equal(o.other.elapsed_s, 7200);
  assert.equal(o.delta_s, 6000 - 7200);
  assert.equal(o.session.id, "earlier");
});

test("shapeComparisonList caps, keeps the PB, flags is_pb on min other elapsed", () => {
  const rows = Array.from({ length: 15 }, (_, i) =>
    dbRow({
      session_a: `old${i}`, other_id: `old${i}`,
      a_elapsed_s: 7000 + i * 10,
      other_start_time: `2026-0${(i % 5) + 1}-01T08:00:00Z`,
    })
  );
  // make the OLDEST row the PB so a naive newest-first cap would drop it
  rows[0].a_elapsed_s = 3000;
  rows[0].other_start_time = "2025-01-01T08:00:00Z";
  const shaped = shapeComparisonList(rows, "later", 10);
  assert.equal(shaped.length, 10);
  const pbs = shaped.filter((s) => s.is_pb);
  assert.equal(pbs.length, 1);
  assert.equal(pbs[0].session.id, "old0");
});

test("shapeComparisonList PB tiebreak on equal other.elapsed_s picks the earlier start_time, regardless of row order", () => {
  const rowEarly = dbRow({
    session_a: "early", other_id: "early",
    a_elapsed_s: 5000, // tie: identical to rowLate's a_elapsed_s
    other_start_time: "2026-01-01T08:00:00Z",
  });
  const rowLate = dbRow({
    session_a: "late", other_id: "late",
    a_elapsed_s: 5000, // tie: identical to rowEarly's a_elapsed_s
    other_start_time: "2026-02-01T08:00:00Z",
  });

  const forward = shapeComparisonList([rowEarly, rowLate], "later", 10);
  const forwardPb = forward.find((c) => c.is_pb);
  assert.equal(forwardPb?.session.id, "early");

  const reversed = shapeComparisonList([rowLate, rowEarly], "later", 10);
  const reversedPb = reversed.find((c) => c.is_pb);
  assert.equal(reversedPb?.session.id, "early");
});

test("shapeComparisonList never calls a partial turnaround the best time", () => {
  const partial = dbRow({
    session_a: "turnaround", other_id: "turnaround",
    a_elapsed_s: 1800,
    a_frac: 1,
    b_frac: 0.4,
    other_start_time: "2026-02-01T08:00:00Z",
  });
  const complete = dbRow({
    session_a: "complete", other_id: "complete",
    a_elapsed_s: 7200,
    a_frac: 1,
    b_frac: 1,
    other_start_time: "2026-01-01T08:00:00Z",
  });

  const shaped = shapeComparisonList([partial, complete], "later", 10);
  assert.equal(shaped.find((comparison) => comparison.is_pb)?.session.id, "complete");
  assert.equal(shaped.find((comparison) => comparison.session.id === "turnaround")?.is_pb, false);
});

test("shapeComparisonList has no best-time marker when every match is partial", () => {
  const shaped = shapeComparisonList([
    dbRow({ session_a: "partial", other_id: "partial", a_frac: 1, b_frac: 0.4 }),
  ], "later", 10);
  assert.equal(shaped.some((comparison) => comparison.is_pb), false);
});

test("partial closed-route pairs stop at the final shared outbound checkpoint", () => {
  const outAndBack = (n: number, startMs: number) => {
    const outbound: RawPointRow[] = Array.from({ length: n }, (_, i) => ({
      time: startMs + i * 30_000,
      lat: 0,
      lng: i * (25 / 111320),
      elevation: 1000 + i,
      speed: 1,
    }));
    const returning = outbound.slice(0, -1).reverse().map((point, i) => ({
      ...point,
      time: startMs + (n + i) * 30_000,
    }));
    return st2([...outbound, ...returning], P.SAMPLE_SPACING_M);
  };

  const longRoute = outAndBack(200, 0);
  const turnaround = outAndBack(80, 20_000_000);
  const model = buildPairModel(longRoute, turnaround);
  assert.ok(model);
  assert.equal(model!.overlap.scope, "outbound");
  assert.equal(model!.overlap.a.outAndBack, true);
  assert.equal(model!.overlap.b.outAndBack, true);
  assert.equal(model!.overlap.a.exitMs, model!.aCross[model!.overlap.cpEnd]!.firstMs);
  assert.equal(model!.overlap.b.exitMs, model!.bCross[model!.overlap.cpEnd]!.firstMs);
});

test("complete same-summit loops can use different ascent and descent lines", () => {
  const d = 25 / 111320;
  const branch = (side: number, startMs: number): RawPointRow[] => {
    const up = Array.from({ length: 81 }, (_, i) => ({
      time: startMs + i * 30_000,
      lat: i * d,
      lng: Math.sin(Math.PI * i / 80) * side * 5 * d,
      elevation: 1000 + i * 10,
      speed: 1,
    }));
    const down = Array.from({ length: 80 }, (_, i) => ({
      time: startMs + (81 + i) * 30_000,
      lat: (79 - i) * d,
      lng: Math.sin(Math.PI * (79 - i) / 80) * -side * 5 * d,
      elevation: 1000 + (79 - i) * 10,
      speed: 1,
    }));
    return [...up, ...down];
  };
  const a = st2(branch(-1, 0), P.SAMPLE_SPACING_M);
  const b = st2(branch(1, 20_000_000), P.SAMPLE_SPACING_M);
  const summit = { lat: 80 * d, lng: 0 };

  const complete = buildCompleteSummitRouteModel(a, b, summit);
  assert.ok(complete);
  assert.equal(complete!.a.enterMs, a[0].timeMs);
  assert.equal(complete!.a.exitMs, a[a.length - 1].timeMs);
  assert.equal(complete!.b.enterMs, b[0].timeMs);
  assert.equal(complete!.b.exitMs, b[b.length - 1].timeMs);
});

test("complete-route curves preserve each divergent route's own distance", () => {
  const track = (lngStep: number, startMs: number) => st2(
    Array.from({ length: 8 }, (_, i) => ({
      time: startMs + i * 60_000,
      lat: i * (25 / 111320),
      lng: i * lngStep,
      elevation: 1000 + i * 20,
      speed: 1,
    })),
    P.SAMPLE_SPACING_M
  );
  const a = track(0, 0);
  const b = track(20 / 111320, 1_000_000);
  const aWindow = {
    enterMs: a[0].timeMs,
    exitMs: a[a.length - 1].timeMs,
    startM: a[0].cumM,
    endM: a[a.length - 1].cumM,
    outAndBack: false,
  };
  const bWindow = {
    enterMs: b[0].timeMs,
    exitMs: b[b.length - 1].timeMs,
    startM: b[0].cumM,
    endM: b[b.length - 1].cumM,
    outAndBack: false,
  };

  const curves = buildCompleteRouteEffortCurves(a, b, aWindow, bWindow, 4);
  assert.equal(curves.stations.length, 5);
  assert.equal(curves.stations[0].a_m, 0);
  assert.equal(curves.stations[0].b_m, 0);
  assert.ok(curves.stations[4].a_m! > 0);
  assert.ok(curves.stations[4].b_m! > curves.stations[4].a_m!);
  for (let i = 1; i < curves.stations.length; i++) {
    assert.ok(curves.stations[i].a_s >= curves.stations[i - 1].a_s);
    assert.ok(curves.stations[i].b_s >= curves.stations[i - 1].b_s);
  }
});

test("buildEffortCurves produces monotonic per-station times from range start", () => {
  const mk = (startMs: number, slow: boolean) =>
    st2(
      Array.from({ length: 200 }, (_, i) => ({
        time: startMs + i * (slow ? 40_000 : 30_000),
        lat: 0, lng: i * (25 / 111320), elevation: 1000 + i, speed: 1,
      })),
      25
    );
  const model = buildPairModel(mk(0, false), mk(10_000_000, true));
  assert.ok(model);
  const curves = buildEffortCurves(model!);
  assert.ok(curves.stations.length >= 10, `got ${curves.stations.length}`);
  assert.equal(curves.stations[0].m, 0);
  for (let i = 1; i < curves.stations.length; i++) {
    assert.ok(curves.stations[i].a_s >= curves.stations[i - 1].a_s);
    assert.ok(curves.stations[i].b_s >= curves.stations[i - 1].b_s);
  }
  // b is slower at every later station
  const last = curves.stations[curves.stations.length - 1];
  assert.ok(last.b_s > last.a_s);
});

test("buildEffortCurves continues through the return leg for full out-and-back pairs", () => {
  const mk = (startMs: number, stepMs: number) => {
    const outbound = Array.from({ length: 120 }, (_, i) => ({
      time: startMs + i * stepMs,
      lat: 0, lng: i * (25 / 111320), elevation: 1000 + i, speed: 1,
    }));
    const returning = outbound.slice(0, -1).reverse().map((point, i) => ({
      ...point,
      time: startMs + (outbound.length + i) * stepMs,
    }));
    return st2([...outbound, ...returning], 25);
  };

  const model = buildPairModel(mk(0, 30_000), mk(10_000_000, 40_000));
  assert.ok(model);
  assert.equal(model!.overlap.scope, "full");
  assert.equal(model!.overlap.a.outAndBack, true);
  assert.equal(model!.overlap.b.outAndBack, true);

  const curves = buildEffortCurves(model!);
  const last = curves.stations[curves.stations.length - 1];
  assert.ok(last.m > model!.overlap.overlapM,
    `return station ${last.m} should extend past outbound ${model!.overlap.overlapM}`);
  assert.ok(last.a_s > curves.stations[Math.floor(curves.stations.length / 2)].a_s);
  assert.ok(last.b_s > curves.stations[Math.floor(curves.stations.length / 2)].b_s);
});
