import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const testDirectory =
  typeof __dirname === "string" ? __dirname : import.meta.dirname;
const actions = readFileSync(
  join(testDirectory, "actions", "routes.ts"),
  "utf8"
);
const picker = readFileSync(
  join(testDirectory, "..", "components", "route-picker.tsx"),
  "utf8"
);

test("public route actions have no caller-controlled raw mode", () => {
  assert.doesNotMatch(actions, /publicOnly/);
  assert.match(actions, /getRoute\(id: string\)[\s\S]{0,100}queryRoute\(id, true\)/);
  assert.match(actions, /getRouteDestinations\(routeId: string\)[\s\S]{0,120}queryRouteDestinations\(routeId, true\)/);
  assert.match(actions, /getRouteSegments\(routeId: string\)[\s\S]{0,120}queryRouteSegments\(routeId, true\)/);
  assert.match(actions, /getRouteElevation\(routeId: string\)[\s\S]{0,120}queryRouteElevation\(routeId, true\)/);
});

test("raw route reads verify an admin token", () => {
  for (const name of [
    "getRoutes",
    "getAdminRoute",
    "getAdminRouteDestinations",
    "getAdminRouteSegments",
    "getAdminRouteElevation",
    "getAdminRouteSessionCount",
    "getPendingRouteCount",
    "analyzePendingRoute",
  ]) {
    const start = actions.indexOf(`export async function ${name}`);
    assert.notEqual(start, -1, `${name} must exist`);
    assert.match(actions.slice(start, start + 500), /await requireAdmin\(token\)/, `${name} must verify admin`);
  }
});

test("RoutePicker calls only the catalog search action", () => {
  assert.match(picker, /searchCatalogRoutes/);
  assert.doesNotMatch(picker, /\bgetRoutes\b/);
  const searchStart = actions.indexOf("export async function searchCatalogRoutes");
  const searchEnd = actions.indexOf("async function queryRoute", searchStart);
  const searchAction = actions.slice(searchStart, searchEnd);
  assert.match(searchAction, /r\.owner = 'peaks'/);
  assert.match(searchAction, /r\.status = 'active'/);
  assert.match(searchAction, /SELECT r\.id, r\.name, r\.distance, r\.gain/);
});

test("direct activation checks factory ownership after locking the pending route", () => {
  const acceptStart = actions.indexOf("export async function acceptRoute(");
  const acceptEnd = actions.indexOf("export async function rejectRoute(", acceptStart);
  const accept = actions.slice(acceptStart, acceptEnd);
  assert.match(
    accept,
    /status = 'pending'[\s\S]*FOR UPDATE[\s\S]*refuseDirectFactoryActivation\(client, id\)[\s\S]*UPDATE routes SET status = 'active'/
  );

  const segmentedStart = actions.indexOf(
    "export async function acceptRouteWithSegments("
  );
  const segmented = actions.slice(segmentedStart);
  assert.equal(
    (
      segmented.match(
        /FOR UPDATE`[\s\S]{0,500}?refuseDirectFactoryActivation\(client, id\)/g
      ) ?? []
    ).length,
    2,
    "both segmented activation transactions recheck after locking the route"
  );
});

test("admin rejection preserves factory ownership and still permits ordinary pending routes", () => {
  const rejectStart = actions.indexOf("export async function rejectRoute(");
  const rejectEnd = actions.indexOf(
    "async function analyzePendingRouteUnchecked(",
    rejectStart
  );
  const reject = actions.slice(rejectStart, rejectEnd);
  assert.match(
    reject,
    /status = 'pending'[\s\S]*FOR UPDATE[\s\S]*refuseDirectFactoryActivation\(client, id\)[\s\S]*DELETE FROM routes WHERE id = \$1 AND status = 'pending'/
  );

  const guardStart = actions.indexOf(
    "async function refuseDirectFactoryActivation("
  );
  const guardEnd = actions.indexOf(
    "async function lockRouteFactoryActivation(",
    guardStart
  );
  const guard = actions.slice(guardStart, guardEnd);
  assert.match(
    guard,
    /WHERE published_route_id = \$1[\s\S]*AND state <> 'verified'[\s\S]*if \(factoryJob\.rows\.length > 0\)/
  );
  assert.doesNotMatch(
    guard,
    /throw new Error[\s\S]*factoryJob\.rows\.length === 0/,
    "an ordinary pending route has no queue row and remains rejectable"
  );
});

test("factory activation needs a live lease and the approved candidate binding", () => {
  assert.match(actions, /token !== activation\.leaseToken/);
  assert.match(
    actions,
    /state = 'approved'[\s\S]*lease_expires_at >= clock_timestamp\(\)/
  );
  assert.match(actions, /approved_route_binding,routeName/);
  assert.match(actions, /approved_route_binding,destinations/);
  assert.match(actions, /approved_route_binding,identitySources/);
  assert.match(actions, /approved_route_binding,geometrySource/);
  assert.match(actions, /approved_route_binding,geometry/);
  assert.match(actions, /FOR UPDATE OF job, r/);
  assert.match(
    actions,
    /FROM route_destinations rd[\s\S]*FOR UPDATE OF rd, d/
  );
  assert.match(actions, /Approved route destinations changed after review/);
  assert.match(actions, /Approved route changed after review/);
});

test("factory activation rejects a fresh shared-segment plan", () => {
  const start = actions.indexOf(
    "export async function acceptRouteWithSegments("
  );
  const action = actions.slice(start);
  assert.match(
    action,
    /analyzePendingRouteUnchecked\(id\)[\s\S]*factoryActivation[\s\S]*decomposition\.splits\.length > 0[\s\S]*decomposition\.affectedRoutes\.length > 0[\s\S]*Shared-segment changes require human web-admin review[\s\S]*const hasExistingOrSplit/
  );
});

test("factory activation uses one queue-bound database operation", () => {
  const helperStart = actions.indexOf("async function activateFactoryRoute(");
  const helperEnd = actions.indexOf(
    "export async function acceptRouteWithSegments(",
    helperStart
  );
  const helper = actions.slice(helperStart, helperEnd);
  assert.match(helper, /activate_standard_route_factory\(\$1, \$2, \$3\)/);
  assert.match(
    helper,
    /activation\.destinationId, id, activation\.leaseToken/
  );
  assert.equal(
    (
      actions.match(
        /if \(factoryActivation\) \{[\s\S]{0,100}?activateFactoryRoute\(client, id, factoryActivation\)/g
      ) ?? []
    ).length,
    2,
    "both factory activation paths must use the bound database operation"
  );
  assert.doesNotMatch(
    helper,
    /settle_standard_route_factory_replacement/,
    "the web action cannot split activation from replacement settlement"
  );
  assert.match(actions, /settle_route_integrity_replacement/);
});
