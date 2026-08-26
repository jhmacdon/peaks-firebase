import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicPlanBundleQuery,
  mapPublicPlanBundleRow,
} from "./public-plan";

test("public saved-route bundle is one fail-closed query", () => {
  const query = buildPublicPlanBundleQuery("route-share-1");

  assert.deepEqual(query.values, ["route-share-1"]);
  assert.match(query.text, /WHERE p\.id = \$1 AND p\.is_public = true/);
  assert.match(query.text, /NOT EXISTS[\s\S]*invalid_route\.owner IS DISTINCT FROM p\.user_id/);
  assert.match(query.text, /FROM public_plan pp/);
  assert.match(query.text, /FROM plan_destinations pd/);
  assert.match(query.text, /FROM plan_routes pr/);
  assert.match(query.text, /r\.owner = 'peaks'/);
  assert.match(query.text, /route_owner_plan\.user_id = r\.owner/);
  assert.match(query.text, /FROM plan_reached_destinations prd/);
  assert.doesNotMatch(query.text, /plan_party|processing_error|photos/i);
  assert.doesNotMatch(query.text, /SELECT p\.user_id|['"]user_?id['"]/i);
});

test("public saved-route mapper strips the owner and keeps ordered public rows", () => {
  const bundle = mapPublicPlanBundleRow({
    id: "route-share-1",
    name: "Mailbox Peak",
    description: null,
    date: "2026-08-31T15:00:00Z",
    distance: "12000",
    gain: "1200",
    path: { type: "LineString", coordinates: [[-121, 47], [-121.1, 47.1]] },
    created_at: "2026-08-25T10:00:00Z",
    updated_at: "2026-08-26T10:00:00Z",
    destinations: [{
      id: "peak-1", name: "Mailbox Peak", elevation: "1476",
      features: ["summit"], lat: "47.437", lng: "-121.671",
    }],
    routes: [{
      id: "route-1", name: "Old Trail", polyline6: "abc",
      distance: "12000", gain: "1200", status: "active", isCatalog: true,
    }],
    reached_destinations: [{
      id: "peak-1", name: "Mailbox Peak", elevation: 1476,
      features: "{summit}", lat: 47.437, lng: -121.671, ordinal: 0,
    }],
  });

  assert.ok(bundle);
  assert.equal(bundle.plan.isPublic, true);
  assert.equal(bundle.plan.distance, 12000);
  assert.equal(bundle.destinations[0].features[0], "summit");
  assert.equal(bundle.routes[0].status, "active");
  assert.equal(bundle.routes[0].isCatalog, true);
  assert.equal(bundle.reachedDestinations[0].ordinal, 0);
  assert.equal("userId" in bundle.plan, false);
  assert.equal("party" in bundle.plan, false);
});

test("public saved-route mapper fails closed when required timestamps are bad", () => {
  assert.equal(mapPublicPlanBundleRow({
    id: "route-share-1",
    name: "Route",
    description: "",
    date: null,
    distance: null,
    gain: null,
    path: null,
    created_at: null,
    updated_at: null,
    destinations: [],
    routes: [],
    reached_destinations: [],
  }), null);
});
