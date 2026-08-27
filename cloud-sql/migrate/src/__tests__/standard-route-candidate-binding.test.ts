import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  assertPendingRouteMatchesCandidate,
  buildPendingRouteBinding,
  DurableCandidateBindingInput,
} from "../standard-route-candidate-binding";
import { canonicalJson } from "../standard-route-job-state";

const artifact = {
  type: "FeatureCollection",
  peaks_destination_id: "summit-id",
  peaks_trailhead_id: "trailhead-id",
  peaks_source: "https://www.openstreetmap.org/",
  peaks_license_name:
    "Open Data Commons Open Database License (ODbL) 1.0",
  peaks_license: "https://opendatacommons.org/licenses/odbl/1-0/",
  peaks_attribution: "© OpenStreetMap contributors",
  peaks_retrieved_at: "2026-08-27T12:00:00Z",
  features: [
    {
      type: "Feature",
      properties: {
        osm_way_ids: [22, 33],
        osm_way_urls: [
          "https://www.openstreetmap.org/way/22",
          "https://www.openstreetmap.org/way/33",
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-121, 47],
          [-121.01, 47.01],
          [-121.02, 47.02],
          [-121.03, 47.03],
          [-121.04, 47.04],
        ],
      },
    },
  ],
};

const candidateResult = {
  route_name: "Example Summit via Standard Trail",
  route_shape: "out_and_back",
  official_source_country_code: "US",
  identity_sources: [
    {
      type: "peakbagger",
      url: "https://www.peakbagger.com/peak.aspx?pid=1",
    },
    {
      type: "official",
      url: "https://www.fs.usda.gov/example",
    },
  ],
  geometry: {
    source_kind: "openstreetmap",
    source_url: "https://www.openstreetmap.org/",
    license: "ODbL 1.0",
  },
};

function bindingInput(
  overrides: Partial<DurableCandidateBindingInput> = {}
): DurableCandidateBindingInput {
  return {
    routeId: "pending-route-id",
    destinationId: "summit-id",
    trailheadId: "trailhead-id",
    candidatePath: "/saved/candidate.geojson",
    candidateSha256: createHash("sha256")
      .update(canonicalJson(artifact))
      .digest("hex"),
    candidateResult,
    candidateArtifact: artifact,
    importerResult: {
      mode: "apply",
      status: "pending",
      route_id: "pending-route-id",
      route_name: "Example Summit via Standard Trail",
    },
    ...overrides,
  };
}

test("pending route binding derives exact database fields from durable evidence", () => {
  const binding = buildPendingRouteBinding(bindingInput());

  assert.equal(binding.routeName, "Example Summit via Standard Trail");
  assert.equal(binding.routeShape, "out_and_back");
  assert.equal(binding.officialSourceCountryCode, "US");
  assert.deepEqual(binding.destinations, [
    { destinationId: "trailhead-id", ordinal: 0 },
    { destinationId: "summit-id", ordinal: 1 },
  ]);
  assert.deepEqual(binding.identitySources, [
    {
      type: "peakbagger",
      id: "https://www.peakbagger.com/peak.aspx?pid=1",
    },
    {
      type: "official",
      id: "https://www.fs.usda.gov/example",
    },
  ]);
  assert.deepEqual(binding.geometrySource, {
    source_kind: "openstreetmap",
    source_url: "https://www.openstreetmap.org/",
    license_name:
      "Open Data Commons Open Database License (ODbL) 1.0",
    license_url: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "© OpenStreetMap contributors",
    retrieved_at: "2026-08-27T12:00:00.000Z",
    osm_way_ids: [22, 33],
    osm_way_urls: [
      "https://www.openstreetmap.org/way/22",
      "https://www.openstreetmap.org/way/33",
    ],
    contains_osm_geometry: true,
  });
  assert.deepEqual(binding.geometry, artifact.features[0].geometry);
});

test("pending_review queries exact route identity, provenance, and ordered path", async () => {
  let routeQueryText = "";
  let destinationQueryText = "";
  let queryValues: unknown[] = [];
  const client = {
    async query(text: string, values: unknown[]) {
      if (text.includes("FROM route_destinations rd")) {
        destinationQueryText = text;
        return {
          rows: [
            { destination_id: "trailhead-id", ordinal: 0 },
            { destination_id: "summit-id", ordinal: 1 },
          ],
        };
      }
      routeQueryText = text;
      queryValues = values;
      return {
        rows: [
          {
            route_name_matches: true,
            route_shape_matches: true,
            identity_sources_match: true,
            geometry_source_matches: true,
            candidate_path_matches: true,
          },
        ],
      };
    },
  } as unknown as PoolClient;

  await assertPendingRouteMatchesCandidate(client, bindingInput());

  assert.match(routeQueryText, /r\.external_links = \$4::jsonb/);
  assert.match(routeQueryText, /jsonb_build_object\([\s\S]*\) = \$5::jsonb/);
  assert.match(routeQueryText, /'osm_way_ids', r\.provenance->'osm_way_ids'/);
  assert.match(routeQueryText, /ST_AsEWKB\(ST_Force2D\(r\.path::geometry\)\)/);
  assert.match(routeQueryText, /ST_GeomFromGeoJSON\(\$6::text\)/);
  assert.match(routeQueryText, /FOR UPDATE OF r/);
  assert.match(destinationQueryText, /FROM route_destinations rd/);
  assert.match(
    destinationQueryText,
    /ORDER BY rd\.ordinal, rd\.destination_id[\s\S]*FOR UPDATE OF rd, d/
  );
  assert.equal(queryValues[0], "pending-route-id");
  assert.equal(queryValues[1], candidateResult.route_name);
  assert.equal(queryValues[2], candidateResult.route_shape);
  assert.deepEqual(JSON.parse(String(queryValues[3])), [
    {
      type: "peakbagger",
      id: "https://www.peakbagger.com/peak.aspx?pid=1",
    },
    {
      type: "official",
      id: "https://www.fs.usda.gov/example",
    },
  ]);
  assert.deepEqual(JSON.parse(String(queryValues[5])), artifact.features[0].geometry);
});

test("pending_review rejects any database route field that differs", async () => {
  const client = {
    async query(text: string) {
      if (text.includes("FROM route_destinations rd")) {
        return {
          rows: [{ destination_id: "wrong-trailhead", ordinal: 0 }],
        };
      }
      return {
        rows: [
          {
            route_name_matches: true,
            route_shape_matches: true,
            identity_sources_match: false,
            geometry_source_matches: true,
            candidate_path_matches: false,
          },
        ],
      };
    },
  } as unknown as PoolClient;

  await assert.rejects(
    assertPendingRouteMatchesCandidate(client, bindingInput()),
    /destinations, identity_sources, candidate_path/
  );
});

test("approval rebind rejects a route changed after its review packet", async () => {
  let checks = 0;
  const client = {
    async query(text: string) {
      if (text.includes("FROM route_destinations rd")) {
        return {
          rows: [
            { destination_id: "trailhead-id", ordinal: 0 },
            { destination_id: "summit-id", ordinal: 1 },
          ],
        };
      }
      checks += 1;
      return {
        rows: [
          checks === 1
            ? {
                route_name_matches: true,
                route_shape_matches: true,
                identity_sources_match: true,
                geometry_source_matches: true,
                candidate_path_matches: true,
              }
            : {
                route_name_matches: false,
                route_shape_matches: true,
                identity_sources_match: true,
                geometry_source_matches: true,
                candidate_path_matches: false,
              },
        ],
      };
    },
  } as unknown as PoolClient;

  await assertPendingRouteMatchesCandidate(client, bindingInput());
  await assert.rejects(
    assertPendingRouteMatchesCandidate(client, bindingInput()),
    /route_name, candidate_path/
  );
});

test("pending_review rejects changed durable evidence before querying routes", async () => {
  let queried = false;
  const client = {
    async query() {
      queried = true;
      return { rows: [] };
    },
  } as unknown as PoolClient;

  await assert.rejects(
    assertPendingRouteMatchesCandidate(
      client,
      bindingInput({ candidateSha256: "0".repeat(64) })
    ),
    /Saved candidate checksum does not match/
  );
  assert.equal(queried, false);
});

test("pending_review rejects candidate metadata that differs from the artifact", () => {
  assert.throws(
    () =>
      buildPendingRouteBinding(
        bindingInput({
          candidateResult: {
            ...candidateResult,
            geometry: {
              ...candidateResult.geometry,
              source_url: "https://example.com/unrelated-source",
            },
          },
        })
      ),
    /geometry metadata does not match its GeoJSON artifact/
  );
  assert.throws(
    () =>
      buildPendingRouteBinding(
        bindingInput({
          importerResult: {
            route_name: "Another route",
          },
        })
      ),
    /Importer route name does not match the saved candidate/
  );
});

test("pending route binding requires a durable uppercase country code", () => {
  for (const officialSourceCountryCode of [undefined, "us", "USA", " US"]) {
    assert.throws(
      () =>
        buildPendingRouteBinding(
          bindingInput({
            candidateResult: {
              ...candidateResult,
              official_source_country_code: officialSourceCountryCode,
            },
          })
        ),
      /official_source_country_code must be two uppercase letters/
    );
  }
});

test("the importer binds candidate_ready to pending_review before commit", () => {
  const jobsSource = readFileSync(
    join(__dirname, "../standard-route-jobs.ts"),
    "utf8"
  );
  const importerSource = readFileSync(
    join(
      __dirname,
      "../../../../.claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts"
    ),
    "utf8"
  );
  assert.match(
    importerSource,
    /async function bindFactoryPendingRoute\([\s\S]*await assertPendingRouteMatchesCandidate\(client,/
  );
  assert.match(
    importerSource,
    /SET state = 'pending_review'[\s\S]*published_route_id = \$4[\s\S]*lease_token = NULL/
  );
  assert.match(jobsSource, /rejectSplitImportTransition\(to\)/);
});

test("the import contract passes every identity source in order on dry run and apply", () => {
  const repoRoot = join(__dirname, "../../../..");
  const stageCommands = readFileSync(
    join(
      repoRoot,
      ".agents/skills/peaks-route-factory/references/stage-commands.md"
    ),
    "utf8"
  );
  const importer = readFileSync(
    join(
      repoRoot,
      ".claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts"
    ),
    "utf8"
  );
  const importStart = stageCommands.indexOf("## Import");
  const importSection = stageCommands.slice(importStart);
  const commands = [...importSection.matchAll(/```bash\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .filter((command) => command.includes("import_route_candidate.sh"));

  assert.equal(commands.length, 2, "documents dry-run and apply imports");
  for (const command of commands) {
    assert.equal(
      (command.match(/--source-url/g) ?? []).length,
      2,
      "each example shows repeated identity sources"
    );
    assert.ok(
      command.indexOf("<first-type>") < command.indexOf("<next-type>"),
      "each example keeps candidate identity order"
    );
  }
  assert.match(
    importSection,
    /Repeat `--source-url` once for every saved `identity_sources` entry, in the same\s+order/
  );
  assert.match(
    importer,
    /sourceLinks: valuesAfter\(argv, "--source-url"\)\.map\(parseSourceLink\)/
  );
});
