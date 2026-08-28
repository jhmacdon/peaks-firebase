import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  getPublishableArcgisTrailSource,
  listOfficialTrailSources,
} from "../official-trail-sources";
import { buildOfficialArcgisQueryUrl } from "../official-route-geometry";
import {
  assertOfficialSourceCountryBinding,
  officialTrailSourcesForCountry,
  parseOfficialSourceAttempts,
  type OfficialSourceAttemptStatus,
} from "../standard-route-official-source-attempts";
import { buildUsgsTrailsQueryUrl } from "../usgs-trails-source";
import { parseStandardRouteCandidateResult } from "../standard-route-jobs";

const NOW_MS = Date.parse("2026-08-27T12:00:00.000Z");
const CHECKED_AT = "2026-08-27T11:30:00.000Z";
const USFS_SOURCE_URL = buildOfficialArcgisQueryUrl(
  getPublishableArcgisTrailSource("usfs-nfs-trails").service,
  ["feature-1"]
).toString();
const USGS_SOURCE_URL = buildUsgsTrailsQueryUrl([1]).toString();

function attemptsForCountry(
  countryCode: string,
  statuses: Record<string, OfficialSourceAttemptStatus>,
  checkedAt = CHECKED_AT
): Record<string, unknown> {
  return Object.fromEntries(
    officialTrailSourcesForCountry(countryCode).map((source) => {
      const status = statuses[source.id] ??
        (source.status === "ready_publishable"
          ? "no_complete_geometry"
          : source.status);
      const common = {
        status,
        checked_at: checkedAt,
        note: `Checked ${source.name} for this destination.`,
      };
      if (status === "selected_reusable_geometry") {
        return [
          source.id,
          {
            ...common,
            source_url:
              source.id === "usgs-national-digital-trails"
                ? USGS_SOURCE_URL
                : USFS_SOURCE_URL,
          },
        ];
      }
      return [
        source.id,
        { ...common, attempted_url: source.discoveryUrl },
      ];
    })
  );
}

function validOsmCandidate(): Record<string, unknown> {
  const checkedAt = new Date().toISOString();
  return {
    route_name: " Example Peak via Example Trail ",
    route_shape: "out_and_back",
    discovery_checks: {
      alltrails: {
        status: "no_match",
        attempted_url: "https://www.alltrails.com/search?q=Example+Peak",
        checked_at: checkedAt,
        note: "No direct trail match.",
      },
      peakbagger: {
        status: "no_match",
        attempted_url:
          "https://www.peakbagger.com/search.aspx?tid=R&query=Example+Peak",
        checked_at: checkedAt,
        note: "No direct peak or ascent match.",
      },
    },
    official_source_country_code: "US",
    official_source_attempts: attemptsForCountry(
      "US",
      {
        "usfs-nfs-trails": "no_complete_geometry",
        "nps-public-trails": "validation_only",
        "blm-national-public-trails": "validation_only",
        "usgs-national-digital-trails": "no_complete_geometry",
      },
      checkedAt
    ),
    identity_sources: [
      {
        type: "nps-public-trails",
        url:
          "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/FeatureServer",
      },
    ],
    identity_conflicts: [],
    geometry: {
      source_kind: "openstreetmap",
      source_url: "https://www.openstreetmap.org/way/1",
      license: "ODbL 1.0",
    },
    access: {
      status: "open",
      source_url:
        "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/FeatureServer",
    },
    comparison: { private_reference_used: false },
    map_review: { passed: true, notes: " Route reaches the summit. " },
  };
}

test("official attempts cover every durable-country registry source once", () => {
  const attempts = attemptsForCountry("US", {
    "usfs-nfs-trails": "selected_reusable_geometry",
    "nps-public-trails": "validation_only",
    "blm-national-public-trails": "validation_only",
    "usgs-national-digital-trails": "validation_only",
  });
  const parsed = parseOfficialSourceAttempts(
    attempts,
    { countryCode: "US" },
    { source_kind: "usfs-nfs-trails", source_url: USFS_SOURCE_URL },
    NOW_MS
  );

  assert.deepEqual(
    Object.keys(parsed).sort(),
    officialTrailSourcesForCountry("US").map(({ id }) => id).sort()
  );
  assert.equal(
    parsed["usfs-nfs-trails"].status,
    "selected_reusable_geometry"
  );
});

test("official attempts reject missing, extra, stale, and wrong-registry checks", () => {
  const complete = attemptsForCountry("US", {
    "usfs-nfs-trails": "selected_reusable_geometry",
    "nps-public-trails": "validation_only",
    "blm-national-public-trails": "validation_only",
    "usgs-national-digital-trails": "validation_only",
  });
  const input = {
    destination: { countryCode: "US" },
    geometry: {
      source_kind: "usfs-nfs-trails",
      source_url: USFS_SOURCE_URL,
    },
  } as const;

  const missing = structuredClone(complete);
  delete missing["nps-public-trails"];
  assert.throws(
    () =>
      parseOfficialSourceAttempts(
        missing,
        input.destination,
        input.geometry,
        NOW_MS
      ),
    /must contain exactly/
  );

  assert.throws(
    () =>
      parseOfficialSourceAttempts(
        { ...complete, invented: complete["nps-public-trails"] },
        input.destination,
        input.geometry,
        NOW_MS
      ),
    /must contain exactly/
  );

  const stale = structuredClone(complete) as Record<
    string,
    Record<string, unknown>
  >;
  stale["nps-public-trails"].checked_at = "2026-08-25T11:30:00.000Z";
  assert.throws(
    () =>
      parseOfficialSourceAttempts(
        stale,
        input.destination,
        input.geometry,
        NOW_MS
      ),
    /older than 24 hours/
  );

  const wrongStatus = structuredClone(complete) as Record<
    string,
    Record<string, unknown>
  >;
  wrongStatus["nps-public-trails"].status = "manual_gap";
  assert.throws(
    () =>
      parseOfficialSourceAttempts(
        wrongStatus,
        input.destination,
        input.geometry,
        NOW_MS
      ),
    /incompatible with registry status validation_only/
  );
});

test("selected attempts bind USFS and the existing USGS adapter exactly", () => {
  const usgsAttempts = attemptsForCountry("US", {
    "usfs-nfs-trails": "no_complete_geometry",
    "nps-public-trails": "validation_only",
    "blm-national-public-trails": "validation_only",
    "usgs-national-digital-trails": "selected_reusable_geometry",
  });
  assert.doesNotThrow(() =>
    parseOfficialSourceAttempts(
      usgsAttempts,
      { countryCode: "US" },
      { source_kind: "usgs-national-map", source_url: USGS_SOURCE_URL },
      NOW_MS
    )
  );

  const mismatched = structuredClone(usgsAttempts) as Record<
    string,
    Record<string, unknown>
  >;
  mismatched["usgs-national-digital-trails"].source_url =
    buildUsgsTrailsQueryUrl([2]).toString();
  assert.throws(
    () =>
      parseOfficialSourceAttempts(
        mismatched,
        { countryCode: "US" },
        { source_kind: "usgs-national-map", source_url: USGS_SOURCE_URL },
        NOW_MS
      ),
    /must match the candidate geometry source/
  );

  const wrongAdapter = structuredClone(usgsAttempts) as Record<
    string,
    Record<string, unknown>
  >;
  wrongAdapter["usgs-national-digital-trails"].source_url =
    "https://partnerships.nationalmap.gov/not-the-trails-adapter";
  assert.throws(
    () =>
      parseOfficialSourceAttempts(
        wrongAdapter,
        { countryCode: "US" },
        {
          source_kind: "usgs-national-map",
          source_url:
            "https://partnerships.nationalmap.gov/not-the-trails-adapter",
        },
        NOW_MS
      ),
    /not the National Digital Trails layer-0 query/
  );

  const validationOnlySelected = attemptsForCountry("US", {
    "usfs-nfs-trails": "no_complete_geometry",
    "nps-public-trails": "selected_reusable_geometry",
    "blm-national-public-trails": "validation_only",
    "usgs-national-digital-trails": "validation_only",
  });
  assert.throws(
    () =>
      parseOfficialSourceAttempts(
        validationOnlySelected,
        { countryCode: "US" },
        { source_kind: "openstreetmap", source_url: "https://www.openstreetmap.org/" },
        NOW_MS
      ),
    /incompatible with registry status validation_only/
  );
});

test("USGS and OSM fallbacks require durable higher-priority outcomes", () => {
  const usgsWithoutOfficialOutcome = attemptsForCountry("US", {
    "usfs-nfs-trails": "selected_reusable_geometry",
    "nps-public-trails": "validation_only",
    "blm-national-public-trails": "validation_only",
    "usgs-national-digital-trails": "selected_reusable_geometry",
  });
  assert.throws(
    () =>
      parseOfficialSourceAttempts(
        usgsWithoutOfficialOutcome,
        { countryCode: "US" },
        { source_kind: "usgs-national-map", source_url: USGS_SOURCE_URL },
        NOW_MS
      ),
    /selected geometry must match|must select the reusable candidate geometry/
  );

  const osmIncomplete = attemptsForCountry("US", {
    "usfs-nfs-trails": "no_complete_geometry",
    "nps-public-trails": "validation_only",
    "blm-national-public-trails": "validation_only",
    "usgs-national-digital-trails": "validation_only",
  });
  assert.throws(
    () =>
      parseOfficialSourceAttempts(
        osmIncomplete,
        { countryCode: "US" },
        { source_kind: "openstreetmap", source_url: "https://www.openstreetmap.org/" },
        NOW_MS
      ),
    /usgs-national-digital-trails.*must be exhausted/
  );

  const osmComplete = attemptsForCountry("US", {
    "usfs-nfs-trails": "no_complete_geometry",
    "nps-public-trails": "validation_only",
    "blm-national-public-trails": "validation_only",
    "usgs-national-digital-trails": "no_complete_geometry",
  });
  assert.doesNotThrow(() =>
    parseOfficialSourceAttempts(
      osmComplete,
      { countryCode: "US" },
      { source_kind: "openstreetmap", source_url: "https://www.openstreetmap.org/" },
      NOW_MS
    )
  );
});

test("manual gaps and durable country codes fail closed", () => {
  const chinaSource = listOfficialTrailSources().find((source) =>
    source.coverage.countries.includes("CN")
  );
  assert.ok(chinaSource);
  const attempts = attemptsForCountry("CN", {
    [chinaSource.id]: "manual_gap",
  });
  assert.doesNotThrow(() =>
    parseOfficialSourceAttempts(
      attempts,
      { countryCode: "CN" },
      { source_kind: "openstreetmap", source_url: "https://www.openstreetmap.org/" },
      NOW_MS
    )
  );
  assert.throws(
    () =>
      parseOfficialSourceAttempts(
        attempts,
        { countryCode: null },
        { source_kind: "openstreetmap", source_url: "https://www.openstreetmap.org/" },
        NOW_MS
      ),
    /durable ISO country code/
  );
  assert.throws(
    () =>
      parseOfficialSourceAttempts(
        {},
        { countryCode: "AD" },
        { source_kind: "openstreetmap", source_url: "https://www.openstreetmap.org/" },
        NOW_MS
      ),
    /no reviewed coverage for AD/
  );
  assert.equal(
    assertOfficialSourceCountryBinding("US", { countryCode: "US" }),
    "US"
  );
  assert.throws(
    () =>
      assertOfficialSourceCountryBinding("US", { countryCode: "CA" }),
    /must match the durable destination country code/
  );
});

test("candidate parser rejects raw geometry fields and returns only sanitized evidence", () => {
  const candidate = validOsmCandidate();
  const parsed = parseStandardRouteCandidateResult(
    candidate,
    "Example Peak",
    "US"
  );
  assert.equal(parsed.route_name, "Example Peak via Example Trail");
  assert.deepEqual(parsed.map_review, {
    passed: true,
    notes: "Route reaches the summit.",
  });
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(candidate).sort());

  assert.throws(
    () =>
      parseStandardRouteCandidateResult(
        {
          ...candidate,
          raw_gpx_coordinates: [[-121, 46]],
        },
        "Example Peak",
        "US"
      ),
    /candidate result must contain exactly/
  );
  assert.throws(
    () =>
      parseStandardRouteCandidateResult(
        {
          ...candidate,
          geometry: {
            ...(candidate.geometry as Record<string, unknown>),
            coordinates: [[-121, 46]],
          },
        },
        "Example Peak",
        "US"
      ),
    /candidate geometry must contain exactly/
  );
});

test("candidate_ready wires official attempts to the durable country", () => {
  const source = readFileSync(
    join(__dirname, "..", "standard-route-jobs.ts"),
    "utf8"
  );
  assert.match(source, /parseOfficialSourceAttempts/);
  assert.match(source, /d\.country_code AS destination_country_code/);
  assert.match(source, /currentJob\.destination_country_code/);
  assert.match(source, /result\.official_source_country_code/);
  assert.match(source, /job\.candidate\.official_source_country_code/);

  const importer = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      ".claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts"
    ),
    "utf8"
  );
  assert.match(importer, /assertOfficialSourceCountryBinding/);
  assert.match(importer, /d\.country_code AS destination_country_code/);
});
