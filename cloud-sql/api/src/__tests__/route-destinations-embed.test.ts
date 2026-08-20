// Route detail embeds its ordered destinations, and both destination shapes
// carry trailhead amenities. Before this, the app had to fetch a route and
// then its destinations, and neither reply mentioned the parking, fee or
// bathroom facts the database already held.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import db from "../db";
import routesRouter, {
  buildRouteDestinationsQuery,
  mapRouteDetailRow,
} from "../routes/routes";

class FakeResponse {
  statusCode?: number;
  jsonBody?: any;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.jsonBody = body;
    return this;
  }
}

function getRouteGetHandler(path: string) {
  const layer = (routesRouter as any).stack.find(
    (candidate: any) =>
      candidate.route?.path === path && candidate.route?.methods?.get
  );
  assert.ok(layer, `expected routes router to include GET ${path}`);
  return layer.route.stack[0].handle as (
    req: unknown,
    res: unknown
  ) => Promise<void>;
}

const PARKING_AMENITIES = {
  parking: {
    fee_required: {
      value: true,
      source: {
        kind: "usfs_edw",
        name: "US Forest Service",
        url: "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0",
        license: "public domain (US federal government)",
        external_id: "1104061",
      },
      retrieved_at: "2026-08-18",
    },
    capacity_vehicles: {
      value: 40,
      source: {
        kind: "usfs_web",
        name: "US Forest Service",
        url: "https://www.fs.usda.gov/recarea/mbs/recarea/?recid=17811",
        license: "public domain (US federal government)",
      },
      retrieved_at: "2026-08-18",
    },
  },
};

/** Trailhead first, summit second — the order the client draws them in. */
const DESTINATION_ROWS = [
  {
    id: "trailhead-1",
    name: "Snow Lake Trailhead",
    elevation: 921,
    features: "{trailhead}",
    amenities: PARKING_AMENITIES,
    lat: 47.3925,
    lng: -121.4235,
    ordinal: 0,
  },
  {
    id: "summit-1",
    name: "Chair Peak",
    elevation: 2071,
    features: "{summit}",
    amenities: null,
    lat: 47.4459,
    lng: -121.4514,
    ordinal: 1,
  },
];

const ROUTE_ROW = {
  id: "route-1",
  name: "Snow Lake to Chair Peak",
  polyline6: "abc",
  owner: "peaks",
  distance: 6400,
  areas: [],
};

/** Mock both queries the route-detail handler runs, telling them apart by SQL. */
function mockRouteQueries(
  t: any,
  { route, destinations }: { route: unknown[]; destinations: unknown[] }
) {
  const seen: Array<{ text: string; values: unknown[] }> = [];
  t.mock.method(db, "query", async (text: string, values: unknown[]) => {
    seen.push({ text, values });
    return {
      rows: /FROM destinations d/.test(text) ? destinations : route,
    } as any;
  });
  return seen;
}

test("route destinations query selects amenities in ordinal order", () => {
  const query = buildRouteDestinationsQuery("route-1");

  assert.match(query.text, /d\.amenities\b/);
  // The fields the client already reads stay exactly as they were.
  assert.match(query.text, /d\.id, d\.name, d\.elevation, d\.features/);
  assert.match(query.text, /ST_Y\(d\.location::geometry\) AS lat/);
  assert.match(query.text, /ST_X\(d\.location::geometry\) AS lng/);
  assert.match(query.text, /rd\.ordinal/);
  assert.match(query.text, /ORDER BY rd\.ordinal/);
  assert.deepEqual(query.values, ["route-1"]);
});

test("GET /:id/destinations serves amenities per destination", async (t) => {
  const seen = mockRouteQueries(t, { route: [], destinations: DESTINATION_ROWS });

  const handler = getRouteGetHandler("/:id/destinations");
  const response = new FakeResponse();
  await handler({ params: { id: "route-1" } }, response);

  assert.deepEqual(response.jsonBody, DESTINATION_ROWS);
  assert.deepEqual(response.jsonBody[0].amenities, PARKING_AMENITIES);
  assert.equal(response.jsonBody[1].amenities, null);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].values, ["route-1"]);
});

test("GET /:id embeds its destinations, ordered, with amenities", async (t) => {
  const seen = mockRouteQueries(t, {
    route: [{ ...ROUTE_ROW }],
    destinations: DESTINATION_ROWS,
  });

  const handler = getRouteGetHandler("/:id");
  const response = new FakeResponse();
  await handler({ params: { id: "route-1" } }, response);

  assert.equal(response.statusCode, undefined);
  assert.equal(response.jsonBody.id, "route-1");
  assert.deepEqual(response.jsonBody.areas, []);
  assert.deepEqual(
    response.jsonBody.destinations.map((d: any) => d.id),
    ["trailhead-1", "summit-1"]
  );
  assert.deepEqual(
    response.jsonBody.destinations.map((d: any) => d.ordinal),
    [0, 1]
  );
  assert.deepEqual(response.jsonBody.destinations[0].amenities, PARKING_AMENITIES);
  assert.equal(
    response.jsonBody.destinations[0].amenities.parking.fee_required.source.kind,
    "usfs_edw"
  );
  assert.equal(response.jsonBody.destinations[1].amenities, null);
  // Same builder as the standalone endpoint, so the two shapes cannot drift.
  assert.equal(seen.length, 2);
  const destinationsQuery = seen.find((call) => /FROM destinations d/.test(call.text));
  assert.ok(destinationsQuery);
  assert.equal(destinationsQuery.text, buildRouteDestinationsQuery("route-1").text);
  assert.deepEqual(destinationsQuery.values, ["route-1"]);
});

test("a route with no destinations embeds an empty array", async (t) => {
  mockRouteQueries(t, { route: [{ ...ROUTE_ROW }], destinations: [] });

  const handler = getRouteGetHandler("/:id");
  const response = new FakeResponse();
  await handler({ params: { id: "route-1" } }, response);

  assert.deepEqual(response.jsonBody.destinations, []);
});

test("a missing route still 404s", async (t) => {
  mockRouteQueries(t, { route: [], destinations: DESTINATION_ROWS });

  const handler = getRouteGetHandler("/:id");
  const response = new FakeResponse();
  await handler({ params: { id: "gone" } }, response);

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.jsonBody, { error: "Route not found" });
});

test("mapRouteDetailRow defaults destinations to an empty array", () => {
  const mapped = mapRouteDetailRow({ id: "route-1", areas: [] });

  assert.deepEqual(mapped.destinations, []);
});

test("mapRouteDetailRow keeps the query's destination order", () => {
  const mapped = mapRouteDetailRow({ id: "route-1", areas: [] }, DESTINATION_ROWS);

  assert.deepEqual(mapped.destinations, DESTINATION_ROWS);
});
