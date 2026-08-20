import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  applyRouteUseClass,
  normalizeBlmSeasonRestriction,
  normalizeBlmSurface,
  normalizeRouteUseClassValue,
  parseRouteUseClassMap,
} from "../roads/blm-classes";

const SAMPLE_MAP = [
  { raw_value: null, canonical_class: "unknown" },
  { raw_value: "", canonical_class: "unknown" },
  { raw_value: " ", canonical_class: "unknown" },
  { raw_value: "2wd Low", canonical_class: "2wd" },
  { raw_value: "2WD LOW", canonical_class: "2wd" },
  { raw_value: "4WD Low", canonical_class: "4wd" },
  { raw_value: "4WD High Clearance/Specialized", canonical_class: "4wd_high_clearance" },
  { raw_value: "Primitive Road - 4WD high clearance", canonical_class: "4wd_high_clearance" },
  { raw_value: "ATV", canonical_class: "atv" },
  { raw_value: "Non-Motorized", canonical_class: "unknown" },
]
  .map((row) => JSON.stringify(row))
  .join("\n");

test("the map loads and indexes every row", () => {
  const map = parseRouteUseClassMap(SAMPLE_MAP);
  assert.equal(map.size, 10);
  assert.equal(applyRouteUseClass(map, "2wd Low").routeClass, "2wd");
  assert.equal(applyRouteUseClass(map, "2wd Low").match, "exact");
});

test("a class outside the canonical set stops the load", () => {
  assert.throws(
    () => parseRouteUseClassMap('{"raw_value":"x","canonical_class":"jeep"}'),
    /unknown canonical_class/,
  );
  assert.throws(() => parseRouteUseClassMap("\n  \n"), /no rows/);
});

test("null, empty and blank raw values each resolve", () => {
  const map = parseRouteUseClassMap(SAMPLE_MAP);
  assert.equal(applyRouteUseClass(map, null).routeClass, "unknown");
  assert.equal(applyRouteUseClass(map, "").routeClass, "unknown");
  assert.equal(applyRouteUseClass(map, " ").routeClass, "unknown");
});

test("a spelling the map has not seen falls back on case and spacing", () => {
  const map = parseRouteUseClassMap(SAMPLE_MAP);
  const result = applyRouteUseClass(map, "4WD HIGH CLEARANCE / SPECIALIZED");
  assert.equal(result.routeClass, "4wd_high_clearance");
  assert.equal(result.match, "normalized");
});

test("a genuinely new value is reported, not folded into unknown", () => {
  const map = parseRouteUseClassMap(SAMPLE_MAP);
  const result = applyRouteUseClass(map, "6WD Amphibious");
  assert.equal(result.routeClass, null);
  assert.equal(result.match, "unmapped");
});

test("normalizing collapses case, padding and the spaces around a slash", () => {
  assert.equal(
    normalizeRouteUseClassValue("4WD High Clearance/ Specialized"),
    normalizeRouteUseClassValue("4wd High Clearance / Specialized"),
  );
  assert.equal(normalizeRouteUseClassValue("2WD  LOW"), "2wd low");
});

test("the reviewed map covers every value the BLM extract carries", () => {
  // The real map, not the sample: it was reviewed once against the full
  // distinct list, and a refresh that adds a spelling should fail this.
  const mapPath = path.join(
    __dirname,
    "../../../../../docs/trailheads/data/blm-route-use-class-map.jsonl",
  );
  let contents: string;
  try {
    contents = readFileSync(mapPath, "utf8");
  } catch {
    return; // The data directory lives in the peaks checkout, not this repo.
  }
  const map = parseRouteUseClassMap(contents);
  for (const value of [
    "Unknown",
    null,
    "4WD High Clearance/Specialized",
    "4WD LOW",
    "4WD HIGH CLEARANCE / SPECIALIZED",
    "4wd Low",
    "2WD LOW",
    "4wd High Clearance / Specialized",
    "2wd Low",
    "ATV",
    "UTV",
    "Motorized Single Track",
    "",
    " ",
    "Non-Mechanized",
    "Primitive Road - 4WD high clearance",
    "Primitive Road - 4WD low clearance",
    "Over Snow Vehicle",
    "Trail - UTV",
  ]) {
    assert.notEqual(
      applyRouteUseClass(map, value).match,
      "unmapped",
      `unmapped: ${JSON.stringify(value)}`,
    );
  }
});

test("BLM surfaces fold onto the shared enum", () => {
  assert.equal(normalizeBlmSurface("Natural"), "native");
  assert.equal(normalizeBlmSurface("NATURAL"), "native");
  assert.equal(normalizeBlmSurface(" Natural"), "native");
  assert.equal(normalizeBlmSurface("Natural Improved"), "improved_native");
  assert.equal(normalizeBlmSurface("AGGREGATE"), "aggregate");
  assert.equal(normalizeBlmSurface("Gravel/Aggregate"), "aggregate");
  assert.equal(normalizeBlmSurface("Solid Surface"), "asphalt");
  assert.equal(normalizeBlmSurface("Paved"), "asphalt");
  assert.equal(normalizeBlmSurface("Other"), "other");
});

test("an unknown or absent BLM surface is null", () => {
  assert.equal(normalizeBlmSurface("Unknown"), null);
  assert.equal(normalizeBlmSurface(" "), null);
  assert.equal(normalizeBlmSurface(null), null);
  assert.equal(normalizeBlmSurface("Rammed Earth"), null);
});

test("the BLM seasonal flag is a flag, and UNK is not a no", () => {
  assert.equal(normalizeBlmSeasonRestriction("YES"), true);
  assert.equal(normalizeBlmSeasonRestriction("Yes"), true);
  assert.equal(normalizeBlmSeasonRestriction("NO"), false);
  assert.equal(normalizeBlmSeasonRestriction("No"), false);
  assert.equal(normalizeBlmSeasonRestriction("UNK"), null);
  assert.equal(normalizeBlmSeasonRestriction("N/A"), null);
  assert.equal(normalizeBlmSeasonRestriction(null), null);
});
