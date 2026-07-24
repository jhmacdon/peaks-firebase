import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildGridCoverage,
  buildPeakCatalogIndex,
  CatalogPeak,
  compareRankedCandidates,
  matchReferencePeak,
  matchReferencePeakFromIndex,
  normalizePeakName,
  parseElevationMeters,
  rankCoverageCandidate,
  ReferencePeak,
} from "../peak-coverage";
import {
  buildOverpassQuery,
  buildCountryOverpassQuery,
  parseArgs,
  parseReferencePeaks,
} from "../audit-peak-coverage";

function reference(overrides: Partial<ReferencePeak> = {}): ReferencePeak {
  return {
    osmId: "osm-1",
    name: "Silver Peak",
    lat: 47.36154,
    lng: -121.46127,
    elevationM: 1_709,
    wikidataId: null,
    wikipedia: null,
    ...overrides,
  };
}

function catalog(overrides: Partial<CatalogPeak> = {}): CatalogPeak {
  return {
    id: "destination-1",
    name: "Silver Peak",
    lat: 47.36155,
    lng: -121.46128,
    osmId: null,
    ...overrides,
  };
}

test("normalizes punctuation, accents, and ampersands for name matching", () => {
  assert.equal(normalizePeakName("  Denny’s Peak & Knob  "), "dennys peak and knob");
  assert.equal(normalizePeakName("Mont-Tremblant"), "mont tremblant");
  assert.equal(normalizePeakName("Cráter Peak"), "crater peak");
});

test("validates audit CLI options and requests full node geometry", () => {
  const args = parseArgs([
    "--state=or",
    "--format=json",
    "--limit=25",
    "--min-elevation=1000",
    "--min-grid-reference=5",
    "--bbox=-122,48.2,-120.5,49",
  ]);
  assert.equal(args.stateCode, "OR");
  assert.equal(args.countryCode, "US");
  assert.equal(args.format, "json");
  assert.equal(args.limit, 25);
  assert.equal(args.minimumCandidateElevationM, 1000);
  assert.equal(args.minimumGridReferencePeaks, 5);
  assert.deepEqual(args.bbox, {
    minLng: -122,
    minLat: 48.2,
    maxLng: -120.5,
    maxLat: 49,
  });
  assert.throws(() => parseArgs(["--state=Washington"]), /two-letter/);
  assert.throws(() => parseArgs(["--format=csv"]), /summary or json/);
  assert.throws(() => parseArgs(["--state=WA", "--country=CA"]), /either --state or --country/);
  assert.throws(() => parseArgs(["--bbox=-122,48.2,-120.5"]), /minLng,minLat,maxLng,maxLat/);
  assert.throws(() => parseArgs(["--bbox=-120,49,-122,48.2"]), /ordered/);

  const query = buildOverpassQuery("WA");
  assert.match(query, /ISO3166-2"="US-WA/);
  assert.match(query, /natural"="peak/);
  assert.match(query, /out body;/, "coordinates are required for spatial matching");

  const boundedQuery = buildOverpassQuery("WA", args.bbox);
  assert.doesNotMatch(boundedQuery, /ISO3166-2/);
  assert.match(boundedQuery, /\(48\.2,-122,49,-120\.5\)/);

  const countryArgs = parseArgs(["--country=ca"]);
  assert.equal(countryArgs.stateCode, null);
  assert.equal(countryArgs.countryCode, "CA");
  assert.match(buildCountryOverpassQuery("CA"), /ISO3166-1"="CA/);
});

test("parses named Overpass nodes and honors ele:ft", () => {
  const peaks = parseReferencePeaks({
    elements: [
      {
        type: "node",
        id: 9196640751,
        lat: 47.8557129,
        lon: -120.799365,
        tags: {
          name: "Dirtyface Mountain-East",
          natural: "peak",
          ele: "9999",
          "ele:ft": "5989",
          wikidata: "Q123",
        },
      },
      { type: "node", id: 2, tags: { name: "No Coordinates" } },
    ],
  }, "WA");

  assert.equal(peaks.length, 1);
  assert.equal(peaks[0].osmId, "9196640751");
  assert.ok(Math.abs((peaks[0].elevationM ?? 0) - 1825.45) < 0.1);
  assert.equal(peaks[0].wikidataId, "Q123");

  const outsideBounds = parseReferencePeaks({
    elements: [{
      type: "node",
      id: 3,
      lat: 47,
      lon: -120,
      tags: { name: "Outside Peak", natural: "peak", ele: "1500" },
    }],
  }, "WA", { minLng: -122, minLat: 48.2, maxLng: -120.5, maxLat: 49 });
  assert.deepEqual(outsideBounds, []);
});

test("parses metric, explicit imperial, and known bare-feet OSM elevations", () => {
  assert.equal(parseElevationMeters("1709.3"), 1709.3);
  assert.ok(Math.abs((parseElevationMeters("5989 ft") ?? 0) - 1825.45) < 0.1);
  assert.ok(Math.abs((parseElevationMeters("7908", 5_000) ?? 0) - 2410.36) < 0.1);
  assert.equal(parseElevationMeters("6190", null), 6190, "Alaska must not use the lower-48 feet heuristic");
  assert.equal(parseElevationMeters("unknown"), null);
});

test("OSM ID is the strongest catalog match", () => {
  const ref = reference();
  const wrongButClose = catalog({ id: "close", name: "Other Peak" });
  const exactId = catalog({
    id: "osm-match",
    name: "Mapped Silver Peak",
    lat: 47.37,
    lng: -121.47,
    osmId: ref.osmId,
  });

  const match = matchReferencePeak(ref, [wrongButClose, exactId]);
  assert.equal(match.method, "osm_id");
  assert.equal(match.destinationId, "osm-match");
});

test("matches a differently named summit inside the spatial threshold", () => {
  const match = matchReferencePeak(
    reference({ name: "Tinkham West Peak" }),
    [catalog({ name: "Tinkham West", lat: 47.3618, lng: -121.46127 })]
  );
  assert.equal(match.method, "spatial");
});

test("matches a normalized identical name within the wider coordinate tolerance", () => {
  const match = matchReferencePeak(
    reference({ name: "Dirtyface Mountain-East" }),
    [catalog({
      name: "Dirtyface Mountain East",
      lat: 47.3665,
      lng: -121.46127,
    })]
  );
  assert.equal(match.method, "name_spatial");
  assert.ok((match.distanceMeters ?? 0) > 150);
  assert.ok((match.distanceMeters ?? 0) < 1_000);
});

test("indexed matching preserves OSM, spatial, and same-name match rules", () => {
  const exactId = catalog({
    id: "osm-match",
    name: "Mapped Peak",
    lat: 48,
    lng: -122,
    osmId: "osm-exact",
  });
  const spatial = catalog({
    id: "spatial-match",
    name: "Other Name",
    lat: 47.3618,
    lng: -121.46127,
  });
  const sameName = catalog({
    id: "name-match",
    name: "Dirtyface Mountain East",
    lat: 47.3665,
    lng: -121.46127,
  });
  const index = buildPeakCatalogIndex([exactId, spatial, sameName]);

  assert.equal(
    matchReferencePeakFromIndex(reference({ osmId: "osm-exact" }), index).destinationId,
    "osm-match"
  );
  assert.equal(
    matchReferencePeakFromIndex(reference({ name: "Different Peak" }), index).method,
    "spatial"
  );
  const nameIndex = buildPeakCatalogIndex([sameName]);
  assert.equal(
    matchReferencePeakFromIndex(reference({
      name: "Dirtyface Mountain-East",
      lat: 47.36154,
      lng: -121.46127,
    }), nameIndex).method,
    "name_spatial"
  );
});

test("leaves a distinct distant summit unmatched and reports its nearest catalog row", () => {
  const match = matchReferencePeak(
    reference({ name: "Pinnacle Peak" }),
    [catalog({ name: "Pitcher Mountain", lat: 47.40, lng: -121.46 })]
  );
  assert.equal(match.method, null);
  assert.equal(match.destinationName, "Pitcher Mountain");
  assert.ok((match.distanceMeters ?? 0) > 1_000);
});

test("recorded summit crossings dominate candidate priority", () => {
  const trackProven = rankCoverageCandidate(
    matchReferencePeak(reference({ name: "Pinnacle Peak" }), []),
    { sessionsWithin30m: 1, sessionsWithin100m: 1, sessionsWithin250m: 1 }
  );
  const referenceOnly = rankCoverageCandidate(
    matchReferencePeak(reference({
      osmId: "osm-2",
      name: "Known Mountain",
      wikidataId: "Q123",
      wikipedia: "en:Known Mountain",
      elevationM: 3_000,
    }), []),
    { sessionsWithin30m: 0, sessionsWithin100m: 0, sessionsWithin250m: 0 }
  );

  assert.equal(trackProven.confidence, "track_proven");
  assert.equal(referenceOnly.confidence, "strong_reference");
  assert.ok(trackProven.priorityScore > referenceOnly.priorityScore);
  assert.deepEqual([referenceOnly, trackProven].sort(compareRankedCandidates), [trackProven, referenceOnly]);
});

test("flags generic points and likely directional subpeaks for review", () => {
  const point = rankCoverageCandidate(
    matchReferencePeak(reference({ name: "Point 5870" }), []),
    { sessionsWithin30m: 0, sessionsWithin100m: 0, sessionsWithin250m: 0 }
  );
  const subpeak = rankCoverageCandidate(
    matchReferencePeak(reference({ osmId: "osm-2", name: "Guye Peak North" }), []),
    { sessionsWithin30m: 0, sessionsWithin100m: 0, sessionsWithin250m: 0 }
  );

  assert.ok(point.reviewFlags.includes("generic_name"));
  assert.ok(subpeak.reviewFlags.includes("possible_subpeak"));
});

test("aggregates coverage into stable half-degree cells", () => {
  const matched = matchReferencePeak(reference(), [catalog()]);
  const missing = matchReferencePeak(reference({
    osmId: "osm-2",
    name: "Abiel Peak",
    lat: 47.35,
    lng: -121.47,
  }), []);
  const otherCell = matchReferencePeak(reference({
    osmId: "osm-3",
    name: "Mount Baker",
    lat: 48.77,
    lng: -121.81,
  }), []);

  const grids = buildGridCoverage([matched, missing, otherCell]);
  const snoqualmie = grids.find((grid) => grid.grid === "47.0,-121.5");
  assert.equal(snoqualmie?.referencePeaks, 2);
  assert.equal(snoqualmie?.matchedPeaks, 1);
  assert.equal(snoqualmie?.coveragePercent, 50);
  assert.equal(grids.find((grid) => grid.grid === "48.5,-122.0")?.missingPeaks, 1);
});
