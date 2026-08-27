import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { buildOfficialArcgisQueryUrl } from "../official-route-geometry";
import { getPublishableArcgisTrailSource } from "../official-trail-sources";

const MIGRATE_ROOT = join(__dirname, "../..");
const REPO_ROOT = join(MIGRATE_ROOT, "../..");
const TSX = join(MIGRATE_ROOT, "node_modules/.bin/tsx");
const AUDITOR = join(
  REPO_ROOT,
  ".agents/skills/peaks-route-factory/scripts/audit_route_candidates.mts"
);
const IMPORTER = join(
  REPO_ROOT,
  ".claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts"
);
const IMPORT_WRAPPER = join(
  REPO_ROOT,
  ".agents/skills/peaks-route-factory/scripts/import_route_candidate.sh"
);

function candidate() {
  const source = getPublishableArcgisTrailSource("usfs-nfs-trails");
  const sourceUrl = buildOfficialArcgisQueryUrl(source.service, ["feature-1"]);
  return {
    type: "FeatureCollection",
    peaks_destination_id: "summit",
    peaks_trailhead_id: "trailhead",
    peaks_source_kind: source.id,
    peaks_source: sourceUrl.toString(),
    peaks_retrieval_source: sourceUrl.toString(),
    peaks_license_name: source.license.name,
    peaks_license: source.license.url,
    peaks_attribution: source.license.attribution,
    peaks_retrieved_at: "2026-08-27T00:00:00Z",
    features: [
      {
        type: "Feature",
        properties: {
          name: "Example official route",
          trailhead_name: "Example Trailhead",
          destination_name: "Example Peak",
          distance_m: 400,
          trailhead_snap_m: 0,
          summit_snap_m: 0,
          osm_way_ids: [],
          osm_way_urls: [],
          official_source_id: source.id,
          official_feature_ids: ["feature-1"],
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [-121, 46],
            [-121.001, 46.001],
            [-121.002, 46.002],
            [-121.003, 46.003],
            [-121.004, 46.004],
          ],
        },
      },
    ],
  };
}

test("candidate audit accepts registry-bound official geometry and rejects drift", () => {
  const directory = mkdtempSync(join(tmpdir(), "peaks-official-candidate-"));
  try {
    const candidatePath = join(directory, "candidate.geojson");
    writeFileSync(candidatePath, JSON.stringify(candidate()));
    const passing = spawnSync(
      TSX,
      [AUDITOR, "--file", candidatePath, "--format", "summary"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 10_000 }
    );
    assert.equal(passing.status, 0, passing.stderr);
    assert.deepEqual(JSON.parse(passing.stdout), {
      files: 1,
      passed: 1,
      failed: 0,
    });

    const changed = candidate();
    changed.peaks_attribution = "Changed credit";
    writeFileSync(candidatePath, JSON.stringify(changed));
    const failing = spawnSync(
      TSX,
      [AUDITOR, "--file", candidatePath, "--format", "summary"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 10_000 }
    );
    assert.equal(failing.status, 1, failing.stderr);
    assert.match(failing.stdout, /license metadata must match the source registry/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("official candidates cannot bypass review through an active-route upgrade", () => {
  const directory = mkdtempSync(join(tmpdir(), "peaks-official-upgrade-"));
  try {
    const candidatePath = join(directory, "candidate.geojson");
    writeFileSync(candidatePath, JSON.stringify(candidate()));
    const result = spawnSync(
      IMPORT_WRAPPER,
      [
        "--candidate",
        candidatePath,
        "--destination-id",
        "summit",
        "--trailhead-id",
        "trailhead",
        "--name",
        "Example Peak via Example Trail",
        "--source-url",
        "official=https://example.com/route",
        "--upgrade-active-route",
        "active-route",
      ],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 10_000 }
    );
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /--upgrade-active-route is forbidden/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("official geometry stays wired through import, review, and worker preflight", () => {
  const sourceCheckWrapper = readFileSync(
    join(
      REPO_ROOT,
      ".agents/skills/peaks-route-factory/scripts/check_pending_route_source.sh"
    ),
    "utf8"
  );
  const packetBuilder = readFileSync(
    join(
      REPO_ROOT,
      ".agents/skills/peaks-route-factory/scripts/build_route_review_packet.mjs"
    ),
    "utf8"
  );
  const preflight = readFileSync(
    join(
      REPO_ROOT,
      ".agents/skills/peaks-route-factory/scripts/worker_preflight.sh"
    ),
    "utf8"
  );
  const importer = readFileSync(
    join(
      REPO_ROOT,
      ".claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts"
    ),
    "utf8"
  );
  const officialBuilder = readFileSync(
    join(
      REPO_ROOT,
      ".claude/skills/peaks-standard-route-backfill/scripts/build_official_route_candidate.mts"
    ),
    "utf8"
  );
  const officialChecker = readFileSync(
    join(
      REPO_ROOT,
      ".claude/skills/peaks-osm-route-approval/scripts/check_pending_official_routes.mts"
    ),
    "utf8"
  );
  const reviewer = readFileSync(
    join(REPO_ROOT, ".codex/agents/peaks-route-reviewer.toml"),
    "utf8"
  );

  assert.match(sourceCheckWrapper, /official\)[\s\S]*check_pending_official_routes/);
  assert.match(packetBuilder, /registry\.geometry_use === "publishable"/);
  assert.match(preflight, /find_official_trail_geometry\.mts/);
  assert.match(preflight, /build_official_route_candidate\.mts/);
  assert.match(preflight, /check_pending_official_routes\.mts/);
  assert.match(importer, /official_feature_ids do not match the canonical source URL/);
  assert.match(officialBuilder, /reviewOfficialTrailAccess\(source, route\.usedPaths\)/);
  assert.match(officialChecker, /reviewOfficialTrailAccess\(source, paths\)/);
  assert.match(reviewer, /source_check\.source_registry/);
});

test("review packets bind registry-backed geometry to the official checker", async () => {
  const source = getPublishableArcgisTrailSource("usfs-nfs-trails");
  const sourceUrl = buildOfficialArcgisQueryUrl(
    source.service,
    ["feature-1"]
  ).toString();
  const packetModule = (await import(
    pathToFileURL(
      join(
        REPO_ROOT,
        ".agents/skills/peaks-route-factory/scripts/build_route_review_packet.mjs"
      )
    ).href
  )) as {
    buildRouteReviewPacket: (input: Record<string, unknown>) => {
      review_result_template: { source_check: unknown };
    };
  };
  const packet = packetModule.buildRouteReviewPacket({
    candidate: {
      route_name: "Example Peak via Example Trail",
      route_shape: "out_and_back",
      discovery_checks: {
        alltrails: {
          status: "no_match",
          attempted_url: "https://www.alltrails.com/search?q=Example+Peak",
          checked_at: new Date().toISOString(),
          note: "No direct route match.",
        },
        peakbagger: {
          status: "unavailable",
          attempted_url:
            "https://www.peakbagger.com/search.aspx?tid=R&query=Example+Peak",
          checked_at: new Date().toISOString(),
          note: "The public page was unavailable.",
        },
      },
      official_source_country_code: "US",
      official_source_attempts: {
        [source.id]: {
          status: "selected_reusable_geometry",
          source_url: sourceUrl,
          checked_at: new Date().toISOString(),
          note: "Selected official features form the route.",
        },
      },
      identity_sources: [
        { type: source.id, url: sourceUrl },
      ],
      identity_conflicts: [],
      geometry: {
        source_kind: source.id,
        source_url: sourceUrl,
        license: source.license.name,
      },
      access: { status: "open", source_url: sourceUrl },
      comparison: { private_reference_used: false },
      map_review: { passed: true, notes: "Official line reaches the summit." },
    },
    sourceCheck: {
      verdict: "PASS",
      source_registry: {
        id: source.id,
        geometry_use: "publishable",
        license_name: source.license.name,
        license_url: source.license.url,
        attribution: source.license.attribution,
      },
      results: [
        {
          metrics: {
            start_connector_m: 0,
            end_connector_m: 0,
            core_max_offset_m: 0,
            core_p95_offset_m: 0,
            core_coverage_pct: 100,
          },
        },
      ],
    },
    candidateSha256: "b".repeat(64),
    destinationId: "summit",
    destinationName: "Example Peak",
    destinationCountryCode: "US",
    trailheadId: "trailhead",
    trailheadName: "Example Trailhead",
    routeId: "route",
  });
  assert.equal(packet.review_result_template.source_check, "official");
});
