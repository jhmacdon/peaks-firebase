// A route's start says how a hiker gets there: parking, lift or public
// transport. The app offers car directions only to a parking start, so a
// lift or transit value must survive the API intact, and an absent or broken
// value must read as parking. Contract: docs/start-access.md.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import db from "../db";
import routesRouter, { buildRouteDestinationsQuery } from "../routes/routes";
import {
  buildDestinationDetailQuery,
  mapDestinationDetailRow,
} from "../routes/destinations";
import { normalizeStartAccess, startAccessSql } from "../lib/start-access";

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
    (candidate: any) => candidate.route?.path === path && candidate.route?.methods?.get
  );
  assert.ok(layer, `expected routes router to include GET ${path}`);
  return layer.route.stack[0].handle as (req: unknown, res: unknown) => Promise<void>;
}

const SAENTIS = {
  kind: "lift",
  mode: "cable_car",
  station_name: "Säntis",
  operator: "Säntis-Schwebebahn AG",
};

test("normalizeStartAccess keeps a lift start", () => {
  assert.deepEqual(normalizeStartAccess(SAENTIS), SAENTIS);
});

test("normalizeStartAccess keeps a transit start and trims text", () => {
  assert.deepEqual(
    normalizeStartAccess({ kind: "transit", mode: "train", station_name: " Lauterbrunnen ", operator: "" }),
    { kind: "transit", mode: "train", station_name: "Lauterbrunnen", operator: null }
  );
});

test("normalizeStartAccess reads absent, malformed and unknown kinds as null", () => {
  for (const raw of [undefined, null, "lift", 3, [], {}, { kind: "helicopter" }, { kind: "LIFT" }]) {
    assert.equal(normalizeStartAccess(raw), null, JSON.stringify(raw));
  }
});

test("an unknown mode keeps the lift kind and drops the mode", () => {
  // A lift start with an unreadable mode is still not somewhere to drive.
  assert.deepEqual(normalizeStartAccess({ kind: "lift", mode: "zipline", station_name: "Top" }), {
    kind: "lift",
    mode: null,
    station_name: "Top",
    operator: null,
  });
});

test("a parking start carries no mode or station", () => {
  assert.deepEqual(
    normalizeStartAccess({ kind: "parking", mode: "train", station_name: "X", operator: "Y" }),
    { kind: "parking", mode: null, station_name: null, operator: null }
  );
});

test("both queries select start_access from destination metadata as JSONB", () => {
  const expected = startAccessSql("d");
  assert.equal(expected, "d.metadata->'start_access' AS start_access");
  assert.ok(buildRouteDestinationsQuery("route-1", "user-1").text.includes(expected));
  assert.ok(buildDestinationDetailQuery("dest-1").text.includes(expected));
  // `->>` would hand the client a JSON string to parse a second time.
  assert.doesNotMatch(buildDestinationDetailQuery("dest-1").text, /->>'start_access'/);
});

test("destination detail serves a normalized start_access, null when absent", () => {
  const lift = mapDestinationDetailRow({ id: "saentis", areas: [], start_access: SAENTIS });
  assert.deepEqual(lift.start_access, SAENTIS);
  const plain = mapDestinationDetailRow({ id: "snow-lake-th", areas: [] });
  assert.equal(plain.start_access, null);
});

const ROWS = [
  { id: "saentis", name: "Säntis", features: "{trailhead}", start_access: SAENTIS, ordinal: 0 },
  { id: "summit", name: "Altmann", features: "{summit}", start_access: null, ordinal: 1 },
  { id: "bad", name: "Broken", features: "{trailhead}", start_access: { kind: "?" }, ordinal: 2 },
];

function mockQueries(t: any, route: unknown[]) {
  t.mock.method(db, "query", async (text: string) => ({
    rows: /FROM destinations d/.test(text) ? ROWS.map((r) => ({ ...r })) : route,
  }) as any);
}

test("GET /:id/destinations serves start_access on every row", async (t) => {
  mockQueries(t, []);
  const response = new FakeResponse();
  await getRouteGetHandler("/:id/destinations")({ params: { id: "route-1" }, uid: "u" }, response);
  assert.deepEqual(
    response.jsonBody.map((d: any) => d.start_access),
    [SAENTIS, null, null]
  );
});

test("GET /:id embeds destinations with start_access", async (t) => {
  mockQueries(t, [{ id: "route-1", name: "Säntis to Altmann", areas: [] }]);
  const response = new FakeResponse();
  await getRouteGetHandler("/:id")({ params: { id: "route-1" }, uid: "u" }, response);
  assert.deepEqual(
    response.jsonBody.destinations.map((d: any) => d.start_access),
    [SAENTIS, null, null]
  );
});
