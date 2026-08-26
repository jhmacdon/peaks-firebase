import assert from "node:assert/strict";
import test from "node:test";
import { buildAreaDetailQuery } from "../routes/areas";
import { buildDestinationRoutesQuery } from "../routes/destinations";
import {
  buildNearbyRoutesQuery,
  buildRouteDestinationsQuery,
  buildRouteDetailQuery,
  buildRouteElevationQuery,
} from "../routes/routes";
import { buildRouteSearchQuery } from "../routes/search";

function assertUserRouteAccess(sql: string): void {
  assert.match(sql, /\.owner = 'peaks'/);
  assert.match(sql, /\.owner = \$\d/);
  assert.match(sql, /FROM plan_routes access_pr/);
  assert.match(sql, /\.owner = access_p\.user_id/);
  assert.doesNotMatch(sql, /access_p\.is_public = true/);
  assert.match(sql, /access_p\.user_id = \$\d/);
  assert.match(sql, /FROM plan_party access_pp/);
  assert.match(sql, /access_pp\.user_id = \$\d/);
}

test("route detail and child geometry use only catalog, owner, or party access", () => {
  const detail = buildRouteDetailQuery("route-1", "user-1");
  const destinations = buildRouteDestinationsQuery("route-1", "user-1");
  const elevation = buildRouteElevationQuery("route-1", "user-1");

  for (const query of [detail, destinations, elevation]) {
    assertUserRouteAccess(query.text);
    assert.deepEqual(query.values, ["route-1", "user-1"]);
  }
});

test("nearby routes apply the same access rule before returning user geometry", () => {
  const query = buildNearbyRoutesQuery(47.4, -121.6, 5000, 20, "user-1");

  assertUserRouteAccess(query.text);
  assert.match(query.text, /ST_DWithin/);
  assert.deepEqual(query.values, [47.4, -121.6, 5000, 20, "user-1"]);
});

test("area, destination, and search route summaries do not leak private geometry", () => {
  const area = buildAreaDetailQuery("area-1", "user-1");
  const destination = buildDestinationRoutesQuery("destination-1", "user-1");
  const search = buildRouteSearchQuery({
    normalizedQuery: "mailbox",
    rawQuery: "Mailbox",
    limit: 10,
    uid: "user-1",
  });

  for (const query of [area, destination, search]) {
    assertUserRouteAccess(query.text);
  }
  assert.deepEqual(destination.values, ["destination-1", "user-1"]);
  assert.deepEqual(search.values, ["mailbox", "mailbox%", "mailbox%", 10, "user-1"]);
});
