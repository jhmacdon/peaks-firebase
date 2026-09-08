import assert from "node:assert/strict";
import test from "node:test";
import { catalogHref, hasCatalogSelection, parseCatalogFilters, parseCatalogSelection } from "./catalog-search";
import { catalogSearchSql } from "./catalog-search-sql";
import { DEFAULT_MAP_TYPES, mapExploreHref, parseMapExploreUrl } from "./map-view";

test("a chosen region works without a text query or a location prompt", () => {
  const filters = parseCatalogFilters("state=wa&type=routes&maxDistance=10&maxGain=2000");
  assert.equal(filters.state, "WA");
  assert.equal(filters.scope, "routes");
  assert.equal(filters.maxDistance, 10);
  assert.equal(filters.maxGain, 2000);
  assert.equal(filters.nearLat, null);
  assert.equal(hasCatalogSelection(filters), true);
  assert.equal(hasCatalogSelection(parseCatalogFilters("")), false);
});

test("untrusted filters cannot select an unknown scope, sort, state, or negative page", () => {
  const filters = parseCatalogFilters("type=__proto__&sort=constructor&state=DROP&activity=bad&difficulty=bad&page=-5&maxGain=Infinity&maxDistance=-4");
  assert.equal(filters.scope, "all");
  assert.equal(filters.sort, "relevance");
  assert.equal(filters.state, "");
  assert.equal(filters.activity, "");
  assert.equal(filters.difficulty, "");
  assert.equal(filters.page, 1);
  assert.equal(filters.maxDistance, null);
  assert.equal(filters.maxGain, null);
  assert.equal(parseCatalogFilters("page=0.5").page, 1);
  assert.equal(parseCatalogFilters("page=2.9").page, 2);
});

test("nearby search requires a complete valid coordinate pair and accepts the equator", () => {
  assert.equal(parseCatalogFilters("nearLat=47").nearLat, null);
  assert.equal(parseCatalogFilters("nearLat=47&nearLng=181").nearLat, null);
  assert.equal(parseCatalogFilters("nearLat=NaN&nearLng=-120").nearLng, null);
  assert.equal(parseCatalogFilters("nearLat=0&nearLng=0").nearLat, 0);
  assert.equal(hasCatalogSelection(parseCatalogFilters("nearLat=0&nearLng=0")), true);
});

test("filter changes reset the page but switching to a selected map result keeps it", () => {
  const current = "q=Rainier&state=WA&type=routes&page=2";
  assert.equal(new URLSearchParams(catalogHref("/discover", current, {state:"CA"}).split("?")[1]).get("page"), null);
  const href = catalogHref("/map", current, {selected:"routes:camp-muir",lat:46.8,lng:-121.7,z:12});
  const params = new URLSearchParams(href.split("?")[1]);
  assert.equal(params.get("page"), "2");
  assert.equal(params.get("selected"), "routes:camp-muir");
  assert.equal(params.get("state"), "WA");
});

test("changing from route filters to parks removes route-only constraints", () => {
  const href = catalogHref("/discover", "state=WA&type=routes&maxDistance=5&maxGain=1000&difficulty=easy&activity=hiking&page=3", {type:"areas"});
  const filters = parseCatalogFilters(href.split("?")[1]);
  assert.equal(filters.scope, "areas");
  assert.equal(filters.state, "WA");
  assert.equal(filters.activity, "hiking");
  assert.equal(filters.maxDistance, null);
  assert.equal(filters.maxGain, null);
  assert.equal(filters.difficulty, "");
  assert.equal(filters.page, 1);
});

test("map panning retains the selected area, query, chosen region, and page", () => {
  const href = mapExploreHref({
    view:{lat:46.8,lng:-121.7,zoom:10}, types:[...DEFAULT_MAP_TYPES], query:"Rainier",
    search:"q=Rainier&state=WA&type=areas&page=2", selected:"areas:padus-rainier",
  });
  const params = new URLSearchParams(href.split("?")[1]);
  assert.equal(params.get("selected"), "areas:padus-rainier");
  assert.equal(parseCatalogFilters(params.toString()).page, 2);
  assert.equal(parseCatalogFilters(params.toString()).scope, "areas");
  assert.deepEqual(parseMapExploreUrl(params.toString()).view, {lat:46.8,lng:-121.7,zoom:10});
  const list = new URLSearchParams(catalogHref("/discover", params.toString()).split("?")[1]);
  assert.equal(list.get("state"), "WA");
  assert.equal(list.get("q"), "Rainier");
  assert.equal(list.get("page"), "2");
  for (const key of ["lat","lng","z","types","selected"]) assert.equal(list.has(key), false);
});

test("only known guide types can become map selections", () => {
  assert.deepEqual(parseCatalogSelection("areas:padus:test"), {kind:"areas",id:"padus:test"});
  assert.deepEqual(parseCatalogSelection("routes:camp-muir"), {kind:"routes",id:"camp-muir"});
  for (const input of [null,"areas:","routes","javascript:alert(1)","routes:"+"x".repeat(161)]) assert.equal(parseCatalogSelection(input), null);
});

test("SQL uses bound values for text and escapes LIKE wildcards", () => {
  const query = "_'; DROP TABLE routes; --%";
  const sql = catalogSearchSql(parseCatalogFilters(new URLSearchParams({q:query,state:"WA"}).toString()));
  assert.equal(sql.text.includes("DROP TABLE"), false);
  assert.equal(sql.text.includes(query), false);
  assert.ok(sql.values.some(value=>typeof value==="string"&&value.includes("\\_")&&value.includes("\\%")));
});

test("every optional SQL path binds exactly its referenced parameters", () => {
  for (const search of ["", "q=Rainier", "state=WA", "type=areas&page=2", "nearLat=0&nearLng=0&sort=nearest", "area=park&type=routes&activity=hiking&maxDistance=10&maxGain=2000&difficulty=moderate"]) {
    const sql = catalogSearchSql(parseCatalogFilters(search));
    const indices = [...new Set([...sql.text.matchAll(/\$(\d+)/g)].map(match=>Number(match[1])))].sort((a,b)=>a-b);
    assert.deepEqual(indices, Array.from({length:sql.values.length},(_,index)=>index+1), search);
    assert.equal(sql.values.at(-1), search.includes("page=2")?12:0);
  }
});
