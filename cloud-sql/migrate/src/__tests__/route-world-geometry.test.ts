import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  boundedRouteWorldTiles,
  interpolateWorldPosition,
  normalizeLongitudeDelta,
  pointToSegmentMeters,
  routeWorldTilePositions,
  worldTilePixel,
  wrappedLongitudeCorridor,
  wrappedTileX,
} from "../route-world-geometry";

const REPO_ROOT = join(__dirname, "../../../..");
const MIGRATE_ROOT = join(__dirname, "../..");

test("point-to-segment distance keeps a dateline trail away from Greenwich", () => {
  const distance = pointToSegmentMeters(
    { lat: 0, lng: 0 },
    { lat: 0, lng: 179.9 },
    { lat: 0, lng: -179.9 }
  );
  assert.ok(distance > 19_000_000, `got ${distance}`);
});

test("point-to-segment distance treats a dateline trail as local", () => {
  const distance = pointToSegmentMeters(
    { lat: 0.001, lng: 180 },
    { lat: 0, lng: 179.9 },
    { lat: 0, lng: -179.9 }
  );
  assert.ok(distance > 110 && distance < 112, `got ${distance}`);
});

test("interpolation crosses the antimeridian by the short arc", () => {
  assert.deepEqual(interpolateWorldPosition([179.9, 2], [-179.9, 4], 0.5), [
    -180,
    3,
  ]);
});

test("longitude normalization handles large finite values in constant time", () => {
  const normalized = normalizeLongitudeDelta(1_000_000_000_000);
  assert.ok(normalized >= -180 && normalized <= 180);
  assert.equal(normalizeLongitudeDelta(180), 180);
  assert.equal(normalizeLongitudeDelta(-180), -180);
});

test("route tile positions keep a dateline route narrow", () => {
  const zoom = 14;
  const coordinates: Array<[number, number]> = [
    [179.99, 0],
    [-179.99, 0],
  ];
  const positions = routeWorldTilePositions(coordinates, zoom);
  assert.ok(Math.abs(positions[1].x - positions[0].x) < 1);
  assert.equal(wrappedTileX(Math.floor(positions[1].x), zoom), 0);
  assert.equal(
    boundedRouteWorldTiles(coordinates, zoom, { maxTiles: 500 }).totalTiles,
    2
  );
});

test("positive and negative 180 degrees resolve to the same cached tile", () => {
  const zoom = 14;
  const positive = worldTilePixel([180, 0], zoom, 256);
  const negative = worldTilePixel([-180, 0], zoom, 256);
  assert.deepEqual(positive, negative);

  const importer = readFileSync(
    join(
      REPO_ROOT,
      ".claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts"
    ),
    "utf8"
  );
  assert.match(importer, /worldTilePixel/);
});

test("wrapped tile bounds reject a route that winds around the world", () => {
  const coordinates = Array.from({ length: 5_000 }, (_, index) => [
    ((index * 170 + 180) % 360) - 180,
    0,
  ] as [number, number]);

  assert.throws(
    () => boundedRouteWorldTiles(coordinates, 14, { maxTiles: 500 }),
    /exceed the 500-tile limit/
  );
  assert.throws(
    () =>
      boundedRouteWorldTiles(coordinates, 3, {
        maxTiles: 144,
        paddingTiles: 1,
      }),
    /exceed the 144-tile limit/
  );
});

test("world-tile unwrapping stays linear across many world crossings", () => {
  const coordinates = Array.from({ length: 50_000 }, (_, index) => [
    ((index * 170 + 180) % 360) - 180,
    0,
  ] as [number, number]);
  const positions = routeWorldTilePositions(coordinates, 14);
  assert.equal(positions.length, coordinates.length);
  assert.ok(positions.at(-1)!.x - positions[0].x > 20_000_000);
});

test("terrain cache and local renderer reject winding routes before fetching tiles", () => {
  const directory = mkdtempSync(join(tmpdir(), "peaks-world-tiles-"));
  try {
    const candidatePath = join(directory, "winding.geojson");
    const outputPath = join(directory, "winding.png");
    const coordinates = Array.from({ length: 5_000 }, (_, index) => [
      ((index * 170 + 180) % 360) - 180,
      0,
    ]);
    writeFileSync(
      candidatePath,
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Winding route" },
            geometry: { type: "LineString", coordinates },
          },
        ],
      })
    );
    const cache = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(
          REPO_ROOT,
          ".claude/skills/peaks-standard-route-backfill/scripts/cache_route_terrain_tiles.mts"
        ),
        "--candidate",
        candidatePath,
        "--output-dir",
        join(directory, "terrain"),
      ],
      { cwd: MIGRATE_ROOT, encoding: "utf8", timeout: 5_000 }
    );
    assert.equal(cache.status, 1, cache.stderr);
    assert.match(cache.stderr, /exceed the 500-tile limit/);

    const render = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(
          REPO_ROOT,
          ".claude/skills/peaks-standard-route-backfill/scripts/render_route_candidate_local_map.mts"
        ),
        "--geojson",
        candidatePath,
        "--output",
        outputPath,
      ],
      { cwd: MIGRATE_ROOT, encoding: "utf8", timeout: 5_000 }
    );
    assert.equal(render.status, 1, render.stderr);
    assert.match(render.stderr, /exceed the 144-tile limit/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("longitude corridors split only at the antimeridian", () => {
  assert.deepEqual(wrappedLongitudeCorridor(-120, -121, 0.1), [
    { west: -121.1, east: -119.9 },
  ]);
  const dateline = wrappedLongitudeCorridor(179.9, -179.9, 0.05);
  assert.equal(dateline.length, 2);
  assert.ok(dateline[0].west > 179.8 && dateline[0].east === 180);
  assert.ok(dateline[1].west === -180 && dateline[1].east < -179.8);
});

test("route checks and local tools use the shared world-wrap math", () => {
  for (const relativePath of [
    ".claude/skills/peaks-osm-route-approval/scripts/check_pending_osm_routes.mts",
    ".claude/skills/peaks-standard-route-backfill/scripts/build_osm_route_candidate.mts",
    ".claude/skills/peaks-standard-route-backfill/scripts/cache_route_terrain_tiles.mts",
    ".claude/skills/peaks-standard-route-backfill/scripts/render_route_candidate_local_map.mts",
    ".claude/skills/peaks-standard-route-backfill/scripts/compare_route_reference.mts",
  ]) {
    const source = readFileSync(join(REPO_ROOT, relativePath), "utf8");
    if (relativePath.endsWith("check_pending_osm_routes.mts")) {
      assert.match(source, /osm-route-geometry/);
      assert.match(
        readFileSync(join(MIGRATE_ROOT, "src/osm-route-geometry.ts"), "utf8"),
        /route-world-geometry/
      );
    } else {
      assert.match(source, /route-world-geometry/);
    }
    if (
      relativePath.endsWith("cache_route_terrain_tiles.mts") ||
      relativePath.endsWith("render_route_candidate_local_map.mts")
    ) {
      assert.match(source, /boundedRouteWorldTiles/);
    }
  }
  const usgsChecker = readFileSync(
    join(
      REPO_ROOT,
      ".claude/skills/peaks-osm-route-approval/scripts/check_pending_usgs_routes.mts"
    ),
    "utf8"
  );
  assert.match(usgsChecker, /reviewOfficialRouteGeometry/);
  assert.match(usgsChecker, /internalConnectorSegmentIndexes/);
  assert.match(usgsChecker, /reviewLollipopRetrace/);
  assert.match(usgsChecker, /!review\.sourceTopologyValid/);

  const officialChecker = readFileSync(
    join(
      REPO_ROOT,
      ".claude/skills/peaks-osm-route-approval/scripts/check_pending_official_routes.mts"
    ),
    "utf8"
  );
  assert.match(officialChecker, /!review\.sourceTopologyValid/);

  for (const relativePath of [
    ".claude/skills/peaks-osm-route-approval/scripts/check_pending_osm_routes.mts",
    ".claude/skills/peaks-osm-route-approval/scripts/check_pending_usgs_routes.mts",
    ".claude/skills/peaks-osm-route-approval/scripts/check_pending_official_routes.mts",
  ]) {
    const source = readFileSync(join(REPO_ROOT, relativePath), "utf8");
    assert.match(source, /route\.shape === "loop"/);
    assert.match(source, /isSimpleClosedRoute\(points\)/);
    assert.match(source, /route\.shape === "lollipop"/);
    assert.match(source, /reviewLollipopRetrace\(points\)/);
  }
});
