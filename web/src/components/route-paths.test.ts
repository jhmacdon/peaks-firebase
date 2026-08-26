import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogRoutePath,
  myRoutePath,
  publicSavedRoutePath,
} from "./route-paths";

test("route URL contract keeps catalog, public saved, and editor paths distinct", () => {
  assert.equal(catalogRoutePath("route/id"), "/routes/route%2Fid");
  assert.equal(publicSavedRoutePath("route/id"), "/route/route%2Fid");
  assert.equal(myRoutePath("route/id"), "/my-routes/route%2Fid");
  assert.equal(myRoutePath(), "/my-routes");
});
