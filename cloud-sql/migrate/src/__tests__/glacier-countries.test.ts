import assert from "node:assert/strict";
import { test } from "node:test";
import { assignGlacierCountries, type CountryBoundarySnapshot } from "../glaciers/countries";
import { outlineMetrics, type Outline, type OutlineMetrics } from "../glaciers/outline-geometry";
import { glacierPlaceProvenance, manifestSha256, validateGlacierManifest } from "../import-glacier-manifest";
import { loadRainierOsmPackage, loadRainierOutlineReview } from "../import-rainier-glaciers";
import { loadBakerOutlineReview } from "../import-baker-glaciers";
import { loadGlacierPeakOutlineReview } from "../import-glacier-peak-glaciers";

const origin = { lng: 6.9, lat: 45.9 };
const rectangle = (west: number, east: number, height = 0.01): Outline => ({ type: "MultiPolygon",
  coordinates: [[[[origin.lng + west, origin.lat], [origin.lng + east, origin.lat],
    [origin.lng + east, origin.lat + height], [origin.lng + west, origin.lat + height], [origin.lng + west, origin.lat]]]] });
const snapshot = (boundaries: [string, Outline][]): CountryBoundarySnapshot => ({
  source_url: "https://example.test/osm-country-snapshot", source_sha256: "a".repeat(64), snapshot_at: "2026-10-29",
  countries: boundaries.map(([country_code, boundary], i) => ({ country_code, boundary, admin_level: 2, osm_key: `relation:${i + 1}` })),
});

test("a synthetic border crossing keeps both countries and selects the larger overlap", () => {
  const outline = rectangle(0, 0.01), source = snapshot([["IT", rectangle(0.007, 0.02)], ["FR", rectangle(-0.01, 0.007)]]);
  const result = assignGlacierCountries(outline, source, origin);
  assert.equal(result.country_code, "FR");
  assert.deepEqual(result.country_codes, ["FR", "IT"]);
  assert.ok(Math.abs(result.country_assignment.overlaps[0].share - 0.7) < 0.0001);
  assert.deepEqual(assignGlacierCountries(outline, { ...source, countries: [...source.countries].reverse() }, origin), result,
    "input country order cannot change the hash");
});

test("a sole country and a small glacier retain a one-element list", () => {
  const source = snapshot([["FR", rectangle(-0.01, 0.02)], ["IT", rectangle(0.03, 0.04)]]);
  for (const outline of [rectangle(0, 0.01), rectangle(0, 0.00001)]) {
    const result = assignGlacierCountries(outline, source, origin);
    assert.equal(result.country_code, "FR");
    assert.deepEqual(result.country_codes, ["FR"]);
    assert.equal(result.country_assignment.overlaps.length, 1);
  }
});

test("secondary slivers use the greater of 0.01 km² and 1%, and remain in the audit", () => {
  for (const [size, sliver] of [[0.01, 0.00001], [0.1, 0.0009]]) {
    const outline = rectangle(0, size, size), divide = size - sliver;
    const result = assignGlacierCountries(outline, snapshot([["FR", rectangle(-0.01, divide, size)],
      ["IT", rectangle(divide, size + 0.01, size)]]), origin);
    assert.deepEqual(result.country_codes, ["FR"]);
    const dropped = result.country_assignment.overlaps.find(c => c.country_code === "IT")!;
    assert.equal(dropped.kept, false);
    assert.ok(dropped.area_km2 > 0);
    assert.ok(dropped.area_km2 < result.country_assignment.minimum_secondary_overlap_km2);
    if (size === 0.1) assert.ok(dropped.area_km2 > 0.01, "the percentage cutoff must govern a larger outline");
  }
});

test("an exact cutoff is included, and equal rounded overlaps choose alphabetical ISO", () => {
  const outline = rectangle(0, 0.01), other = rectangle(0.01, 0.02);
  const source = snapshot([["IT", outline], ["FR", other]]);
  const metrics: OutlineMetrics = { ...outlineMetrics(origin), area: () => 1,
    overlap: (_a, b) => ({ intersection_km2: b === outline ? 0.99 : 0.01, iou: 0, osm_share: 0, candidate_share: 0 }) };
  assert.deepEqual(assignGlacierCountries(outline, source, origin, metrics).country_codes, ["FR", "IT"]);
  const tie = { ...metrics, overlap: () => ({ intersection_km2: 0.50000000001, iou: 0, osm_share: 0, candidate_share: 0 }) };
  assert.equal(assignGlacierCountries(outline, source, origin, tie).country_code, "FR");
});

test("country evidence fails closed on absent coverage, invalid sources and duplicate countries", () => {
  const outline = rectangle(0, 0.01), source = snapshot([["FR", rectangle(0.02, 0.03)]]);
  assert.throws(() => assignGlacierCountries(outline, source, origin), /No country covers/);
  assert.throws(() => assignGlacierCountries(outline, { ...source, source_sha256: "bad" }, origin), /snapshot provenance/);
  assert.throws(() => assignGlacierCountries(outline, { ...source, countries: [...source.countries, ...source.countries] }, origin), /unique ISO/);
});

test("country lists persist in catalog metadata, bind the hash and require matching outline evidence", () => {
  const base = loadRainierOsmPackage(), p = base.places[0];
  const countries = assignGlacierCountries(p.boundary, snapshot([["US", p.boundary]]), base.parent);
  const place = { ...p, ...countries }, manifest = { ...base, places: [place] };
  validateGlacierManifest(manifest);
  assert.deepEqual(glacierPlaceProvenance(manifest, place).catalog.country_codes, ["US"]);
  assert.notEqual(manifestSha256(manifest), manifestSha256({ ...base, places: [p] }));
  assert.throws(() => validateGlacierManifest({ ...manifest, places: [{ ...place, country_codes: ["US", "CA"] }] }), /countries/);
  assert.throws(() => validateGlacierManifest({ ...manifest, places: [{ ...place, country_code: "CA" }] }), /countries/);
  assert.throws(() => validateGlacierManifest({ ...manifest, places: [{ ...place,
    country_assignment: { ...countries.country_assignment, outline_sha256: "0".repeat(64) } }] }), /country assignment/);
});

test("country support does not add fields to applied US packages or change their reviewed hashes", () => {
  for (const [load, expected] of [
    [loadRainierOutlineReview, "a47c05a3e67d8e8c59d15de5b971844a61572864b6406008a73a30ac293eeca7"],
    [loadBakerOutlineReview, "05f2ef2e0fa9ec7a247ef09253a0308bb957abf2556afe870b20b4993be16c7e"],
    [loadGlacierPeakOutlineReview, "34d7b0da90a1a93ec72088a1821f7a4401bf9290a324a33e18ca812610423ce7"],
  ] as const) {
    const manifest = load().manifest;
    assert.equal(manifest.manifest_sha256, expected);
    for (const p of manifest.places) {
      assert.equal("country_codes" in p, false);
      assert.equal("country_codes" in glacierPlaceProvenance(manifest, p).catalog, false);
    }
  }
});
