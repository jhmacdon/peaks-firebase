import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadCountryBoundaries } from "../glaciers/country-boundaries";
import { assignGlacierCountries, validateGlacierCountries } from "../glaciers/countries";
import { parseOsmGlaciers } from "../glaciers/osm";
import { sha256 } from "../import-glacier-manifest";

const dir = join(__dirname, "../../data/glaciers-mont-blanc-2026-10-29");
const countryFile = join(dir, "countries-overpass.json");
const countryHash = "402066c755cdbe84a4ede02da33936cb04216671ce42e60d19f7e7182ce4aa99";
const sourceUrl = "https://overpass-api.de/api/interpreter";
const extent: [number, number, number, number] = [6.5, 45.5, 7.4, 46.3];
const snapshot = loadCountryBoundaries(countryFile, countryHash, sourceUrl, extent, ["FR", "IT", "CH"]);
const raw = readFileSync(join(dir, "mont-blanc-glaciers-overpass-de.json"));
assert.equal(sha256(raw), "2d591ac91326122989ead78bab828375c1c695e07b8ece2b1fe9aa7dace0f979");
const glaciers = parseOsmGlaciers(JSON.parse(raw.toString()), {
  roster: ["relation:106239", "relation:106155", "relation:2589255", "way:188343637"],
});
const origin = { lng: 6.9, lat: 45.9 };
const assign = (key: string) => {
  const p = glaciers.find(g => g.osm_key === key)!;
  const result = assignGlacierCountries(p.boundary, snapshot, origin);
  validateGlacierCountries(p.boundary, result);
  return result;
};

test("the real Bossons snapshot retains France and Italy, with France primary", () => {
  const result = assign("relation:106239");
  assert.equal(result.country_code, "FR");
  assert.deepEqual(result.country_codes, ["FR", "IT"]);
  assert.ok(result.country_assignment.overlaps.every(c => c.kept));
});

test("Géant and Miage secondary overlaps are recorded but fall below the requested cutoff", () => {
  for (const [key, primary, secondary] of [["relation:106155", "FR", "IT"], ["relation:2589255", "IT", "FR"]]) {
    const result = assign(key);
    assert.equal(result.country_code, primary);
    assert.deepEqual(result.country_codes, [primary]);
    const dropped = result.country_assignment.overlaps.find(c => c.country_code === secondary)!;
    assert.ok(dropped.area_km2 > 0);
    assert.ok(dropped.area_km2 < result.country_assignment.minimum_secondary_overlap_km2);
    assert.equal(dropped.kept, false);
  }
});

test("Mer de Glace has France only, with no border sliver to drop", () => {
  const result = assign("way:188343637");
  assert.equal(result.country_code, "FR");
  assert.deepEqual(result.country_codes, ["FR"]);
  assert.equal(result.country_assignment.overlaps.length, 1);
  assert.equal(result.country_assignment.overlaps[0].kept, true);
});

test("country source changes and an incorrect primary fail closed", () => {
  assert.throws(() => loadCountryBoundaries(countryFile, "0".repeat(64), sourceUrl, extent, ["FR", "IT", "CH"]), /SHA-256/);
  const bossons = glaciers.find(p => p.osm_key === "relation:106239")!, result = assign("relation:106239");
  assert.throws(() => validateGlacierCountries(bossons.boundary, { ...result, country_code: "IT" }), /country assignment/);
  assert.throws(() => assignGlacierCountries(bossons.boundary, { ...snapshot, extent: [6.89, 45.89, 6.90, 45.90] }, origin), /clip extent/);
});
