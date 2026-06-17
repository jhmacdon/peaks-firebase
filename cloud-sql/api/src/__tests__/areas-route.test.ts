import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildAreaDetailQuery, mapAreaDetailRow } from "../routes/areas";

test("area detail query returns summary counts and related peaks/routes without boundaries", () => {
  const query = buildAreaDetailQuery("mora");

  assert.match(query.text, /FROM areas a/);
  assert.match(query.text, /destination_count/);
  assert.match(query.text, /route_count/);
  assert.match(query.text, /json_agg\(destination_obj/);
  assert.match(query.text, /json_agg\(route_obj/);
  assert.doesNotMatch(query.text, /\ba\.boundary\b/);
  assert.deepEqual(query.values, ["mora"]);
});

test("mapAreaDetailRow defaults related arrays and numeric counts", () => {
  const mapped = mapAreaDetailRow({
    id: "mora",
    name: "Mount Rainier National Park",
    kind: "national_park",
    destination_count: "12",
    route_count: null,
    destinations: null,
    routes: null,
  });

  assert.equal(mapped.destination_count, 12);
  assert.equal(mapped.route_count, 0);
  assert.deepEqual(mapped.destinations, []);
  assert.deepEqual(mapped.routes, []);
});
