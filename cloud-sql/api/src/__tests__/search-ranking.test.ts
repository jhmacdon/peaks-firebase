import { strict as assert } from "node:assert";
import { test } from "node:test";
import { rankSearchResults, SearchBuckets, summarizeSearchResults } from "../lib/search-ranking";

test("a destination hike ranks above its own objective without boosting summit routes", () => {
  const buckets: SearchBuckets = {
    destinations: [
      { id: "lake", name: "Ingalls Lake", score: 0.7 },
      { id: "peak", name: "Ingalls Peak", score: 0.7 },
    ],
    routes: [
      { id: "hike", name: "Ingalls Lake via Ingalls Way", kind: "destination", objective_destination_id: "lake", score: 0.6 },
      { id: "climb", name: "Ingalls Peak South Ridge", kind: "summit", objective_destination_id: "peak", score: 0.6 },
    ],
    areas: [], lists: [],
  };
  const results = rankSearchResults(buckets, 20);
  assert.equal(results[0].id, "hike");
  assert.ok(results.findIndex((r) => r.id === "peak") < results.findIndex((r) => r.id === "climb"));
  assert.equal(buckets.routes[0].score, 0.6, "ranking must not alter legacy buckets");
});

test("unified results apply one limit, preserve payloads, and sort ties without bucket order", () => {
  const lake = { id: "lake", name: "Lake Serene", type: "point", score: 0.8 };
  const results = rankSearchResults({
    destinations: [lake],
    routes: [{ id: "r", name: "A Trail", score: 0.8 }],
    areas: [{ id: "a", name: "A Wilderness", score: 0.8 }],
    lists: [{ id: "l", name: "Lake Hikes", score: 0.9 }],
  }, 3);
  assert.deepEqual(results.map((r) => r.type), ["list", "route", "area"]);
  const destination = rankSearchResults({ destinations: [lake], routes: [], areas: [], lists: [] }, 1)[0];
  assert.equal(destination.type, "destination");
  assert.equal(destination.data.type, "point");
  assert.equal(destination.data, lake);
});

test("an exact summit query keeps its peak above a popular route while a route-name query keeps the route first", () => {
  const peak = { id: "si", name: "Mount Si", score: 0.85, name_exact_match: true };
  const trail = { id: "si-trail", name: "Mount Si Trail", kind: "summit", objective_destination_id: "si", score: 0.95 };
  assert.equal(rankSearchResults({ destinations: [peak], routes: [trail], areas: [], lists: [] }, 20)[0].id, "si");
  assert.equal(rankSearchResults({ destinations: [{ ...peak, name_exact_match: false, score: 0.6 }], routes: [trail], areas: [], lists: [] }, 20)[0].id, "si-trail");
});

test("scores stay finite and within zero to one", () => {
  const results = rankSearchResults({
    destinations: [{ id: "a", score: "NaN" }, { id: "b", score: 5 }],
    routes: [{ id: "r", kind: "destination", objective_destination_id: "b", score: -3 }],
    areas: [], lists: [],
  }, 20);
  assert.ok(results.every((r) => Number.isFinite(r.score) && r.score >= 0 && r.score <= 1));
});

test("a broad place prefix ranks its summit before a route matching a shorter shared trail name", () => {
  const peak = { id: "peak", name: "Ingalls Peak", features: ["summit"], score: 0.566, name_prefix_match: true };
  const lake = { id: "lake", name: "Ingalls Lake", features: ["lake"], score: 0.566, name_prefix_match: true };
  const hike = { id: "hike", name: "Ingalls Lake via Ingalls Way", kind: "destination", objective_destination_id: "lake", score: 0.6 };
  const climb = { id: "climb", name: "Ingalls Peak South Ridge", kind: "summit", objective_destination_id: "peak", score: 0.6 };
  const buckets = { destinations: [peak, lake], routes: [climb, hike], areas: [], lists: [] };
  assert.deepEqual(rankSearchResults(buckets, 20).map((r) => r.id), ["hike", "peak", "lake", "climb"]);
  assert.equal(rankSearchResults({ ...buckets, routes: [{ ...climb, term_exact_match: true }] }, 20)[0].id, "climb");
});

test("ranked results carry a small summary, never the bucket row's geometry", () => {
  const route = { id: "r", name: "Ingalls Lake", kind: "destination", polyline6: "abc", areas: [], score: 0.9 };
  const lake = { id: "lake", name: "Ingalls Lake", type: "point", features: ["lake"], score: 0.8 };
  const [first, second] = summarizeSearchResults(rankSearchResults({ destinations: [lake], routes: [route], areas: [], lists: [] }, 5));
  assert.deepEqual(first.data, { name: "Ingalls Lake", kind: "destination" });
  assert.deepEqual(second.data, { name: "Ingalls Lake", type: "point", features: ["lake"] });
  assert.equal(route.polyline6, "abc", "the bucket row keeps its geometry");
});
