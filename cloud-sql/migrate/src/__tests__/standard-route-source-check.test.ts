import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  sourceCheckerArgs,
  sourceCheckerRuntimePaths,
} from "../standard-route-source-check";

const MIGRATE_ROOT = join(__dirname, "../..");
const REPO_ROOT = join(MIGRATE_ROOT, "../..");
const CHECKERS = [
  join(
    REPO_ROOT,
    ".claude/skills/peaks-osm-route-approval/scripts/check_pending_osm_routes.mts"
  ),
  join(
    REPO_ROOT,
    ".claude/skills/peaks-osm-route-approval/scripts/check_pending_usgs_routes.mts"
  ),
  join(
    REPO_ROOT,
    ".claude/skills/peaks-osm-route-approval/scripts/check_pending_official_routes.mts"
  ),
];
const WEB_ROUTE_ACTIONS = join(
  REPO_ROOT,
  "web/src/lib/actions/routes.ts"
);

test("queue source checks carry the durable replacement binding", () => {
  assert.deepEqual(
    sourceCheckerArgs("checker.mts", "pending-route", "legacy-route"),
    [
      "checker.mts",
      "--route-id",
      "pending-route",
      "--format",
      "json",
      "--replace-active-route",
      "legacy-route",
    ]
  );
  assert.deepEqual(
    sourceCheckerArgs("checker.mts", "pending-route", null),
    ["checker.mts", "--route-id", "pending-route", "--format", "json"]
  );
});

test("queue source checks resolve from the module, not the process directory", () => {
  const originalCwd = process.cwd();
  process.chdir(MIGRATE_ROOT);
  try {
    const runtime = sourceCheckerRuntimePaths(
      join(MIGRATE_ROOT, "src"),
      ".claude/skills/peaks-osm-route-approval/scripts/check_pending_osm_routes.mts"
    );
    assert.equal(
      runtime.executable,
      join(MIGRATE_ROOT, "node_modules/.bin/tsx")
    );
    assert.equal(runtime.script, CHECKERS[0]);
    assert.equal(existsSync(runtime.executable), true);
    assert.equal(existsSync(runtime.script), true);
    const result = spawnSync(runtime.executable, [runtime.script, "--help"], {
      cwd: MIGRATE_ROOT,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
  } finally {
    process.chdir(originalCwd);
  }
});

test("activation rechecks same-name live routes under destination locks", () => {
  const source = readFileSync(WEB_ROUTE_ACTIONS, "utf8");
  assert.match(source, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(
    source,
    /'summit'::destination_feature = ANY\(d\.features\)[\s\S]*FOR UPDATE OF d/
  );
  assert.match(source, /live_route\.status IN \('active', 'pending'\)/);
  assert.match(source, /FOR UPDATE OF live_route/);
  assert.equal(
    (source.match(/await assertNoConflictingLiveRoute\(/g) ?? []).length,
    3
  );
});

for (const checker of CHECKERS) {
  test(`${checker.split("/").pop()} loads and documents replacement review`, () => {
    const result = spawnSync(
      join(MIGRATE_ROOT, "node_modules/.bin/tsx"),
      [checker, "--help"],
      {
        cwd: MIGRATE_ROOT,
        encoding: "utf8",
        timeout: 10_000,
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--replace-active-route ID/);

    const source = readFileSync(checker, "utf8");
    assert.match(
      source,
      /lower\(active_route\.name\) = lower\(r\.name\)/
    );
    assert.match(source, /active_route\.id <> \$2/);
    assert.match(source, /replacement_route_valid/);
    assert.match(source, /named active replacement route is not eligible/);
  });
}
