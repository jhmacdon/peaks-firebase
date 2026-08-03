import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

const MIGRATE_ROOT = join(__dirname, "../..");
const REPO_ROOT = join(MIGRATE_ROOT, "../..");
const RUNNER = join(MIGRATE_ROOT, "scripts/run-tsx.sh");

test("worker TypeScript runner loads a real entrypoint from the caller directory", () => {
  const result = spawnSync(
    RUNNER,
    ["cloud-sql/migrate/src/route-catalog-audit-jobs.ts", "--help"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 10_000,
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(`${result.stdout}\n${result.stderr}`, /Usage:/);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /listen EPERM|\.pipe/
  );
});
