import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { sourceCheckerArgs } from "../standard-route-source-check";

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
];

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
