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
