import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseArgs, sourcePaths } from "../roads/import-road-network";
import {
  applyRouteUseClass,
  classifyBlmDrivability,
  defaultRouteUseClassMapPath,
  isDrivableBlmRoute,
  normalizeBlmSeasonRestriction,
  normalizeBlmSurface,
  normalizeRouteUseClassValue,
  parseRouteUseClassMap,
} from "../roads/blm-classes";

const SAMPLE_MAP = [
  { raw_value: null, canonical_class: "unknown", drivable: true },
  { raw_value: "", canonical_class: "unknown", drivable: true },
  { raw_value: " ", canonical_class: "unknown", drivable: true },
  { raw_value: "2wd Low", canonical_class: "2wd", drivable: true },
  { raw_value: "2WD LOW", canonical_class: "2wd", drivable: true },
  { raw_value: "4WD Low", canonical_class: "4wd", drivable: true },
  {
    raw_value: "4WD High Clearance/Specialized",
    canonical_class: "4wd_high_clearance",
    drivable: true,
  },
  {
    raw_value: "Primitive Road - 4WD high clearance",
    canonical_class: "4wd_high_clearance",
    drivable: true,
  },
  { raw_value: "ATV", canonical_class: "atv", drivable: true },
  { raw_value: "Non-Motorized", canonical_class: "unknown", drivable: false },
]
  .map((row) => JSON.stringify(row))
  .join("\n");

const SAMPLE = parseRouteUseClassMap(SAMPLE_MAP);

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
  // The real map, not the sample — and the repository's own copy, which is the
  // default the loader reads. It used to live only in the peaks data directory,
  // outside any git repository, where this test could do nothing but skip and a
  // reviewed judgement had no history behind it.
  const mapPath = defaultRouteUseClassMapPath();
  const contents = readFileSync(mapPath, "utf8");
  const map = parseRouteUseClassMap(contents);
  const rows = contents
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { raw_value?: string | null; drivable?: unknown });
  assert.equal(rows.length, 26, "the 26 reviewed spellings");
  assert.equal(map.size, 26);
  for (const row of rows) {
    assert.equal(
      typeof row.drivable,
      "boolean",
      `no drivable verdict on ${JSON.stringify(row.raw_value)}`,
    );
  }
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
    const applied = applyRouteUseClass(map, value);
    assert.notEqual(applied.match, "unmapped", `unmapped: ${JSON.stringify(value)}`);
    assert.notEqual(
      applied.drivable,
      null,
      `no drivable flag: ${JSON.stringify(value)}`,
    );
  }
  // The six the reviewed map says are not roads.
  for (const value of [
    "Non-Motorized",
    "NON-MOTORIZED",
    "Non-Mechanized",
    "Motorized Single Track",
    "MOTORIZED SINGLE TRACK",
    "Over Snow Vehicle",
  ]) {
    assert.equal(
      isDrivableBlmRoute(map, value, "ALL_MOTO_VEH"),
      false,
      `should not be drivable: ${JSON.stringify(value)}`,
    );
  }
  // And the ones it says are, including ATV and UTV.
  for (const value of ["2WD LOW", "4wd Low", "ATV", "UTV", "Trail - UTV", "Unknown", null]) {
    assert.equal(
      isDrivableBlmRoute(map, value, "ALL_MOTO_VEH"),
      true,
      `should be drivable: ${JSON.stringify(value)}`,
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

test("drivability comes from the reviewed map, not from code", () => {
  // The flag lives beside the canonical class in the reviewed file, so a
  // spelling that arrives in a later refresh cannot decide for itself whether
  // it is a road. Non-Motorized folds to "unknown" for "what vehicle" — right
  // answer, wrong question for "is this a road".
  assert.equal(isDrivableBlmRoute(SAMPLE, "Non-Motorized", "ALL_MOTO_VEH"), false);
  assert.equal(classifyBlmDrivability(SAMPLE, "Non-Motorized", null).reason, "route_class");
  // The forgiving match carries the flag with it.
  assert.equal(isDrivableBlmRoute(SAMPLE, "NON-MOTORIZED", "ALL_MOTO_VEH"), false);
});

test("an allowed-mode code that bars full-size vehicles keeps a route out", () => {
  // A separate field from the class, so this half stays in code.
  assert.equal(isDrivableBlmRoute(SAMPLE, "4WD Low", "MTC_ONLY"), false);
  assert.equal(classifyBlmDrivability(SAMPLE, "4WD Low", "MTC_ONLY").reason, "allowed_modes");
  assert.equal(isDrivableBlmRoute(SAMPLE, "4WD Low", "MTC_ATV_UTV_ONLY"), false);
  // Shared codes are not exclusive, and a technical high-clearance vehicle is
  // still a vehicle — both stay in, with their rank carrying the difficulty.
  assert.equal(isDrivableBlmRoute(SAMPLE, "4WD Low", "MTC_ATV_SHARED"), true);
  assert.equal(isDrivableBlmRoute(SAMPLE, "4WD Low", "TECH_HI_CLEAR_VEH_ONLY"), true);
  assert.equal(isDrivableBlmRoute(SAMPLE, "4WD Low", "TECH_VEH_SHARED"), true);
});

test("ordinary and unknown BLM routes stay in the graph", () => {
  assert.equal(isDrivableBlmRoute(SAMPLE, "2WD Low", "ALL_MOTO_VEH"), true);
  assert.equal(isDrivableBlmRoute(SAMPLE, "4WD High Clearance/Specialized", "UNK"), true);
  // ATV routes are motorized: the rank says "ATV only", which is the honest
  // answer, and dropping them would break connections instead.
  assert.equal(isDrivableBlmRoute(SAMPLE, "ATV", "ALL_MOTO_VEH"), true);
  // A blank class is unknown, not undrivable — the whole BLM layer is planned
  // motorized, and half of it has no observed class recorded.
  assert.equal(isDrivableBlmRoute(SAMPLE, null, null), true);
  assert.equal(isDrivableBlmRoute(SAMPLE, " ", null), true);
});

test("a class the map has never seen is kept out, not waved through", () => {
  // The hazard this closes: a refresh introduces a spelling, and the old
  // hardcoded list quietly called it a road. Failing this way costs a missing
  // road, which shows up as "no approach found"; failing the other way invents
  // a drive to a trailhead nothing can reach.
  const verdict = classifyBlmDrivability(SAMPLE, "Hovercraft Route", "ALL_MOTO_VEH");
  assert.equal(verdict.drivable, false);
  assert.equal(verdict.reason, "unreviewed_class");
});

test("a mapped class with no drivable flag is treated as unreviewed", () => {
  const partial = parseRouteUseClassMap(
    [
      JSON.stringify({ raw_value: "Sled Route", canonical_class: "unknown" }),
      JSON.stringify({ raw_value: "2WD Low", canonical_class: "2wd", drivable: true }),
    ].join("\n"),
  );
  assert.equal(applyRouteUseClass(partial, "Sled Route").routeClass, "unknown");
  assert.equal(applyRouteUseClass(partial, "Sled Route").drivable, null);
  const verdict = classifyBlmDrivability(partial, "Sled Route", null);
  assert.equal(verdict.drivable, false);
  assert.equal(verdict.reason, "unreviewed_class");
  // The reviewed neighbour is unaffected.
  assert.equal(isDrivableBlmRoute(partial, "2WD Low", null), true);
});

test("a non-boolean drivable flag stops the load", () => {
  assert.throws(
    () =>
      parseRouteUseClassMap(
        JSON.stringify({ raw_value: "x", canonical_class: "2wd", drivable: "yes" }),
      ),
    /drivable must be a boolean/,
  );
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

test("the loader reads the repo copy by default and --map overrides it", () => {
  const fallback = sourcePaths("/somewhere/peaks/docs/trailheads/data", null);
  assert.equal(fallback.routeUseClassMap, defaultRouteUseClassMapPath());
  assert.equal(
    fallback.routeUseClassMap.includes("/docs/trailheads/data/"),
    false,
    "the default is the repository copy, not a data-directory one",
  );
  // The downloads still come from the data directory; only the judgement moved.
  assert.ok(fallback.blm.includes("/docs/trailheads/data/"));

  const parsed = parseArgs(["--data-dir=/somewhere", "--map=/tmp/reviewed.jsonl"]);
  assert.equal(parsed.routeUseClassMapPath, "/tmp/reviewed.jsonl");
  assert.equal(
    sourcePaths("/somewhere", parsed.routeUseClassMapPath).routeUseClassMap,
    "/tmp/reviewed.jsonl",
  );
});
