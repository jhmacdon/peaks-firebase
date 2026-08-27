import assert from "node:assert/strict";
import test from "node:test";
import {
  footAccessAllows,
  isWalkableOsmWay,
  requiresExplicitFootAccess,
} from "../osm-route-access";

test("ordinary walking ways remain walkable without an explicit foot tag", () => {
  assert.equal(isWalkableOsmWay({ highway: "path" }), true);
  assert.equal(isWalkableOsmWay({ highway: "track" }), true);
  assert.equal(requiresExplicitFootAccess({ highway: "path" }), false);
});

test("bridleways and cycleways require an explicit walking permission", () => {
  for (const highway of ["bridleway", "cycleway"]) {
    assert.equal(isWalkableOsmWay({ highway }), false);
    assert.equal(isWalkableOsmWay({ highway, foot: "no" }), false);
    assert.equal(isWalkableOsmWay({ highway, foot: "designated" }), true);
    assert.equal(isWalkableOsmWay({ highway, foot: "permissive" }), true);
    assert.equal(requiresExplicitFootAccess({ highway }), true);
  }
});

test("the approved foot-access values match route-builder access handling", () => {
  for (const foot of ["yes", "designated", "permissive", "permit"]) {
    assert.equal(footAccessAllows({ foot }), true);
  }
  for (const foot of ["", "no", "private", "customers"]) {
    assert.equal(footAccessAllows({ foot }), false);
  }
});
