import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ROUTE_FACTORY_DATABASE_ROLE,
  ROUTE_REVIEWER_DATABASE_ROLE,
  databaseRoleForClaim,
  databaseRoleForTransition,
  requireRouteWorkerDatabaseRole,
} from "../standard-route-worker-role";

function connection(role: {
  database_user: string;
  is_factory: boolean;
  is_reviewer: boolean;
}) {
  return {
    async query(text: string) {
      assert.match(text, /session_user/);
      assert.match(text, /pg_has_role/);
      return { rows: [role] };
    },
  };
}

test("claim and transition stages choose separate database roles", () => {
  assert.equal(databaseRoleForClaim("factory"), ROUTE_FACTORY_DATABASE_ROLE);
  assert.equal(databaseRoleForClaim("review"), ROUTE_REVIEWER_DATABASE_ROLE);
  assert.equal(
    databaseRoleForTransition("pending_review"),
    ROUTE_REVIEWER_DATABASE_ROLE
  );
  assert.equal(
    databaseRoleForTransition("approved"),
    ROUTE_FACTORY_DATABASE_ROLE
  );
});

test("factory credentials cannot claim or complete review", async () => {
  const factory = connection({
    database_user: "peaks-route-factory-worker",
    is_factory: true,
    is_reviewer: false,
  });
  await requireRouteWorkerDatabaseRole(factory, ROUTE_FACTORY_DATABASE_ROLE);
  await assert.rejects(
    requireRouteWorkerDatabaseRole(factory, ROUTE_REVIEWER_DATABASE_ROLE),
    /cannot act as peaks-route-reviewer/
  );
});

test("reviewer credentials cannot claim factory work", async () => {
  const reviewer = connection({
    database_user: "peaks-route-reviewer-worker",
    is_factory: false,
    is_reviewer: true,
  });
  await requireRouteWorkerDatabaseRole(reviewer, ROUTE_REVIEWER_DATABASE_ROLE);
  await assert.rejects(
    requireRouteWorkerDatabaseRole(reviewer, ROUTE_FACTORY_DATABASE_ROLE),
    /cannot act as peaks-route-factory/
  );
});

test("ambiguous and unmarked credentials fail closed", async () => {
  for (const role of [
    { database_user: "postgres", is_factory: false, is_reviewer: false },
    { database_user: "bad", is_factory: true, is_reviewer: true },
  ]) {
    await assert.rejects(
      requireRouteWorkerDatabaseRole(
        connection(role),
        ROUTE_FACTORY_DATABASE_ROLE
      ),
      /exactly one worker role/
    );
  }
});

test("database trigger keeps factory writes out of the review lane", () => {
  const migration = readFileSync(
    join(
      __dirname,
      "../../../migrations/20260827_standard_route_worker_roles.sql"
    ),
    "utf8"
  );
  assert.match(migration, /pg_has_role\(\s*session_user,\s*'peaks-route-factory'/);
  assert.match(migration, /pg_has_role\(\s*session_user,\s*'peaks-route-reviewer'/);
  assert.match(migration, /OLD\.state = 'pending_review'/);
  assert.match(
    migration,
    /OLD\.state = 'verified'[\s\S]*factory database role cannot change verified jobs/
  );
  assert.match(migration, /NEW\.lease_owner = 'luna-route-reviewer-01'/);
  assert.match(
    migration,
    /NEW\.destination_id IS DISTINCT FROM OLD\.destination_id[\s\S]*cannot retarget queue jobs/
  );
  assert.match(migration, /factory database role cannot write review results/);
  assert.match(migration, /factory database role cannot change an approved binding/);
  assert.match(migration, /reviewer database role may update only pending_review jobs/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE[\s\S]*FROM "peaks-api"/);
  assert.doesNotMatch(
    migration,
    /GRANT\s+(?:INSERT|DELETE|TRUNCATE)[^;]*standard_route_backfill_jobs[^;]*TO "peaks-route-/
  );
  assert.match(
    migration,
    /REVOKE INSERT, DELETE, TRUNCATE ON standard_route_backfill_jobs[\s\S]*FROM "peaks-route-factory", "peaks-route-reviewer"/
  );
  assert.match(
    migration,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON route_integrity_repairs[\s\S]*FROM "peaks-route-factory", "peaks-route-reviewer"/
  );
  const workerSearchPaths =
    migration.match(/SET search_path = pg_catalog, public[^\n;]*/g) ?? [];
  assert.ok(workerSearchPaths.length >= 12);
  for (const searchPath of workerSearchPaths) {
    assert.equal(searchPath.trim(), "SET search_path = pg_catalog, public, pg_temp");
  }
  assert.match(
    migration,
    /ALTER FUNCTION public\.settle_route_integrity_replacement\(TEXT, TEXT, TEXT\)[\s\S]*SET search_path = pg_catalog, public, pg_temp/
  );
});

test("database triggers bind factory route writes to reviewed pending routes", () => {
  const migration = readFileSync(
    join(
      __dirname,
      "../../../migrations/20260827_standard_route_worker_roles.sql"
    ),
    "utf8"
  );
  assert.match(migration, /factory database role may insert only pending Peaks routes/);
  assert.match(migration, /factory database role cannot delete a live route/);
  assert.match(migration, /job\.published_route_id = OLD\.id[\s\S]*job\.state = 'candidate_ready'/);
  assert.match(migration, /factory route delete has another live queue binding/);
  assert.match(migration, /factory route activation requires the bound activation function/);
  assert.match(migration, /approved_route_binding,routeName/);
  assert.match(migration, /approved_route_binding,destinations/);
  assert.match(migration, /peaks_route_passes_publish_integrity\(\s*new_route_id/);
  assert.match(migration, /factory database role may change links only on pending Peaks routes/);
  assert.match(migration, /factory database role cannot change reviewed destinations/);
  assert.match(migration, /factory database role cannot edit segment records/);
  assert.match(migration, /factory database role cannot delete a linked segment/);
  assert.match(
    migration,
    /GRANT UPDATE \(id\) ON destinations[\s\S]*TO "peaks-route-factory", "peaks-route-reviewer"/
  );
  assert.match(
    migration,
    /route worker database roles may lock but not change destinations/
  );
  assert.match(
    migration,
    /CREATE TRIGGER trg_guard_standard_route_factory_route[\s\S]*BEFORE INSERT OR UPDATE OR DELETE ON routes/
  );
  assert.match(
    migration,
    /CREATE TRIGGER trg_guard_standard_route_factory_destinations[\s\S]*BEFORE INSERT OR UPDATE OR DELETE ON route_destinations/
  );
  assert.match(
    migration,
    /CREATE TRIGGER trg_guard_standard_route_factory_segments[\s\S]*BEFORE INSERT OR UPDATE OR DELETE ON route_segments/
  );
  assert.match(
    migration,
    /CREATE TRIGGER trg_guard_standard_route_factory_segment[\s\S]*BEFORE INSERT OR UPDATE OR DELETE ON segments/
  );
  assert.match(
    migration,
    /CREATE TRIGGER trg_guard_standard_route_worker_destination_write[\s\S]*BEFORE INSERT OR UPDATE OR DELETE ON destinations/
  );
});

test("factory table grants are narrow and direct route updates fail closed", () => {
  const migration = readFileSync(
    join(
      __dirname,
      "../../../migrations/20260827_standard_route_worker_roles.sql"
    ),
    "utf8"
  );
  assert.match(
    migration,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON[\s\S]*destinations,[\s\S]*routes,[\s\S]*route_destinations,[\s\S]*route_segments,[\s\S]*segments,[\s\S]*route_areas[\s\S]*FROM "peaks-route-factory", "peaks-route-reviewer"/
  );
  assert.match(migration, /GRANT INSERT, DELETE ON routes TO "peaks-route-factory"/);
  assert.match(migration, /GRANT INSERT ON route_destinations TO "peaks-route-factory"/);
  assert.match(migration, /GRANT INSERT, DELETE ON route_segments TO "peaks-route-factory"/);
  assert.match(migration, /GRANT INSERT, DELETE ON segments TO "peaks-route-factory"/);
  assert.match(migration, /GRANT UPDATE \(status\) ON routes/);
  assert.doesNotMatch(
    migration,
    /GRANT INSERT, UPDATE, DELETE ON[\s\S]{0,120}routes/
  );
  assert.match(
    migration,
    /current_user <> activation_owner[\s\S]*factory route activation requires the bound activation function/
  );
  assert.match(
    migration,
    /current_user <> settlement_owner[\s\S]*factory route retirement requires the bound settlement function/
  );
});

test("factory import writes must reach one safe final queue binding", () => {
  const migration = readFileSync(
    join(
      __dirname,
      "../../../migrations/20260827_standard_route_worker_roles.sql"
    ),
    "utf8"
  );
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER trg_check_standard_route_factory_route_final[\s\S]*AFTER INSERT ON routes[\s\S]*DEFERRABLE INITIALLY DEFERRED/
  );
  assert.match(
    migration,
    /factory route insert must finish as one unleased pending_review binding/
  );
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER trg_check_standard_route_factory_destinations_final[\s\S]*AFTER INSERT OR DELETE ON route_destinations[\s\S]*DEFERRABLE INITIALLY DEFERRED/
  );
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER trg_check_standard_route_factory_segments_final[\s\S]*AFTER INSERT OR DELETE ON route_segments[\s\S]*DEFERRABLE INITIALLY DEFERRED/
  );
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER trg_check_standard_route_factory_segment_final[\s\S]*AFTER INSERT ON segments[\s\S]*DEFERRABLE INITIALLY DEFERRED/
  );
  assert.match(migration, /factory segment insert escaped its route-job binding/);
  assert.match(
    migration,
    /IF NOT FOUND THEN[\s\S]*IF TG_OP = 'DELETE' THEN[\s\S]*RETURN OLD;[\s\S]*factory database role cannot link a missing route/
  );
});

test("route area maintenance has the rights needed by factory inserts", () => {
  const migration = readFileSync(
    join(
      __dirname,
      "../../../migrations/20260827_standard_route_worker_roles.sql"
    ),
    "utf8"
  );
  assert.match(
    migration,
    /ALTER FUNCTION refresh_route_area_links_on_path_write\(\) SECURITY DEFINER/
  );
  assert.match(
    migration,
    /ALTER FUNCTION refresh_route_area_links_on_path_write\(\)[\s\S]*SET search_path = pg_catalog, public/
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION refresh_route_area_links_on_path_write\(\)[\s\S]*FROM PUBLIC, "peaks-route-factory", "peaks-route-reviewer"/
  );
});

test("factory replacement settlement is a bound security-definer operation", () => {
  const migration = readFileSync(
    join(
      __dirname,
      "../../../migrations/20260827_standard_route_worker_roles.sql"
    ),
    "utf8"
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION settle_route_integrity_replacement\(TEXT, TEXT, TEXT\)[\s\S]*FROM PUBLIC, "peaks-route-factory", "peaks-route-reviewer"/
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION settle_standard_route_factory_replacement\([\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public/
  );
  assert.match(migration, /job\.state = 'approved'/);
  assert.match(migration, /job\.replacement_route_id = old_route_id/);
  assert.match(migration, /job\.published_route_id = new_route_id/);
  assert.match(migration, /job\.lease_expires_at >= clock_timestamp\(\)/);
  assert.match(
    migration,
    /old_route_summit_count > 1[\s\S]*factory replacement cannot retire a valid route shared by multiple summits/
  );
  assert.match(
    migration,
    /FOR UPDATE OF job, old_route, new_route[\s\S]*FOR UPDATE OF old_link, old_destination[\s\S]*FOR UPDATE OF old_segment_link, old_segment/
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION settle_standard_route_factory_replacement\(TEXT, TEXT, TEXT\)[\s\S]*TO "peaks-route-factory"/
  );
});

test("factory activation and replacement settlement are one bound operation", () => {
  const migration = readFileSync(
    join(
      __dirname,
      "../../../migrations/20260827_standard_route_worker_roles.sql"
    ),
    "utf8"
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION activate_standard_route_factory\([\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public/
  );
  assert.match(migration, /job\.destination_id = current_destination_id/);
  assert.match(migration, /job\.published_route_id = new_route_id/);
  assert.match(migration, /job\.lease_token = current_lease_token/);
  assert.match(migration, /job\.lease_expires_at >= clock_timestamp\(\)/);
  assert.match(migration, /factory activation route has another queue binding/);
  assert.match(migration, /factory activation route cannot replace itself/);
  assert.match(migration, /approved_route_binding,identitySources/);
  assert.match(migration, /approved_route_binding,geometrySource/);
  assert.match(migration, /approved_route_binding,geometry/);
  assert.match(migration, /factory activation conflicts with live route/);
  assert.match(
    migration,
    /UPDATE public\.routes[\s\S]*SET status = 'active'[\s\S]*settle_standard_route_factory_replacement/
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION activate_standard_route_factory\(TEXT, TEXT, TEXT\)[\s\S]*FROM PUBLIC/
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION activate_standard_route_factory\(TEXT, TEXT, TEXT\)[\s\S]*TO "peaks-route-factory"/
  );
});

test("legacy terminal jobs gain only a valid live country binding", () => {
  const migration = readFileSync(
    join(
      __dirname,
      "../../../migrations/20260827_standard_route_worker_roles.sql"
    ),
    "utf8"
  );
  assert.match(
    migration,
    /UPDATE public\.standard_route_backfill_jobs job[\s\S]*jsonb_set\([\s\S]*official_source_country_code[\s\S]*FROM public\.destinations destination/
  );
  assert.match(migration, /job\.state IN \('published', 'verified'\)/);
  assert.match(
    migration,
    /NULLIF\(btrim\(job\.candidate ->> 'official_source_country_code'\), ''\) IS NULL/
  );
  assert.match(
    migration,
    /upper\(btrim\(destination\.country_code\)\) ~ '\^\[A-Z\]\{2\}\$'/
  );
});

test("activation binds reviewed source country to the locked live destination", () => {
  const migration = readFileSync(
    join(
      __dirname,
      "../../../migrations/20260827_standard_route_worker_roles.sql"
    ),
    "utf8"
  );
  const activation = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION activate_standard_route_factory"),
    migration.indexOf(
      "REVOKE ALL ON FUNCTION activate_standard_route_factory"
    )
  );
  assert.match(
    activation,
    /FROM public\.destinations destination[\s\S]*FOR UPDATE OF destination/
  );
  assert.match(
    activation,
    /activation_job\.candidate ->> 'official_source_country_code'[\s\S]*IS DISTINCT FROM activation_destination_country_code/
  );
  assert.match(
    activation,
    /approved_route_binding,officialSourceCountryCode[\s\S]*IS DISTINCT FROM activation_destination_country_code/
  );
  assert.match(
    activation,
    /factory activation country no longer matches reviewer approval/
  );
});

test("shared publish integrity requires the live ordinal-zero trailhead", () => {
  const migration = readFileSync(
    join(
      __dirname,
      "../../../migrations/20260827_standard_route_worker_roles.sql"
    ),
    "utf8"
  );
  const predicate = migration.slice(
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.peaks_route_passes_publish_integrity"
    ),
    migration.indexOf(
      "GRANT EXECUTE ON FUNCTION peaks_route_passes_publish_integrity"
    )
  );
  assert.match(predicate, /required_destination_id IS NULL[\s\S]*trailhead_rd\.ordinal = 0/);
  assert.match(
    predicate,
    /'trailhead'::destination_feature = ANY\(trailhead\.features\)/
  );
  assert.match(
    predicate,
    /ST_DWithin\([\s\S]*ST_StartPoint\(c\.path::geometry\)::geography,[\s\S]*trailhead\.location,[\s\S]*125/
  );
});
