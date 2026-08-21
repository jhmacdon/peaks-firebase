import assert from "node:assert/strict";
import test from "node:test";
import {
  popularHeroFallbackSql,
  filteredPopularHeroFallbackSql,
  stateHighestSummitSql,
  unclimbedHighestSql,
} from "./search-sql";

// Every catalog-wide query that ranks destinations by raw elevation must
// scope itself to `summit`-featured rows: non-summit destinations can carry
// elevations belonging to a different, much higher namesake (checked live
// 2026-08-20 — six states surfaced a lake or viewpoint above their real high
// point). Dropping the guard from any of these queries reintroduces that bug.

test("popular fallback ranks only summit-featured destinations by elevation", () => {
  const text = popularHeroFallbackSql();
  assert.match(text, /hero_image IS NOT NULL/);
  assert.match(text, /'summit' = ANY\(features\)/);
  assert.match(text, /ORDER BY elevation DESC NULLS LAST/);
});

test("filtered popular fallback keeps the summit guard alongside caller conditions", () => {
  const text = filteredPopularHeroFallbackSql("AND d.state_code = $3", 1, 2);
  assert.match(text, /hero_image IS NOT NULL/);
  assert.match(text, /'summit' = ANY\(d\.features\)/);
  assert.match(text, /ORDER BY d\.elevation DESC NULLS LAST/);
  // caller conditions and parameter positions are interpolated where expected
  assert.match(text, /AND d\.state_code = \$3/);
  assert.match(text, /ANY\(\$1::text\[\]\)/);
  assert.match(text, /LIMIT \$2/);
});

test("state highest-peak fact only considers summit-featured destinations", () => {
  const text = stateHighestSummitSql();
  assert.match(text, /state_code = \$1 AND country_code = 'US'/);
  assert.match(text, /'summit' = ANY\(features\)/);
  assert.match(text, /ORDER BY elevation DESC NULLS LAST/);
  assert.match(text, /LIMIT 1/);
});

test("no-location unclimbed suggestions rank only summits the user hasn't reached", () => {
  const text = unclimbedHighestSql();
  assert.match(text, /d\.id NOT IN \(/);
  assert.match(text, /relation = 'reached'/);
  assert.match(text, /'summit' = ANY\(d\.features\)/);
  assert.match(text, /ORDER BY d\.elevation DESC NULLS LAST/);
});
