import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildListDestinationsQuery,
  commonClimbingMonths,
  mapListDestinationRow,
} from "../routes/lists";

test("list destinations query joins best route and popular months", () => {
  const query = buildListDestinationsQuery("cascade-volcanoes");

  assert.match(query.text, /FROM destinations d/);
  assert.match(query.text, /LEFT JOIN LATERAL/);
  assert.match(query.text, /route_destinations/);
  assert.match(query.text, /session_routes/);
  // A partial-coverage row is not a climb of the route — see route-coverage.ts.
  assert.match(query.text, /sr\.coverage IS NULL OR sr\.coverage >= 0\.7/);
  assert.match(query.text, /r\.status = 'active'/);
  // Only Peaks-owned system routes qualify — a user's recorded route must
  // never become a peak's "standard route".
  assert.match(query.text, /r\.owner = 'peaks'/);
  // Ordering inside the lateral pick: session count desc, distance asc, id asc
  assert.match(query.text, /ORDER BY session_count DESC NULLS LAST, r\.distance ASC NULLS LAST, r\.id ASC/);
  assert.match(query.text, /LIMIT 1/);
  assert.match(query.text, /ld\.ordinal/);
  assert.deepEqual(query.values, ["cascade-volcanoes"]);
});

test("mapListDestinationRow passes through route summary and computes a common season", () => {
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
  // Jun + Jul form the shortest majority; Aug is a balanced shoulder month.
  assert.deepEqual(mapped.popular_months, [6, 7, 8]);
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

test("commonClimbingMonths keeps a sharp spike to one month", () => {
  assert.deepEqual(
    commonClimbingMonths(
      { months: { may: 2, jun: 3, jul: 90, aug: 3, sep: 2 } },
      null
    ),
    [7]
  );
});

test("commonClimbingMonths keeps an even five-month majority", () => {
  assert.deepEqual(
    commonClimbingMonths(
      {
        months: {
          jan: 5, feb: 5, mar: 5, apr: 5, may: 12, jun: 12,
          jul: 12, aug: 12, sep: 12, oct: 5, nov: 4, dec: 4,
        },
      },
      null
    ),
    [5, 6, 7, 8, 9]
  );
});

test("commonClimbingMonths treats December and January as adjacent", () => {
  assert.deepEqual(
    commonClimbingMonths(
      { months: { oct: 3, nov: 20, dec: 30, jan: 30, feb: 20, mar: 3 } },
      null
    ),
    [11, 12, 1, 2]
  );
});

test("commonClimbingMonths rejects small and year-round samples", () => {
  assert.deepEqual(
    commonClimbingMonths({ months: { jun: 2, jul: 5, aug: 2 } }, null),
    []
  );
  assert.deepEqual(
    commonClimbingMonths(
      {
        months: {
          jan: 10, feb: 10, mar: 10, apr: 10, may: 10, jun: 10,
          jul: 10, aug: 10, sep: 10, oct: 10, nov: 10, dec: 10,
        },
      },
      null
    ),
    []
  );
});
