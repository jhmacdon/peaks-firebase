import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildComparisonCandidateSql,
  buildCommonSummitSql,
  buildComparisonUpsertSql,
  buildPrunePairsSql,
  ComparisonRow,
} from "../comparisons";
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
