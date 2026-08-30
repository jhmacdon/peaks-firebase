import assert from "node:assert/strict";
import test from "node:test";

import {
  isStrongRouteIdentitySource,
  validateRouteAccessSource,
  validateRouteIdentitySource,
} from "../standard-route-identity-source";

test("known discovery publishers are bound to their own hosts", () => {
  assert.deepEqual(
    validateRouteIdentitySource(
      {
        type: "alltrails",
        url: "https://www.alltrails.com/trail/us/washington/example",
      },
      0
    ),
    {
      type: "alltrails",
      url: "https://www.alltrails.com/trail/us/washington/example",
    }
  );
  assert.throws(
    () =>
      validateRouteIdentitySource(
        { type: "peakbagger", url: "https://example.com/peak.aspx?pid=1" },
        0
      ),
    /wrong publisher host/
  );
});

test("official evidence uses its reviewed registry ID and publisher host", () => {
  const source = validateRouteIdentitySource(
    {
      type: "usfs-nfs-trails",
      url: "https://apps.fs.usda.gov/arcx/rest/services/EDW/example",
    },
    0
  );
  assert.equal(source.type, "usfs-nfs-trails");
  assert.equal(isStrongRouteIdentitySource(source.type), true);

  assert.throws(
    () =>
      validateRouteIdentitySource(
        { type: "usfs-nfs-trails", url: "https://example.com/trail" },
        0
      ),
    /reviewed official publisher host/
  );
  assert.throws(
    () =>
      validateRouteIdentitySource(
        { type: "official", url: "https://example.com/trail" },
        0
      ),
    /type is not allowed: official/
  );
});

test("unreviewed generic guide and agency labels cannot become strong evidence", () => {
  for (const type of [
    "government",
    "park",
    "forest_service",
    "land_manager",
    "climbing_ranger",
    "mountaineering_club",
    "trail_association",
    "guide",
    "guidebook",
    "local_authority",
  ]) {
    assert.throws(
      () =>
        validateRouteIdentitySource(
          { type, url: "https://example.com/route" },
          0
        ),
      /type is not allowed/
    );
  }
});

test("access evidence must be the exact URL of a strong identity source", () => {
  const sources = [
    validateRouteIdentitySource(
      {
        type: "alltrails",
        url: "https://www.alltrails.com/trail/us/washington/example",
      },
      0
    ),
    validateRouteIdentitySource(
      {
        type: "usfs-nfs-trails",
        url: "https://apps.fs.usda.gov/arcx/rest/services/EDW/example",
      },
      1
    ),
  ];

  assert.equal(
    validateRouteAccessSource(
      "https://apps.fs.usda.gov/arcx/rest/services/EDW/example",
      sources
    ),
    "https://apps.fs.usda.gov/arcx/rest/services/EDW/example"
  );
  assert.throws(
    () => validateRouteAccessSource("https://attacker.example/access", sources),
    /exactly match a strong identity source/
  );
  assert.throws(
    () =>
      validateRouteAccessSource(
        "https://www.alltrails.com/trail/us/washington/example",
        sources
      ),
    /exactly match a strong identity source/
  );
});
