import assert from "node:assert/strict";
import test from "node:test";
import { findConflictingLiveRoute } from "../standard-route-import-conflicts";

const routes = [
  {
    id: "legacy-whitney-trail",
    name: "Mount Whitney via Mount Whitney Trail",
    status: "active",
  },
  {
    id: "mountaineers-route",
    name: "Mountaineer's Route",
    status: "active",
  },
];

test("a distinct active route on the same destination can coexist", () => {
  assert.equal(
    findConflictingLiveRoute(
      routes,
      "Mount Whitney via Mount Whitney Trail",
      ["legacy-whitney-trail"]
    ),
    null
  );
});

test("another live route with the same name remains a conflict", () => {
  const conflict = findConflictingLiveRoute(
    [
      ...routes,
      {
        id: "duplicate",
        name: "MOUNT WHITNEY VIA MOUNT WHITNEY TRAIL",
        status: "pending",
      },
    ],
    "Mount Whitney via Mount Whitney Trail",
    ["legacy-whitney-trail"]
  );

  assert.equal(conflict?.id, "duplicate");
});

test("explicit replacement ids and superseded routes do not conflict", () => {
  assert.equal(
    findConflictingLiveRoute(
      [
        {
          id: "old-route",
          name: "Peak via Standard Trail",
          status: "active",
        },
        {
          id: "older-route",
          name: "Peak via Standard Trail",
          status: "superseded",
        },
      ],
      "Peak via Standard Trail",
      ["old-route"]
    ),
    null
  );
});
