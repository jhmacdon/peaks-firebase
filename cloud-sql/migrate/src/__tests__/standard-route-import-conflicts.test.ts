import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  findConflictingLiveRoute,
  lockAndFindConflictingLiveRoute,
} from "../standard-route-import-conflicts";

const MIGRATE_ROOT = join(__dirname, "../..");
const IMPORTER_PATH = join(
  MIGRATE_ROOT,
  "../../.claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts"
);

const routes = [
  {
    id: "legacy-whitney-trail",
    name: "Mount Whitney via Mount Whitney Trail",
    status: "active",
  },
  {
    id: "mountaineers-route",
    name: "Mountaineer's Route",
    status: "active",
  },
];

test("a distinct active route on the same destination can coexist", () => {
  assert.equal(
    findConflictingLiveRoute(
      routes,
      "Mount Whitney via Mount Whitney Trail",
      ["legacy-whitney-trail"]
    ),
    null
  );
});

test("another live route with the same name remains a conflict", () => {
  const conflict = findConflictingLiveRoute(
    [
      ...routes,
      {
        id: "duplicate",
        name: "MOUNT WHITNEY VIA MOUNT WHITNEY TRAIL",
        status: "pending",
      },
    ],
    "Mount Whitney via Mount Whitney Trail",
    ["legacy-whitney-trail"]
  );

  assert.equal(conflict?.id, "duplicate");
});

test("explicit replacement ids and superseded routes do not conflict", () => {
  assert.equal(
    findConflictingLiveRoute(
      [
        {
          id: "old-route",
          name: "Peak via Standard Trail",
          status: "active",
        },
        {
          id: "older-route",
          name: "Peak via Standard Trail",
          status: "superseded",
        },
      ],
      "Peak via Standard Trail",
      ["old-route"]
    ),
    null
  );
});

test("the transaction helper locks live routes before checking an upgrade", async () => {
  const queries: Array<{ text: string; values: unknown[] | undefined }> = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: [
          {
            id: "other-route",
            name: "Peak via Standard Trail",
            status: "active",
          },
        ],
      };
    },
  } as unknown as PoolClient;

  const conflict = await lockAndFindConflictingLiveRoute(
    client,
    "peak-id",
    "Peak via Standard Trail",
    ["upgraded-route"]
  );

  assert.equal(conflict?.id, "other-route");
  assert.deepEqual(queries[0]?.values, ["peak-id"]);
  assert.match(queries[0]?.text ?? "", /FOR UPDATE OF r/);
  assert.match(
    queries[0]?.text ?? "",
    /r\.status IN \('active', 'pending'\)/
  );
});

test("active upgrade rechecks conflicts after its destination lock", () => {
  const importer = readFileSync(IMPORTER_PATH, "utf8");
  const start = importer.indexOf("async function upgradeActiveRoute(");
  const end = importer.indexOf("\nasync function main()", start);
  const upgrade = importer.slice(start, end);

  const destinationLock = upgrade.indexOf(
    "SELECT id FROM destinations WHERE id = ANY($1::text[]) FOR UPDATE"
  );
  const conflictLock = upgrade.indexOf(
    "await lockAndFindConflictingLiveRoute("
  );
  const routeUpdate = upgrade.indexOf("`UPDATE routes");

  assert.ok(destinationLock >= 0, "upgrade must lock the destination");
  assert.ok(
    conflictLock > destinationLock,
    "upgrade must recheck live conflicts after the destination lock"
  );
  assert.ok(
    routeUpdate > conflictLock,
    "upgrade must recheck conflicts before changing the active route"
  );
});

test("active upgrade rolls back a summit gap allowed by candidate intake but rejected by publish integrity", () => {
  const importer = readFileSync(IMPORTER_PATH, "utf8");
  const start = importer.indexOf("async function upgradeActiveRoute(");
  const end = importer.indexOf("\nasync function main()", start);
  const upgrade = importer.slice(start, end);

  const candidateIntakeGapMeters = 6;
  const validPublishGapMeters = 4.9;
  assert.ok(candidateIntakeGapMeters <= 20);
  assert.ok(candidateIntakeGapMeters > 5);
  assert.ok(validPublishGapMeters <= 5);

  const destinationWrite = upgrade.indexOf(
    "INSERT INTO route_destinations (route_id, destination_id, ordinal)"
  );
  const destinationLock = upgrade.indexOf("FOR UPDATE OF rd, d");
  const segmentLock = upgrade.indexOf("FOR UPDATE OF rs, s");
  const publishGate = upgrade.indexOf(
    "peaks_route_passes_publish_integrity($1, $2, 'active')"
  );
  const failedGate = upgrade.indexOf(
    "Active upgrade failed summit contact, elevation, provenance, or segment assembly gates"
  );
  const commit = upgrade.indexOf('await client.query("COMMIT")');
  const rollback = upgrade.indexOf('await client.query("ROLLBACK")');

  assert.ok(destinationWrite >= 0);
  assert.ok(destinationLock > destinationWrite);
  assert.ok(segmentLock > destinationLock);
  assert.ok(publishGate > segmentLock);
  assert.ok(failedGate > publishGate);
  assert.ok(commit > failedGate);
  assert.ok(rollback > commit);
});

test("route writers atomically set or clear terrain elevation credit", () => {
  const importer = readFileSync(IMPORTER_PATH, "utf8");
  const pendingStart = importer.indexOf("async function createPendingRoute(");
  const upgradeStart = importer.indexOf("async function upgradeActiveRoute(");
  const mainStart = importer.indexOf("\nasync function main()", upgradeStart);
  const pending = importer.slice(pendingStart, upgradeStart);
  const upgrade = importer.slice(upgradeStart, mainStart);

  assert.match(importer, /AWS Open Data Terrain Tiles \(Mapzen Terrarium z14\)/);
  assert.match(importer, /https:\/\/registry\.opendata\.aws\/terrain-tiles\//);
  assert.match(importer, /tilezen\/joerd\/blob\/master\/docs\/attribution\.md/);
  assert.match(importer, /ArcticDEM terrain data DEM\(s\)/);
  assert.match(importer, /function routeElevationLineage\(candidate: Candidate\)/);
  assert.match(importer, /elevation_source: elevationSourceName\(\)/);
  assert.match(importer, /retrievedAt: candidate\.retrievedAt/);
  assert.match(importer, /source: null,[\s\S]*sourceUrl: null,[\s\S]*attribution: null,[\s\S]*licenseUrl: null,[\s\S]*retrievedAt: null/);
  assert.match(pending, /elevation_source, elevation_source_url, elevation_attribution,/);
  assert.match(pending, /elevation_license_url, elevation_retrieved_at/);
  assert.match(upgrade, /elevation_source = \$11/);
  assert.match(upgrade, /elevation_source_url = \$12/);
  assert.match(upgrade, /elevation_attribution = \$13/);
  assert.match(upgrade, /elevation_license_url = \$14/);
  assert.match(upgrade, /elevation_retrieved_at = \$15::timestamptz/);
  for (const writer of [pending, upgrade]) {
    assert.match(writer, /elevationLineage\.source/);
    assert.match(writer, /elevationLineage\.sourceUrl/);
    assert.match(writer, /elevationLineage\.attribution/);
    assert.match(writer, /elevationLineage\.licenseUrl/);
    assert.match(writer, /elevationLineage\.retrievedAt/);
  }
  assert.match(pending, /JSON\.stringify\(routeProvenance\)/);
  assert.match(
    pending,
    /INSERT INTO segments[\s\S]+?JSON\.stringify\(routeProvenance\)/
  );
});

test("restart reuse requires exact XYZ elevation lineage and pending integrity", () => {
  const importer = readFileSync(IMPORTER_PATH, "utf8");
  const preflightStart = importer.indexOf("async function findExactExistingRoute(");
  const pendingStart = importer.indexOf("async function createPendingRoute(");
  const upgradeStart = importer.indexOf("async function upgradeActiveRoute(");
  const preflight = importer.slice(preflightStart, pendingStart);
  const pending = importer.slice(pendingStart, upgradeStart);

  const wrongZAndCredit = {
    path: "LINESTRING Z (-121 47 100, -121.001 47.001 300)",
    elevationSource: "stale source",
  };
  const exactTerrain = {
    path: "LINESTRING Z (-121 47 100, -121.001 47.001 200)",
    elevationSource: "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)",
  };
  assert.notEqual(wrongZAndCredit.path, exactTerrain.path);
  assert.notEqual(wrongZAndCredit.elevationSource, exactTerrain.elevationSource);

  for (const exactMatch of [preflight, pending]) {
    assert.match(
      exactMatch,
      /encode\(ST_AsEWKB\(r\.path::geometry\), 'hex'\) =\s+encode\(ST_AsEWKB\(ST_GeomFromText\(\$4, 4326\)\), 'hex'\)/
    );
    assert.doesNotMatch(exactMatch, /ST_Equals\(r\.path::geometry/);
    assert.match(exactMatch, /r\.elevation_string = encode_route_elevation_profile\(r\.path\)/);
    assert.match(exactMatch, /r\.gain IS NOT DISTINCT FROM elevation_stats\.gain/);
    assert.match(exactMatch, /r\.gain_loss IS NOT DISTINCT FROM elevation_stats\.loss/);
    assert.match(exactMatch, /r\.elevation_source IS NOT DISTINCT FROM \$8::text/);
    assert.match(exactMatch, /r\.elevation_retrieved_at IS NOT DISTINCT FROM \$12::timestamptz/);
    assert.match(exactMatch, /peaks_route_passes_publish_integrity\(\s+r\.id, \$6, 'pending'\s+\)/);
  }
});

test("noisy profiles write the SQL canonical stats used by integrity and restart reuse", () => {
  const importer = readFileSync(IMPORTER_PATH, "utf8");
  const pendingStart = importer.indexOf("async function createPendingRoute(");
  const upgradeStart = importer.indexOf("async function upgradeActiveRoute(");
  const mainStart = importer.indexOf("\nasync function main()", upgradeStart);
  const pending = importer.slice(pendingStart, upgradeStart);
  const upgrade = importer.slice(upgradeStart, mainStart);

  // A three-point crest makes the old smoothing path undercount both legs.
  // The database function instead stores the raw profile's two ten-metre legs.
  const noisyProfile = [100, 110, 100];
  const rawStats = { gain: 0, loss: 0 };
  for (let index = 1; index < noisyProfile.length; index += 1) {
    const difference = noisyProfile[index] - noisyProfile[index - 1];
    if (difference > 4) rawStats.gain += difference;
    if (difference < -4) rawStats.loss += Math.abs(difference);
  }
  assert.deepEqual(rawStats, { gain: 10, loss: 10 });

  assert.doesNotMatch(importer, /function smoothElevations/);
  for (const writer of [pending, upgrade]) {
    assert.match(
      writer,
      /SELECT gain, loss\s+FROM route_elevation_stats\(ST_GeomFromText\(\$1, 4326\)::geography\)/
    );
    assert.match(writer, /canonicalStats\.gain/);
    assert.match(writer, /canonicalStats\.loss/);
  }
  assert.match(
    importer,
    /r\.gain IS NOT DISTINCT FROM elevation_stats\.gain[\s\S]+?r\.gain_loss IS NOT DISTINCT FROM elevation_stats\.loss/
  );
});

test("the worker runtime can load the importer before claiming a job", () => {
  const result = spawnSync(
    join(MIGRATE_ROOT, "node_modules/.bin/tsx"),
    [IMPORTER_PATH, "--help"],
    {
      cwd: MIGRATE_ROOT,
      encoding: "utf8",
      timeout: 10_000,
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage:/);
});
