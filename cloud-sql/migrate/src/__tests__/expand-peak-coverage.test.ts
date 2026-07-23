import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  ExpansionCatalogPeak,
  deduplicatePeakSelections,
  parseExpansionArgs,
  selectOsmIdBackfills,
} from "../expand-peak-coverage";
import { matchReferencePeak, ReferencePeak } from "../peak-coverage";
import { selectPeakCandidate } from "../peak-coverage-enrichment";
import { ISO_COUNTRY_CODES, US_STATE_CODES } from "../peak-coverage-jurisdictions";

function reference(overrides: Partial<ReferencePeak> = {}): ReferencePeak {
  return {
    osmId: "123",
    name: "Silver Peak",
    lat: 47.36154,
    lng: -121.46127,
    elevationM: 1_709,
    wikidataId: "Q123",
    wikipedia: null,
    ...overrides,
  };
}

function catalog(overrides: Partial<ExpansionCatalogPeak> = {}): ExpansionCatalogPeak {
  return {
    id: "destination-1",
    name: "Silver Peak",
    lat: 47.36155,
    lng: -121.46128,
    osmId: null,
    wikidataId: null,
    ...overrides,
  };
}

test("enumerates all US state-level and ISO country jurisdictions", () => {
  assert.equal(US_STATE_CODES.length, 51);
  assert.equal(new Set(US_STATE_CODES).size, 51);
  assert.equal(ISO_COUNTRY_CODES.length, 249);
  assert.equal(new Set(ISO_COUNTRY_CODES).size, 249);
  assert.ok(ISO_COUNTRY_CODES.includes("US"));
});

test("parses dry-run and batch expansion modes", () => {
  const state = parseExpansionArgs(["--state=wa", "--prominence-feet=300"]);
  assert.equal(state.apply, false);
  assert.equal(state.scopes[0].key, "US-WA");
  assert.ok(Math.abs(state.minimumProminenceM - 91.44) < 0.001);

  const countries = parseExpansionArgs([
    "--countries=ca,mx",
    "--apply",
    "--max-additions=25",
    "--concurrency=3",
    "--resume",
    "--report-dir=/tmp/reports",
  ]);
  assert.equal(countries.apply, true);
  assert.deepEqual(countries.scopes.map((scope) => scope.key), ["CA", "MX"]);
  assert.equal(countries.maxAdditionsPerScope, 25);
  assert.equal(countries.concurrency, 3);
  assert.equal(countries.resume, true);
  assert.throws(() => parseExpansionArgs([]), /Choose exactly one/);
  assert.throws(() => parseExpansionArgs(["--state=WA", "--country=US"]), /Choose exactly one/);
  assert.throws(() => parseExpansionArgs(["--all-countries", "--concurrency=5"]), /from 1 to 4/);
  assert.throws(() => parseExpansionArgs(["--all-countries", "--resume"]), /requires --apply/);
});

test("selects a unique normalized-name OSM ID backfill", () => {
  const existing = catalog();
  const match = matchReferencePeak(reference(), [existing]);
  const result = selectOsmIdBackfills([match], [existing]);
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].destinationId, existing.id);
  assert.equal(result.selected[0].osmId, "123");
});

test("prefers the unique exact-name reference when multiple OSM nodes match one destination", () => {
  const existing = catalog();
  const exact = matchReferencePeak(reference(), [existing]);
  const alternate = matchReferencePeak(reference({
    osmId: "456",
    name: "Silver Peak North",
    lat: 47.36156,
    lng: -121.46129,
  }), [existing]);
  const result = selectOsmIdBackfills([alternate, exact], [existing]);
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].osmId, "123");
  assert.deepEqual(result.ambiguousDestinationIds, []);
});

test("does not backfill a differently named reference outside the very-close tolerance", () => {
  const existing = catalog({ name: "Other Mountain", lat: 47.3623, lng: -121.46127 });
  const match = matchReferencePeak(reference(), [existing]);
  assert.equal(match.method, "spatial");
  assert.ok((match.distanceMeters ?? 0) > 30);
  assert.equal(selectOsmIdBackfills([match], [existing]).selected.length, 0);
});

test("does not backfill even an identical name when coordinates differ by more than 500m", () => {
  const existing = catalog({ lat: 47.367, lng: -121.46127 });
  const match = matchReferencePeak(reference(), [existing]);
  assert.equal(match.method, "name_spatial");
  assert.ok((match.distanceMeters ?? 0) > 500);
  assert.equal(selectOsmIdBackfills([match], [existing]).selected.length, 0);
});

test("collapses same-name nearby OSM nodes before a bulk insert", () => {
  const evidence = { sessionsWithin30m: 1, sessionsWithin100m: 1, sessionsWithin250m: 1 };
  const older = selectPeakCandidate(
    matchReferencePeak(reference({ osmId: "100", lat: 47, lng: -121 }), []),
    evidence,
    undefined,
    undefined
  );
  const duplicate = selectPeakCandidate(
    matchReferencePeak(reference({ osmId: "200", lat: 47.00002, lng: -121 }), []),
    evidence,
    undefined,
    undefined
  );
  const distant = selectPeakCandidate(
    matchReferencePeak(reference({ osmId: "300", lat: 47.01, lng: -121 }), []),
    evidence,
    undefined,
    undefined
  );
  const result = deduplicatePeakSelections([duplicate, distant, older]);
  assert.deepEqual(result.selected.map((selection) => selection.match.reference.osmId), ["100", "300"]);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].skipped.match.reference.osmId, "200");
  assert.equal(result.skipped[0].kept.match.reference.osmId, "100");
});
