import assert from "node:assert/strict";
import test from "node:test";
import type { ListDestination } from "./actions/lists";
import { filterListRoster } from "./list-roster-filter";
const places = [
  { id: "a", name: "Rainier", elevation: 4392, ordinal: 2, state_code: "WA", country_code: "US" },
  { id: "b", name: "Baker", elevation: 3286, ordinal: 1, state_code: "WA", country_code: "US" },
  { id: "c", name: "Unknown elevation", elevation: null, ordinal: 3, state_code: "OR", country_code: "US" },
] as ListDestination[];
test("not-yet filter combines with search and keeps unknown elevation last", () => {
  const result = filterListRoster(places, { query: "US", status: "remaining", sort: "elevation", entries: { a: { reached_at: null, visit_count: 1 } } });
  assert.deepEqual(result.map((place) => place.id), ["b", "c"]);
  assert.deepEqual(places.map((place) => place.id), ["a", "b", "c"]);
});
test("unavailable personal progress never claims a place is unreached", () => {
  assert.equal(filterListRoster(places, { query: "wa", status: "remaining", sort: "name", entries: null }).length, 2);
});

test("region search accepts full state and country names as well as stored codes", () => {
  for (const query of ["Washington", "wa", " WASHINGTON "]) {
    const result = filterListRoster(places, { query, status: "all", sort: "name", entries: null });
    assert.deepEqual(result.map((place) => place.id), ["b", "a"]);
  }
  const byCountry = filterListRoster(places, { query: "United States", status: "all", sort: "list", entries: null });
  assert.equal(byCountry.length, 3);
  const byOregon = filterListRoster(places, { query: "Oregon", status: "all", sort: "list", entries: null });
  assert.deepEqual(byOregon.map((place) => place.id), ["c"]);
});
