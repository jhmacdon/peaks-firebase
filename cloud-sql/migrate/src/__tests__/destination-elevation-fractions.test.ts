import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  auditDestination,
  buildOverpassIdQuery,
  DestinationSnapshot,
  isSafeDirectMetreCandidate,
  OsmElement,
  parseArgs,
  parseOsmHistoryXml,
  parseOsmElevationTags,
  parseWikidataElevationClaims,
  refineCandidateProvenance,
  WikidataEntity,
} from "../audit-destination-elevation-fractions";

function destination(overrides: Partial<DestinationSnapshot> = {}): DestinationSnapshot {
  return {
    id: "destination-1",
    name: "Fraction Peak",
    elevationM: 100,
    lat: 47,
    lng: -121,
    type: "point",
    features: ["summit"],
    countryCode: "US",
    stateCode: "WA",
    externalIds: { osm: "123" },
    ...overrides,
  };
}

function osm(overrides: Partial<OsmElement> = {}): OsmElement {
  return {
    type: "node",
    id: 123,
    lat: 47,
    lon: -121,
    tags: { natural: "peak", ele: "100.25" },
    ...overrides,
  };
}

function quantity(amount: string, unit: "Q11573" | "Q3710", rank = "preferred") {
  return {
    id: "claim-1",
    rank: rank as "preferred" | "normal",
    mainsnak: {
      snaktype: "value",
      datavalue: { value: { amount, unit: `http://www.wikidata.org/entity/${unit}` } },
    },
  };
}

function wikidata(
  amount: string,
  unit: "Q11573" | "Q3710" = "Q11573",
  withCoordinate = true
): WikidataEntity {
  return {
    claims: {
      P2044: [quantity(amount, unit)],
      ...(withCoordinate ? {
        P625: [{
          rank: "preferred",
          mainsnak: {
            snaktype: "value",
            datavalue: { value: {
              latitude: 47,
              longitude: -121,
              globe: "http://www.wikidata.org/entity/Q2",
            } },
          },
        }],
      } : {}),
    },
  };
}

test("CLI is permanently read-only and produces stable Overpass ID queries", () => {
  assert.throws(() => parseArgs(["--apply"]), /read-only/);
  const args = parseArgs(["--cache-dir=./cache", "--report=./report.json"]);
  assert.ok(args.cacheDir.endsWith("/cache"));
  assert.ok(args.reportPath.endsWith("/report.json"));
  assert.equal(
    buildOverpassIdQuery(["1", "2"], ["3"]),
    "[out:json][timeout:180];\n(\nnode(id:1,2);\nway(id:3);\n);\nout meta center;"
  );
});

test("OSM parsing distinguishes direct metres from foot conversions", () => {
  assert.deepEqual(parseOsmElevationTags({ ele: "1,234.5 m" }), [{
    rawValue: "1,234.5 m", rawUnit: "m", unit: "metre", valueM: 1234.5,
  }]);
  const imperial = parseOsmElevationTags({ ele: "1000 ft", "ele:ft": "1000" });
  assert.equal(imperial.length, 2);
  assert.ok(imperial.every((entry) => entry.unit === "foot"));
  assert.ok(imperial.every((entry) => Math.abs(entry.valueM - 304.8) < 1e-9));
  assert.deepEqual(parseOsmElevationTags({ ele: "100.2;101" }), []);
  assert.deepEqual(parseOsmElevationTags({ ele: "100,5" }), []);
});

test("Wikidata parsing keeps raw units and ignores deprecated claims", () => {
  const entity: WikidataEntity = {
    claims: {
      P2044: [
        quantity("+100.25", "Q11573"),
        { ...quantity("+1000", "Q3710"), rank: "normal" },
        { ...quantity("+999", "Q11573"), rank: "deprecated" },
      ],
    },
  };
  const claims = parseWikidataElevationClaims(entity);
  assert.equal(claims.length, 2);
  assert.deepEqual(claims.map((claim) => claim.unit), ["metre", "foot"]);
  assert.equal(claims[0].rawValue, "+100.25");
  assert.ok(Math.abs(claims[1].valueM - 304.8) < 1e-9);
});

test("final candidate guard allows only a positive fraction in the same whole metre", () => {
  assert.equal(isSafeDirectMetreCandidate(100, 100.25), true);
  assert.equal(isSafeDirectMetreCandidate(100, 101.25), false);
  assert.equal(isSafeDirectMetreCandidate(100, 100), false);
  assert.equal(isSafeDirectMetreCandidate(100, 99.75), false);
  assert.equal(isSafeDirectMetreCandidate(-1, -0.75), false, "negative cross-boundary changes the whole metre");
});

test("direct OSM metre fraction with nearby identity becomes a candidate", () => {
  const result = auditDestination(
    destination(),
    new Map([["node:123", osm()]]),
    new Map()
  );
  assert.equal(result.classification, "direct_metre_fraction_candidate");
  assert.equal(result.applyCandidate, true);
  assert.equal(result.proposedElevationM, 100.25);
});

test("misaligned OSM identity blocks an otherwise safe fraction", () => {
  const result = auditDestination(
    destination(),
    new Map([["node:123", osm({ lat: 48 })]]),
    new Map()
  );
  assert.equal(result.classification, "identity_conflict");
  assert.equal(result.applyCandidate, false);
});

test("Wikidata P625 proves identity for a direct metre fraction", () => {
  const row = destination({ externalIds: { wikidata: "Q123" } });
  const result = auditDestination(row, new Map(), new Map([["Q123", wikidata("+100.4")]]));
  assert.equal(result.classification, "direct_metre_fraction_candidate");
  assert.equal(result.proposedElevationM, 100.4);
});

test("a nearby exact OSM wikidata link can prove an entity without P625", () => {
  const row = destination({ externalIds: { osm: "123", wikidata: "Q123" } });
  const linkedOsm = osm({ tags: { natural: "peak", wikidata: "Q123" } });
  const result = auditDestination(
    row,
    new Map([["node:123", linkedOsm]]),
    new Map([["Q123", wikidata("+100.4", "Q11573", false)]])
  );
  assert.equal(result.classification, "direct_metre_fraction_candidate");
});

test("unproven Wikidata identity and provider conflicts never produce candidates", () => {
  const unproven = auditDestination(
    destination({ externalIds: { wikidata: "Q123" } }),
    new Map(),
    new Map([["Q123", wikidata("+100.4", "Q11573", false)]])
  );
  assert.equal(unproven.classification, "identity_unproven");

  const row = destination({ externalIds: { osm: "123", wikidata: "Q123" } });
  const conflict = auditDestination(
    row,
    new Map([["node:123", osm({ tags: {
      natural: "peak", ele: "100.25", wikidata: "Q123",
    } })]]),
    new Map([["Q123", wikidata("+100.5")]])
  );
  assert.equal(conflict.classification, "direct_source_conflict");
  assert.equal(conflict.applyCandidate, false);
});

test("imperial conversion fractions are reported but never proposed", () => {
  const result = auditDestination(
    destination({ elevationM: 304 }),
    new Map([["node:123", osm({ tags: { natural: "peak", "ele:ft": "1000" } })]]),
    new Map()
  );
  assert.equal(result.classification, "unit_conversion_fraction");
  assert.equal(result.applyCandidate, false);
  assert.equal(result.evidence[0].rawUnit, "ft");
  assert.ok(Math.abs(result.evidence[0].deltaM - 0.8) < 1e-9);
});

test("near values that cross a whole-metre boundary stay review-only", () => {
  const result = auditDestination(
    destination(),
    new Map([["node:123", osm({ tags: { natural: "peak", ele: "99.75" } })]]),
    new Map()
  );
  assert.equal(result.classification, "cross_boundary_near_match");
  assert.equal(result.applyCandidate, false);
});

test("OSM history parser records the raw metre value, version, and timestamp", () => {
  const versions = parseOsmHistoryXml(`<?xml version="1.0"?>
    <osm version="0.6">
      <node id="123" version="1" timestamp="2023-01-01T00:00:00Z" lat="47" lon="-121">
        <tag k="natural" v="peak"/>
        <tag k="ele" v="100"/>
      </node>
      <node id="123" version="2" timestamp="2024-01-01T00:00:00Z" lat="47" lon="-121">
        <tag k="natural" v="peak"/>
        <tag k="ele" v="100.25"/>
      </node>
    </osm>`, "node", "123");
  assert.equal(versions.length, 2);
  assert.deepEqual(versions[1], {
    version: 2,
    timestamp: "2024-01-01T00:00:00Z",
    visible: true,
    rawValue: "100.25",
    rawUnit: "m",
    unit: "metre",
    valueM: 100.25,
  });
});

test("provenance gate keeps old fractions and rejects fractions added after the row", () => {
  const row = destination({ createdAt: "2024-06-01T00:00:00Z" });
  const preliminary = auditDestination(
    row,
    new Map([["node:123", osm({
      timestamp: "2025-01-01T00:00:00Z",
      version: 2,
    })]]),
    new Map()
  );
  const preexisting = refineCandidateProvenance(preliminary, new Map([["node:123", [{
    version: 1,
    timestamp: "2023-01-01T00:00:00Z",
    visible: true,
    rawValue: "100.25",
    rawUnit: "m",
    unit: "metre",
    valueM: 100.25,
  }]]]));
  assert.equal(preexisting.classification, "direct_metre_fraction_candidate");
  assert.equal(preexisting.provenanceTiming?.status, "preexisting");

  const later = refineCandidateProvenance(preliminary, new Map([["node:123", [
    {
      version: 1,
      timestamp: "2023-01-01T00:00:00Z",
      visible: true,
      rawValue: "100",
      rawUnit: "m",
      unit: "metre",
      valueM: 100,
    },
    {
      version: 2,
      timestamp: "2025-01-01T00:00:00Z",
      visible: true,
      rawValue: "100.25",
      rawUnit: "m",
      unit: "metre",
      valueM: 100.25,
    },
  ]]]));
  assert.equal(later.classification, "source_fraction_added_after_destination");
  assert.equal(later.applyCandidate, false);
  assert.equal(later.provenanceTiming?.versionAtOrBeforeCutoff?.rawValue, "100");
});
