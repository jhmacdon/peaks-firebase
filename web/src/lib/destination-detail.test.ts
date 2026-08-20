import assert from "node:assert/strict";
import test from "node:test";

import { buildDestinationGuide, describeDestinationType } from "./destination-detail";

test("describeDestinationType prefers the primary feature, titleized", () => {
  assert.equal(describeDestinationType("point", ["summit"]), "Summit");
  assert.equal(describeDestinationType("point", ["fire-lookout"]), "Fire lookout");
});

test("describeDestinationType falls back to Region for a region with no features", () => {
  assert.equal(describeDestinationType("region", []), "Region");
});

test("describeDestinationType omits (null) a generic point with no features", () => {
  assert.equal(describeDestinationType("point", []), null);
});

const BASE_SOURCE = {
  name: "Test Peak",
  type: "point",
  elevation: 1200,
  prominence: 400,
  activities: [] as string[],
  features: ["summit"] as string[],
};

test("buildDestinationGuide headline omits elevation and prominence (already in the stat row)", () => {
  const guide = buildDestinationGuide(BASE_SOURCE, "Washington, United States", 0);
  assert.equal(guide.headline, "Test Peak is a summit in Washington, United States.");
});

test("buildDestinationGuide drops the activity claim when there are no recorded sessions", () => {
  const source = { ...BASE_SOURCE, activities: ["outdoor-trek"] };
  const withoutSessions = buildDestinationGuide(source, null, 0);
  assert.ok(
    !withoutSessions.paragraphs.some((p) => p.includes("activity recorded here")),
    "should not claim recorded activity with zero sessions"
  );

  const withSessions = buildDestinationGuide(source, null, 5);
  assert.ok(
    withSessions.paragraphs.some((p) => p.includes("activity recorded here is hiking")),
    "should claim recorded activity once there are sessions"
  );
});
