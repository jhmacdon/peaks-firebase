import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveRouteArtifactPath } from "../standard-route-paths";

const MIGRATE_ROOT = path.resolve(__dirname, "../..");
const MODULE_DIRECTORY = path.join(MIGRATE_ROOT, "src");
const EXPECTED = path.join(
  MIGRATE_ROOT,
  "route-candidates/luna/destination.geojson"
);

test("route artifacts accept the short migrate-relative path", () => {
  assert.equal(
    resolveRouteArtifactPath(
      MODULE_DIRECTORY,
      "route-candidates/luna/destination.geojson"
    ),
    EXPECTED
  );
});

test("route artifacts accept the repo-root path printed by builders", () => {
  assert.equal(
    resolveRouteArtifactPath(
      MODULE_DIRECTORY,
      "cloud-sql/migrate/route-candidates/luna/destination.geojson"
    ),
    EXPECTED
  );
});

test("route artifacts preserve an absolute path", () => {
  assert.equal(
    resolveRouteArtifactPath(MODULE_DIRECTORY, EXPECTED),
    EXPECTED
  );
});
