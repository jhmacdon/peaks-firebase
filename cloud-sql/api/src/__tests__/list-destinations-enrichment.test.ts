import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildListDestinationsQuery, mapListDestinationRow } from "../routes/lists";

test("list destinations query joins best route and popular months", () => {
  const query = buildListDestinationsQuery("cascade-volcanoes");

  assert.match(query.text, /FROM destinations d/);
  assert.match(query.text, /LEFT JOIN LATERAL/);
  assert.match(query.text, /route_destinations/);
  assert.match(query.text, /session_routes/);
  assert.match(query.text, /r\.status = 'active'/);
  // Ordering inside the lateral pick: session count desc, distance asc, id asc
  assert.match(query.text, /ORDER BY session_count DESC NULLS LAST, r\.distance ASC NULLS LAST, r\.id ASC/);
  assert.match(query.text, /LIMIT 1/);
  assert.match(query.text, /ld\.ordinal/);
  assert.deepEqual(query.values, ["cascade-volcanoes"]);
});

test("mapListDestinationRow passes through route summary and computes top-2 months", () => {
  const mapped = mapListDestinationRow({
    id: "rainier",
    name: "Mount Rainier",
    elevation: 4392,
    prominence: 4023,
    features: ["summit"],
    lat: 46.85,
    lng: -121.76,
    ordinal: 1,
    route_id: "dc",
    route_name: "Disappointment Cleaver",
    route_distance: 14300,
    route_gain: 2750,
    route_shape: "out_and_back",
    averages: { months: { jan: 1, jun: 40, jul: 55, aug: 30 } },
    averages_offset: { months: { jul: 5, sep: 2 } },
  });

  assert.equal(mapped.route_id, "dc");
  assert.equal(mapped.route_name, "Disappointment Cleaver");
  assert.equal(mapped.route_distance, 14300);
  assert.equal(mapped.route_gain, 2750);
  assert.equal(mapped.route_shape, "out_and_back");
  // jul: 55+5=60, jun: 40 → top-2 = [7, 6]
  assert.deepEqual(mapped.popular_months, [7, 6]);
  // averages blobs are internal — not in the response
  assert.equal("averages" in mapped, false);
  assert.equal("averages_offset" in mapped, false);
});

test("mapListDestinationRow handles missing route and averages", () => {
  const mapped = mapListDestinationRow({
    id: "obscure",
    name: "Obscure Peak",
    elevation: 2000,
    prominence: null,
    features: ["summit"],
    lat: 47.0,
    lng: -121.0,
    ordinal: 2,
    route_id: null,
    route_name: null,
    route_distance: null,
    route_gain: null,
    route_shape: null,
    averages: null,
    averages_offset: null,
  });

  assert.equal(mapped.route_id, null);
  assert.deepEqual(mapped.popular_months, []);
});
