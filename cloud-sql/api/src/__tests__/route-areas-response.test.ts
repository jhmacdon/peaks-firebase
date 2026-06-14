import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildRouteDetailQuery, mapRouteDetailRow } from "../routes/routes";

test("route detail query includes linked areas without area boundaries", () => {
  const query = buildRouteDetailQuery("route-1");

  assert.match(query.text, /FROM route_areas ra/);
  assert.match(query.text, /JOIN areas a ON a\.id = ra\.area_id/);
  assert.match(query.text, /json_agg/);
  assert.match(query.text, /'kind', a\.kind/);
  assert.doesNotMatch(query.text, /a\.boundary/);
  // duplicate PAD-US park fragments collapse so a park never shows twice
  assert.match(query.text, /DISTINCT ON \(a\.kind, a\.name\)/);
  assert.deepEqual(query.values, ["route-1"]);
});

test("mapRouteDetailRow defaults areas to empty array", () => {
  const row: any = {
    id: "route-1",
    name: "Wonderland Trail",
    areas: null,
  };

  const mapped = mapRouteDetailRow(row);

  assert.deepEqual(mapped.areas, []);
});

test("mapRouteDetailRow preserves an existing areas array", () => {
  const areas = [
    {
      id: "area-1",
      name: "Mount Rainier National Park",
      kind: "national_park",
      designation: "NP",
      manager: "NPS",
      relation: "intersects",
      source: "postgis",
    },
  ];
  const mapped = mapRouteDetailRow({ id: "route-1", areas });
  assert.deepEqual(mapped.areas, areas);
});
