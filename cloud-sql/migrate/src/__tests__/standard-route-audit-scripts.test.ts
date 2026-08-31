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

import {
  buildUsgsTrailAttribution,
  USGS_TRAILS_LICENSE_NAME,
  USGS_TRAILS_LICENSE_URL,
} from "../usgs-trails-source";

const MIGRATE_ROOT = join(__dirname, "../..");
const REPO_ROOT = join(MIGRATE_ROOT, "../..");
const GOAL_AUDIT = join(MIGRATE_ROOT, "scripts/audit-standard-route-goal.sh");
const COVER_GOAL_AUDIT = join(
  MIGRATE_ROOT,
  "scripts/audit-listed-route-cover-goal.sh"
);
const GAP_AUDIT = join(
  REPO_ROOT,
  ".claude/skills/peaks-standard-route-backfill/scripts/audit_missing_standard_routes.sh"
);
const LOOP_MERGER = join(
  REPO_ROOT,
  ".claude/skills/peaks-standard-route-backfill/scripts/merge_route_loop_candidates.mts"
);
const TSX = join(MIGRATE_ROOT, "node_modules/.bin/tsx");

function run(script: string, ...args: string[]) {
  return spawnSync("bash", [script, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 5_000,
  });
}

test("goal audit targets all and only Peaks-owned lists", () => {
  const result = run(GOAL_AUDIT, "--print-sql");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /BOOL_OR\(l\.owner = 'peaks'\)/);
  assert.match(
    result.stdout,
    /ARRAY_AGG\(DISTINCT l\.name ORDER BY l\.name\)\s+FILTER \(WHERE l\.owner = 'peaks'\)/
  );
  assert.match(
    result.stdout,
    /WHERE is_ultra_prominent OR is_target_list OR is_high_popularity/
  );
  assert.doesNotMatch(
    result.stdout,
    /Ultras %|Colorado 14ers|Smoot's 100|Washington Home Court 100/
  );
  assert.match(result.stdout, /summit_feature_valid/);
  assert.match(result.stdout, /listed_data_blockers/);
  assert.match(result.stdout, /peaks_route_passes_publish_integrity\(/);
  assert.doesNotMatch(
    result.stdout,
    /WHERE 'summit'::destination_feature = ANY\(d\.features\)\s+GROUP BY d\.id/
  );
});

test("listed route-cover audit keeps every photo and route gap visible", () => {
  const result = run(COVER_GOAL_AUDIT, "--format", "summary", "--print-sql");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /WHERE l\.owner = 'peaks'/);
  assert.match(result.stdout, /NULLIF\(BTRIM\(d\.hero_image\), ''\) IS NOT NULL/);
  assert.match(result.stdout, /d\.hero_image_attribution/);
  assert.match(result.stdout, /d\.hero_image_attribution_url/);
  assert.match(
    result.stdout,
    /LEFT JOIN route_cover_photos cover ON cover\.route_id = r\.id/
  );
  assert.match(result.stdout, /peaks_route_passes_publish_integrity\(/);
  assert.match(result.stdout, /active_peaks_routes_without_cover/);
  assert.match(result.stdout, /active_listed_routes_missing_cover/);
  assert.match(result.stdout, /listed_route_cover_complete/);
  assert.match(result.stdout, /AS goal_complete/);
});

test("listed route-cover detail mode filters only explicit incomplete rows", () => {
  const result = run(
    COVER_GOAL_AUDIT,
    "--format",
    "json",
    "--incomplete-only",
    "--print-sql"
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(
    result.stdout,
    /NOT :'incomplete_only'::boolean\s+OR NOT listed_route_cover_complete/
  );

  const invalid = run(
    COVER_GOAL_AUDIT,
    "--format",
    "json",
    "--require-complete"
  );
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /requires --format summary/);
});

test("listed route-cover completion check exits nonzero on any reported gap", () => {
  const directory = mkdtempSync(join(tmpdir(), "peaks-cover-goal-"));
  try {
    const fakePsql = join(directory, "psql");
    writeFileSync(
      fakePsql,
      [
        "#!/bin/sh",
        "cat >/dev/null",
        "printf 'listed_destinations\\tgoal_complete\\n1\\t%s\\n' \"${FAKE_GOAL_COMPLETE:-f}\"",
        "",
      ].join("\n"),
      { mode: 0o755 }
    );
    const environment = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ""}`,
      PEAKS_ROUTE_DB_PASS: "test-password",
    };
    const incomplete = spawnSync(
      "bash",
      [COVER_GOAL_AUDIT, "--require-complete"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 5_000,
        env: { ...environment, FAKE_GOAL_COMPLETE: "f" },
      }
    );
    assert.equal(incomplete.status, 1, incomplete.stderr || incomplete.stdout);
    assert.match(incomplete.stderr, /goal is incomplete/);

    const complete = spawnSync(
      "bash",
      [COVER_GOAL_AUDIT, "--require-complete"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 5_000,
        env: { ...environment, FAKE_GOAL_COMPLETE: "t" },
      }
    );
    assert.equal(complete.status, 0, complete.stderr || complete.stdout);
    assert.match(complete.stdout, /1\tt/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("gap audit supports an explicit worldwide scope", () => {
  const candidates = run(
    GAP_AUDIT,
    "--worldwide",
    "--list",
    "World summits",
    "--print-sql"
  );
  assert.equal(candidates.status, 0, candidates.stderr || candidates.stdout);
  assert.match(
    candidates.stdout,
    /\(:'worldwide'::boolean OR d\.state_code = :'state_code'\)/
  );
  assert.match(candidates.stdout, /l\.owner = 'peaks'/);
  assert.match(candidates.stdout, /summit_feature_valid/);
  assert.match(candidates.stdout, /peaks_route_passes_publish_integrity\(/);
  assert.doesNotMatch(
    candidates.stdout,
    /AND 'summit'::destination_feature = ANY\(d\.features\)/
  );

  const coverage = run(GAP_AUDIT, "--worldwide", "--coverage", "--print-sql");
  assert.equal(coverage.status, 0, coverage.stderr || coverage.stdout);
  assert.match(
    coverage.stdout,
    /\(:'worldwide'::boolean OR d\.state_code = :'state_code'\)/
  );
  assert.match(coverage.stdout, /l\.owner = 'peaks'/);
  assert.match(coverage.stdout, /listed_data_blockers/);
  assert.match(coverage.stdout, /peaks_route_passes_publish_integrity\(/);
});

test("gap audit preserves state and list modes and rejects mixed scopes", () => {
  const state = run(GAP_AUDIT, "--state", "OR", "--print-sql");
  assert.equal(state.status, 0, state.stderr || state.stdout);

  const list = run(GAP_AUDIT, "--list", "Bulger List", "--print-sql");
  assert.equal(list.status, 0, list.stderr || list.stdout);

  const mixed = run(
    GAP_AUDIT,
    "--state",
    "WA",
    "--worldwide",
    "--print-sql"
  );
  assert.equal(mixed.status, 2);
  assert.match(mixed.stderr, /Choose either --state or --worldwide/);
});

function osmLeg(
  wayId: number,
  coordinates: Array<[number, number]>
) {
  return {
    type: "FeatureCollection",
    peaks_destination_id: "summit",
    peaks_trailhead_id: "trailhead",
    peaks_source: "https://www.openstreetmap.org/",
    peaks_retrieval_source: "https://overpass-api.de/api/interpreter",
    peaks_license_name: "Open Data Commons Open Database License 1.0",
    peaks_license: "https://opendatacommons.org/licenses/odbl/1-0/",
    peaks_attribution: "© OpenStreetMap contributors",
    peaks_retrieved_at: "2026-08-27T12:00:00.000Z",
    features: [
      {
        type: "Feature",
        properties: {
          destination_name: "Test Peak",
          distance_m: 200,
          trailhead_snap_m: 0,
          summit_snap_m: 0,
          osm_way_ids: [wayId],
          osm_way_urls: [`https://www.openstreetmap.org/way/${wayId}`],
          osm_way_names: [`Way ${wayId}`],
          osm_foot_access_override_way_ids: [],
        },
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
}

test("loop merger joins distinct source-backed legs into one simple loop", () => {
  const directory = mkdtempSync(join(tmpdir(), "peaks-loop-merge-"));
  try {
    const outboundPath = join(directory, "outbound.geojson");
    const returnPath = join(directory, "return.geojson");
    const outputPath = join(directory, "loop.geojson");
    writeFileSync(
      outboundPath,
      JSON.stringify(osmLeg(1, [[0, 0], [0.001, 0], [0.001, 0.001]]))
    );
    writeFileSync(
      returnPath,
      JSON.stringify(osmLeg(2, [[0, 0], [0, 0.001], [0.001, 0.001]]))
    );
    const result = spawnSync(
      TSX,
      [
        LOOP_MERGER,
        "--outbound",
        outboundPath,
        "--return",
        returnPath,
        "--trailhead-id",
        "trailhead",
        "--route-shape",
        "loop",
        "--output",
        outputPath,
      ],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 10_000 }
    );
    assert.equal(result.status, 0, result.stderr);
    const merged = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(merged.features[0].properties.route_shape, "loop");
    assert.deepEqual(merged.features[0].properties.osm_way_ids, [1, 2]);
    assert.deepEqual(
      merged.features[0].geometry.coordinates[0],
      merged.features[0].geometry.coordinates.at(-1)
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loop merger rejects a fully retraced route labelled lollipop", () => {
  const directory = mkdtempSync(join(tmpdir(), "peaks-loop-merge-"));
  try {
    const outboundPath = join(directory, "outbound.geojson");
    const returnPath = join(directory, "return.geojson");
    const outputPath = join(directory, "loop.geojson");
    const leg = osmLeg(1, [[0, 0], [0.001, 0], [0.002, 0]]);
    writeFileSync(outboundPath, JSON.stringify(leg));
    writeFileSync(returnPath, JSON.stringify(leg));
    const result = spawnSync(
      TSX,
      [
        LOOP_MERGER,
        "--outbound",
        outboundPath,
        "--return",
        returnPath,
        "--trailhead-id",
        "trailhead",
        "--route-shape",
        "lollipop",
        "--output",
        outputPath,
      ],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 10_000 }
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /non-retraced loop/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loop merger combines USGS and official stable feature IDs", () => {
  const directory = mkdtempSync(join(tmpdir(), "peaks-loop-merge-"));
  try {
    const geometries: Array<Array<[number, number]>> = [
      [[0, 0], [0.001, 0], [0.001, 0.001]],
      [[0, 0], [0, 0.001], [0.001, 0.001]],
    ];
    for (const kind of ["usgs", "official"] as const) {
      const legs = geometries.map((coordinates, index) => {
        const leg = osmLeg(index + 1, coordinates) as ReturnType<
          typeof osmLeg
        > & {
          peaks_source_kind?: string;
          peaks_source_authority?: string;
        };
        const properties = leg.features[0].properties as Record<
          string,
          unknown
        >;
        properties.osm_way_ids = [];
        properties.osm_way_urls = [];
        if (kind === "usgs") {
          const originator = `Source agency ${index + 1}`;
          leg.peaks_source_kind = "usgs-national-map";
          leg.peaks_source =
            "https://partnerships.nationalmap.gov/arcgis/rest/services/" +
            `USGSTrails/MapServer/0/query?where=objectid+IN+%28${index + 1}%29` +
            "&outFields=*&returnGeometry=true&outSR=4326&f=geojson";
          properties.usgs_object_ids = [index + 1];
          properties.usgs_requested_object_ids = [index + 1];
          properties.usgs_names = [`USGS ${index + 1}`];
          properties.usgs_originators = [originator];
          properties.usgs_source_feature_ids = [`feature-${index + 1}`];
          properties.usgs_source_dataset_ids = [`dataset-${index + 1}`];
          leg.peaks_license_name = USGS_TRAILS_LICENSE_NAME;
          leg.peaks_license = USGS_TRAILS_LICENSE_URL;
          leg.peaks_attribution = buildUsgsTrailAttribution([originator]);
        } else {
          leg.peaks_source_kind = "usfs-nfs-trails";
          leg.peaks_source = "https://example.test/query";
          leg.peaks_source_authority = "USDA Forest Service";
          leg.peaks_license_name =
            "U.S. Government work under 17 U.S.C. § 105";
          leg.peaks_license =
            "https://www.govinfo.gov/content/pkg/USCODE-2023-title17/html/USCODE-2023-title17-chap1-sec105.htm";
          leg.peaks_attribution = "USDA Forest Service";
          properties.official_source_id = "usfs-nfs-trails";
          properties.official_source_kind = "managed_trails";
          properties.official_authority = "USDA Forest Service";
          properties.official_feature_ids = [`feature-${index + 1}`];
          properties.official_requested_feature_ids = [`feature-${index + 1}`];
          properties.official_names = [`Official ${index + 1}`];
          properties.official_access = ["Open"];
          properties.largest_connection_m = 0;
        }
        return leg;
      });
      const outboundPath = join(directory, `${kind}-outbound.geojson`);
      const returnPath = join(directory, `${kind}-return.geojson`);
      const outputPath = join(directory, `${kind}-loop.geojson`);
      writeFileSync(outboundPath, JSON.stringify(legs[0]));
      writeFileSync(returnPath, JSON.stringify(legs[1]));
      const result = spawnSync(
        TSX,
        [
          LOOP_MERGER,
          "--outbound",
          outboundPath,
          "--return",
          returnPath,
          "--trailhead-id",
          "trailhead",
          "--route-shape",
          "loop",
          "--output",
          outputPath,
        ],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 10_000 }
      );
      assert.equal(result.status, 0, result.stderr);
      const merged = JSON.parse(readFileSync(outputPath, "utf8"));
      if (kind === "usgs") {
        assert.deepEqual(
          merged.features[0].properties.usgs_object_ids,
          [1, 2]
        );
        assert.match(
          new URL(merged.peaks_source).searchParams.get("where") ?? "",
          /objectid IN \(1,2\)/
        );
        assert.equal(
          merged.peaks_attribution,
          buildUsgsTrailAttribution(["Source agency 1", "Source agency 2"])
        );
      } else {
        assert.deepEqual(
          merged.features[0].properties.official_feature_ids,
          ["feature-1", "feature-2"]
        );
        assert.match(
          new URL(merged.peaks_source).searchParams.get("where") ?? "",
          /globalid IN \('feature-1','feature-2'\)/
        );
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
