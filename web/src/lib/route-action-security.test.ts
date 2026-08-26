import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const actions = readFileSync(
  join(import.meta.dirname, "actions", "routes.ts"),
  "utf8"
);
const picker = readFileSync(
  join(import.meta.dirname, "..", "components", "route-picker.tsx"),
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
