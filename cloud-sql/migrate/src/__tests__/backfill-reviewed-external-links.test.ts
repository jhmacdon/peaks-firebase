import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDestinationUpdates,
  buildRouteRepairUpdates,
  buildRouteUpdates,
  destinationIdFromAuditSource,
  exactRouteSourceLink,
  normalizeIdentityName,
} from "../backfill-reviewed-external-links";

test("extracts only exact destination pages", () => {
  assert.deepEqual(
    destinationIdFromAuditSource("Mount Baker", "https://www.peakbagger.com/peak.aspx?pid=1633"),
    { provider: "peakbagger", id: "1633" }
  );
  assert.deepEqual(
    destinationIdFromAuditSource("Mount Baker", "https://www.summitpost.org/mount-baker/150195"),
    { provider: "summitpost", id: "150195" }
  );
  assert.equal(
    destinationIdFromAuditSource("Mount Baker", "https://www.summitpost.org/easton-glacier/157231"),
    null
  );
  assert.equal(
    destinationIdFromAuditSource("Mount Baker", "https://www.peakbagger.com/climber/ascent.aspx?aid=1"),
    null
  );
});

test("normalizes accents and punctuation for identity checks", () => {
  assert.equal(normalizeIdentityName("Pikes Peak - Barr Trail"), "pikespeakbarrtrail");
  assert.equal(normalizeIdentityName("Barre des Écrins"), "barredesecrins");
});

const exactRoute = {
  routeId: "route-1",
  routeName: "South Climb",
  destinationName: "Mount Adams",
  action: "repair",
  findings: ["missing_route_shape"],
  publisher: "Washington Trails Association",
  url: "https://www.wta.org/go-hiking/hikes/mount-adams-south-climb",
  supports: ["route_identity", "distance"],
  sourceRouteName: "Mount Adams South Climb",
};

test("accepts exact audited route names and rejects loose matches", () => {
  assert.deepEqual(exactRouteSourceLink(exactRoute), {
    type: "wta",
    id: "https://www.wta.org/go-hiking/hikes/mount-adams-south-climb",
  });
  assert.equal(exactRouteSourceLink({ ...exactRoute, sourceRouteName: "North Cleaver" }), null);
  assert.equal(exactRouteSourceLink({
    ...exactRoute,
    findings: ["route_name_differs_from_standard"],
  }), null);
  assert.equal(exactRouteSourceLink({ ...exactRoute, action: "supersede" }), null);
});

test("builds missing destination IDs and fails on conflicts", () => {
  const fixture = [{
    destinationId: "destination-1",
    name: "Mount Baker",
    peakbaggerId: "1633",
    externalIds: { listsofjohn: "16671" },
  }];
  const current = [{
    id: "destination-1",
    name: "Mount Baker",
    externalIds: { peakbagger: "1633" },
  }];
  assert.deepEqual(buildDestinationUpdates(
    fixture,
    [{ destinationId: "destination-1", url: "https://www.summitpost.org/mount-baker/150195" }],
    current
  ), [{
    destinationId: "destination-1",
    externalIds: { listsofjohn: "16671", summitpost: "150195" },
  }]);
  assert.throws(
    () => buildDestinationUpdates(fixture, [], [{ ...current[0], externalIds: { peakbagger: "999" } }]),
    /wrong Peakbagger ID/
  );
});

test("deduplicates reviewed route links", () => {
  assert.deepEqual(buildRouteUpdates([exactRoute, exactRoute]), [{
    routeId: "route-1",
    expectedLinks: [],
    links: [{
      type: "wta",
      id: "https://www.wta.org/go-hiking/hikes/mount-adams-south-climb",
    }],
  }]);
});

test("repairs only an unchanged reviewed route array", () => {
  const fixture = {
    routeId: "route-1",
    name: "South Climb",
    expectedLinks: [
      { type: "wta", id: "mount-adams-south-climb" },
      { type: "usfs", id: "123" },
    ],
    links: [{ type: "wta", id: "mount-adams-south-climb" }],
  };
  assert.deepEqual(buildRouteRepairUpdates([fixture], [{
    id: "route-1",
    name: "South Climb",
    links: fixture.expectedLinks,
  }]), [{ routeId: "route-1", expectedLinks: fixture.expectedLinks, links: fixture.links }]);
  assert.deepEqual(buildRouteRepairUpdates([fixture], [{
    id: "route-1",
    name: "South Climb",
    links: fixture.links,
  }]), []);
  assert.throws(() => buildRouteRepairUpdates([fixture], [{
    id: "route-1",
    name: "South Climb",
    links: [],
  }]), /changed since review/);
});
