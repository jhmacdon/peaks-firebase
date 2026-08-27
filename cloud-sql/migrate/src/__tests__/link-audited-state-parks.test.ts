import assert from "node:assert/strict";
import test from "node:test";
import {
  STATE_PARK_LINK_INSERT_SQL,
  STATE_PARK_LINK_PREFLIGHT_SQL,
  auditedStateParkPairs,
  parseLinkAuditedStateParksArgs,
} from "../link-audited-state-parks";
import type { StateParkAuditReport } from "../audit-state-parks";

function report(): StateParkAuditReport {
  return {
    source: {
      name: "USGS PAD-US",
      version: "4.1",
      endpoint: "https://example.com/padus",
      designation: "SP",
      toleranceM: 50,
    },
    scope: { stateCode: null, summitCount: 2, ultraCount: 1, stateCount: 2 },
    summary: {
      candidateFeatureCount: 2,
      relevantParkCount: 2,
      matchedSummitCount: 2,
      matchedUltraCount: 1,
      parksMissingFromCatalog: 2,
      parkLinksMissing: 2,
      matchedUltrasMissingCover: 0,
      matchedUltrasMissingCoverCredit: 0,
      matchedUltrasMissingStandardRoute: 0,
      matchedUltrasMissingRouteTrailhead: 0,
    },
    parks: [
      {
        areaId: "park-a",
        name: "Park A",
        stateCodes: ["CA"],
        sourcePaid: "a",
        sourceFeatureCount: 1,
        presentInCatalog: false,
      },
      {
        areaId: "park-b",
        name: "Park B",
        stateCodes: ["NH"],
        sourcePaid: "b",
        sourceFeatureCount: 1,
        presentInCatalog: false,
      },
    ],
    destinations: [
      {
        id: "summit-b",
        name: "Summit B",
        stateCode: "NH",
        prominenceM: null,
        isUltra: false,
        hasCover: false,
        hasCoverCredit: false,
        hasStandardRoute: false,
        hasRouteTrailhead: false,
        parks: [{ areaId: "park-b", name: "Park B", distanceM: 0, covers: true, linked: false }],
      },
      {
        id: "summit-a",
        name: "Summit A",
        stateCode: "CA",
        prominenceM: 1500,
        isUltra: true,
        hasCover: true,
        hasCoverCredit: true,
        hasStandardRoute: true,
        hasRouteTrailhead: true,
        parks: [{ areaId: "park-a", name: "Park A", distanceM: 0, covers: true, linked: false }],
      },
    ],
  };
}

test("link args require a report and keep apply explicit", () => {
  assert.deepEqual(parseLinkAuditedStateParksArgs(["--report=/tmp/audit.json"]), {
    report: "/tmp/audit.json",
    apply: false,
  });
  assert.deepEqual(
    parseLinkAuditedStateParksArgs(["--report=/tmp/audit.json", "--apply"]),
    { report: "/tmp/audit.json", apply: true }
  );
  assert.throws(() => parseLinkAuditedStateParksArgs([]), /--report/);
  assert.throws(
    () => parseLinkAuditedStateParksArgs(["--report=/tmp/audit.json", "--replace"]),
    /Unknown argument/
  );
});

test("reviewed pairs are stable, unique, and restricted to report parks", () => {
  const value = report();
  value.destinations.push(value.destinations[0]);
  assert.deepEqual(auditedStateParkPairs(value), [
    { destinationId: "summit-a", areaId: "park-a" },
    { destinationId: "summit-b", areaId: "park-b" },
  ]);
  value.destinations[0].parks[0].areaId = "unknown";
  assert.throws(() => auditedStateParkPairs(value), /unknown park/);
});

test("reviewed pairs reject source or tolerance drift", () => {
  const value = report();
  value.source.toleranceM = 51;
  assert.throws(() => auditedStateParkPairs(value), /not approved/);
});

test("link SQL fails closed and inserts only spatially rechecked state parks", () => {
  assert.match(STATE_PARK_LINK_PREFLIGHT_SQL, /missing_destinations/);
  assert.match(STATE_PARK_LINK_PREFLIGHT_SQL, /wrong_area_kind/);
  assert.match(STATE_PARK_LINK_PREFLIGHT_SQL, /outside_tolerance/);
  assert.match(STATE_PARK_LINK_PREFLIGHT_SQL, /ST_Covers/);
  assert.match(STATE_PARK_LINK_PREFLIGHT_SQL, /ST_DWithin/);
  assert.match(STATE_PARK_LINK_INSERT_SQL, /a\.kind::text = 'state_park'/);
  assert.match(STATE_PARK_LINK_INSERT_SQL, /'summit'::destination_feature/);
  assert.match(STATE_PARK_LINK_INSERT_SQL, /'contained_by', 'postgis'/);
  assert.match(STATE_PARK_LINK_INSERT_SQL, /ON CONFLICT \(destination_id, area_id\) DO NOTHING/);
});
