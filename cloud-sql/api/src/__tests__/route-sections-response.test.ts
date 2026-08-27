import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildRouteDetailQuery,
  buildRouteSectionsQuery,
  mapRouteDetailRow,
} from "../routes/routes";

test("route detail returns ordered route sections in the coverage fraction domain", () => {
  const query = buildRouteDetailQuery("triple-crown-pct", "user-1");

  assert.match(query.text, /FROM route_sections rs/);
  assert.match(query.text, /WHERE rs\.route_id = r\.id/);
  assert.match(query.text, /ORDER BY rs\.ordinal/);
  assert.match(query.text, /'startFraction', rs\.start_fraction/);
  assert.match(query.text, /'endFraction', rs\.end_fraction/);
  assert.deepEqual(query.values, ["triple-crown-pct", "user-1"]);
});

test("the lightweight section query keeps route access checks and skips geometry", () => {
  const query = buildRouteSectionsQuery("triple-crown-pct", "user-1");

  assert.match(query.text, /FROM route_sections rs/);
  assert.match(query.text, /JOIN routes r ON r\.id = rs\.route_id/);
  assert.match(query.text, /r\.owner = 'peaks'/);
  assert.match(query.text, /ORDER BY rs\.ordinal/);
  assert.doesNotMatch(query.text, /polyline6|r\.path/);
  assert.deepEqual(query.values, ["triple-crown-pct", "user-1"]);
});

test("route detail defaults missing sections and preserves stored ones", () => {
  assert.deepEqual(mapRouteDetailRow({ id: "ordinary", areas: [] }).sections, []);

  const sections = [{
    id: "wa-k",
    label: "Section K",
    region: "Washington",
    detail: "Stevens Pass to Rainy Pass",
    startFraction: 0.9,
    endFraction: 0.95,
  }];
  assert.deepEqual(
    mapRouteDetailRow({ id: "triple-crown-pct", areas: [], sections }).sections,
    sections
  );
});
