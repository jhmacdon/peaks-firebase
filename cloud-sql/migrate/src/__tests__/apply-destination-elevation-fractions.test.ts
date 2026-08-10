import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  CATALOG_SCOPE_SQL,
  DESTINATION_UPDATE_TRIGGER_GUARD_SQL,
  FINGERPRINT_IMPACT_SQL,
  LIVE_ROWS_FOR_UPDATE_SQL,
  LOCK_AFFECTED_CATALOG_JOBS_SQL,
  REPAIR_METADATA_KEY,
  REVIEWED_CANDIDATE_COUNT,
  REVIEWED_CATALOG_DESTINATION_COUNT,
  REVIEWED_CATALOG_DESTINATION_IDS,
  REVIEWED_CATALOG_DESTINATION_SET_SHA256,
  REVIEWED_PATH_REPAIRS,
  REVIEWED_REPORT_SHA256,
  RECONCILE_ROUTE_ELEVATION_JOBS_SQL,
  RECONCILE_STANDARD_ROUTE_JOBS_SQL,
  ROUTE_VERTEX_IMPACT_SQL,
  SESSION_TRACKING_INVARIANT_SQL,
  TARGETED_CATALOG_SEED_SQL,
  UPDATE_REVIEWED_ROUTE_VERTICES_SQL,
  UPDATE_REVIEWED_SEGMENT_VERTICES_SQL,
  UPDATE_SQL,
  assertDestinationUpdateTriggerGuard,
  assertSessionTrackingInvariantUnchanged,
  catalogDestinationSetSha256,
  destinationUpdateTriggerGuard,
  parseApplyArgs,
  resolveReviewedExpectation,
  routeVertexImpact,
  sessionTrackingInvariant,
  validateCatalogScopeRows,
  validateElevationFractionReport,
  validatePathRepairAudit,
  validateReviewedCatalogManifest,
} from "../apply-destination-elevation-fractions";

const sha256 = "a".repeat(64);

function candidate(overrides: Record<string, unknown> = {}) {
  const base = {
    destination: {
      id: "destination-1",
      name: "Reviewed Peak",
      elevationM: 1451,
      lat: 47.331549,
      lng: -120.937441,
      type: "point",
      features: ["summit"],
      countryCode: "US",
      stateCode: "WA",
      externalIds: { osm: "356546696" },
      createdAt: "2026-03-13T20:09:36.014Z",
      updatedAt: "2026-07-23T17:48:15.135Z",
    },
    classification: "direct_metre_fraction_candidate",
    applyCandidate: true,
    proposedElevationM: 1451.5,
    reasons: ["exact_direct_metre_source_restores_only_the_positive_fractional_component"],
    identity: {
      osm: {
        references: [{
          key: "osm",
          id: "356546696",
          elementType: "node",
          status: "valid",
          reason: "exact_osm_id_and_coordinate_match",
          distanceM: 10.145,
          linkedWikidata: false,
        }],
      },
    },
    evidence: [{
      provider: "osm",
      providerId: "node/356546696",
      sourceUrl: "https://www.openstreetmap.org/node/356546696",
      rawValue: "1451.5",
      rawUnit: "m",
      unit: "metre",
      valueM: 1451.5,
      deltaM: 0.5,
      sourceTimestamp: "2024-08-19T15:55:35Z",
      sourceVersion: 7,
    }],
    provenanceTiming: {
      status: "preexisting",
      cutoffAt: "2026-07-23T17:48:15.135Z",
      cutoffBasis: "osm_id_backfill",
      provider: "osm",
      providerId: "node/356546696",
      proof: "current_version",
      matchingVersion: {
        version: 7,
        timestamp: "2024-08-19T15:55:35Z",
        visible: true,
        rawValue: "1451.5",
        rawUnit: "m",
        unit: "metre",
        valueM: 1451.5,
      },
      versionAtOrBeforeCutoff: {
        version: 7,
        timestamp: "2024-08-19T15:55:35Z",
        visible: true,
        rawValue: "1451.5",
        rawUnit: "m",
        unit: "metre",
        valueM: 1451.5,
      },
    },
  };
  return { ...base, ...overrides };
}

function report(candidateValue = candidate()) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-10T00:00:00.000Z",
    dryRun: true,
    safety: { applyModeAvailable: false, storedUnit: "metre" },
    inventory: { destinationsAudited: 1 },
    summary: { applyCandidates: 1 },
    candidates: [candidateValue],
    results: [candidateValue],
  };
}

test("reviewed apply arguments require the exact pinned report and count", () => {
  const args = parseApplyArgs([
    "--report=/tmp/report.json",
    `--expected-report-sha256=${REVIEWED_REPORT_SHA256}`,
    `--expected-candidate-count=${REVIEWED_CANDIDATE_COUNT}`,
  ]);
  assert.equal(resolveReviewedExpectation(args).sha256, REVIEWED_REPORT_SHA256);
  assert.throws(
    () => resolveReviewedExpectation(parseApplyArgs(["--report=/tmp/report.json"])),
    /must be supplied explicitly/
  );
  assert.throws(
    () => parseApplyArgs(["--report=/tmp/report.json", "--expected-candidate-count=116.5"]),
    /positive safe integer/
  );
});

test("report validation accepts only a positive fractional restoration within one metre", () => {
  const validated = validateElevationFractionReport(report(), sha256, {
    sha256,
    candidateCount: 1,
    destinationCount: 1,
  });
  assert.equal(validated[0].expectedElevationM, 1451);
  assert.equal(validated[0].proposedElevationM, 1451.5);
  assert.equal(validated[0].externalId, "356546696");

  for (const proposedElevationM of [1450.9, 1451, 1452, 1452.1, Number.NaN]) {
    const changed = candidate({ proposedElevationM });
    assert.throws(
      () => validateElevationFractionReport(report(changed), sha256, {
        sha256,
        candidateCount: 1,
        destinationCount: 1,
      }),
      /candidate\[0\]/
    );
  }
});

test("report validation requires exact identity and preexisting direct-metre proof", () => {
  const badIdentity = candidate({
    identity: {
      osm: {
        references: [{
          key: "osm",
          id: "356546696",
          elementType: "node",
          status: "valid",
          reason: "exact_osm_id_and_coordinate_match",
          distanceM: 100.01,
        }],
      },
    },
  });
  assert.throws(
    () => validateElevationFractionReport(report(badIdentity), sha256, {
      sha256,
      candidateCount: 1,
      destinationCount: 1,
    }),
    /farther than 100 metres/
  );

  const base = candidate();
  const badTiming = candidate({
    provenanceTiming: {
      ...(base.provenanceTiming as Record<string, unknown>),
      status: "later",
    },
  });
  assert.throws(
    () => validateElevationFractionReport(report(badTiming), sha256, {
      sha256,
      candidateCount: 1,
      destinationCount: 1,
    }),
    /no preexisting exact-source proof/
  );
});

test("guarded SQL locks rows, preserves XY, updates scalar and PointZ, and records provenance", () => {
  assert.match(LIVE_ROWS_FOR_UPDATE_SQL, /FOR UPDATE OF d/);
  assert.match(UPDATE_SQL, /SET elevation = incoming\.proposed_elevation_m/);
  assert.match(UPDATE_SQL, /ST_MakePoint\([\s\S]*ST_X\(d\.location::geometry\)[\s\S]*ST_Y\(d\.location::geometry\)/);
  assert.match(UPDATE_SQL, /incoming\.proposed_elevation_m - d\.elevation < 1/);
  assert.match(UPDATE_SQL, /trunc\(incoming\.proposed_elevation_m\) = d\.elevation/);
  assert.match(UPDATE_SQL, /incoming\.proposed_elevation_m <> trunc/);
  assert.match(UPDATE_SQL, /proof_timestamp <= incoming\.provenance_cutoff_at/);
  assert.match(UPDATE_SQL, new RegExp(REPAIR_METADATA_KEY));
  assert.match(UPDATE_SQL, /auditReportSha256/);
});

test("catalog repair uses the normal candidate fingerprint and only queues affected jobs", () => {
  assert.match(FINGERPRINT_IMPACT_SQL, /affected_catalog_destinations/);
  assert.match(CATALOG_SCOPE_SQL, /JOIN changed ON changed\.destination_id/);
  assert.match(LOCK_AFFECTED_CATALOG_JOBS_SQL, /JOIN reviewed ON reviewed\.destination_id/);
  assert.match(TARGETED_CATALOG_SEED_SQL, /JOIN reviewed ON reviewed\.destination_id/);
  assert.doesNotMatch(TARGETED_CATALOG_SEED_SQL, /JOIN affected ON affected\.destination_id/);
  assert.match(TARGETED_CATALOG_SEED_SQL, /INSERT INTO route_catalog_audit_jobs/);
  assert.match(TARGETED_CATALOG_SEED_SQL, /d\.updated_at::text/);
  assert.match(TARGETED_CATALOG_SEED_SQL, /linked_destination\.updated_at::text/);
  assert.doesNotMatch(TARGETED_CATALOG_SEED_SQL, /state = 'out_of_scope'/);
});

test("catalog repair pins the exact reviewed 115-ID set and rejects a 116th job", () => {
  validateReviewedCatalogManifest();
  assert.equal(REVIEWED_CATALOG_DESTINATION_IDS.length, REVIEWED_CATALOG_DESTINATION_COUNT);
  assert.equal(
    catalogDestinationSetSha256(REVIEWED_CATALOG_DESTINATION_IDS),
    REVIEWED_CATALOG_DESTINATION_SET_SHA256
  );
  const rows = REVIEWED_CATALOG_DESTINATION_IDS.map((destinationId) => ({
    destination_id: destinationId,
    destination_name: `Destination ${destinationId}`,
    state: "queued",
    priority: 1,
    route_count: 1,
    audit_rule_version: 3,
    catalog_fingerprint: "fingerprint",
    attempt_count: 0,
    lease_owner: null,
    lease_token: null,
    lease_expires_at: null,
    last_error: null,
    final_result_text: null,
    audited_at: null,
  }));
  assert.equal(validateCatalogScopeRows(rows, false).destinationCount, 115);
  assert.throws(
    () => validateCatalogScopeRows([
      ...rows,
      { ...rows[0], destination_id: "unreviewed-116th-destination" },
    ], false),
    /not the reviewed 115-ID set/
  );
});

test("apply requires the marked XY-only session trigger and session hashes stay fixed", () => {
  assert.match(DESTINATION_UPDATE_TRIGGER_GUARD_SQL, /pg_get_functiondef/);
  assert.match(DESTINATION_UPDATE_TRIGGER_GUARD_SQL, /trg_destination_update_link_sessions/);
  assert.match(SESSION_TRACKING_INVARIANT_SQL, /FROM session_destinations/);
  assert.match(SESSION_TRACKING_INVARIANT_SQL, /FROM tracking_sessions/);
  assert.match(SESSION_TRACKING_INVARIANT_SQL, /FROM tracking_points/);
  const guard = destinationUpdateTriggerGuard({
    function_exists: true,
    function_comment: "peaks:destination-session-link-update:xy-only-with-rejection-v1",
    function_definition: `
      -- peaks_destination_session_link_xy_guard_v1
      (OLD.location IS NULL) IS DISTINCT FROM (NEW.location IS NULL)
      ST_X(OLD.location::geometry) IS DISTINCT FROM ST_X(NEW.location::geometry)
      ST_Y(OLD.location::geometry) IS DISTINCT FROM ST_Y(NEW.location::geometry)
      FROM session_destination_rejections r
      r.session_id = tp.session_id AND r.destination_id = NEW.id
      FROM session_destination_rejections r
    `,
    function_definition_md5: "a".repeat(32),
    trigger_count: 1,
    enabled_trigger_count: 1,
    trigger_definition: "CREATE TRIGGER trg_destination_update_link_sessions AFTER UPDATE OF boundary, location ON public.destinations FOR EACH ROW EXECUTE FUNCTION link_sessions_on_destination_update()",
  });
  assertDestinationUpdateTriggerGuard(guard);
  assert.throws(
    () => assertDestinationUpdateTriggerGuard({ ...guard, safe: false }),
    /lacks the reviewed XY-only/
  );

  const invariant = sessionTrackingInvariant({
    session_destinations_count: 2,
    session_destinations_hash: "a".repeat(32),
    session_destination_rejections_count: 1,
    session_destination_rejections_hash: "b".repeat(32),
    destination_areas_count: 3,
    destination_areas_hash: "c".repeat(32),
    relevant_tracking_sessions_count: 4,
    relevant_tracking_sessions_hash: "d".repeat(32),
    relevant_tracking_points_count: 5,
    relevant_tracking_points_hash: "e".repeat(32),
  });
  assertSessionTrackingInvariantUnchanged(invariant, { ...invariant });
  assert.throws(
    () => assertSessionTrackingInvariantUnchanged(
      invariant,
      { ...invariant, sessionDestinationsCount: 3 }
    ),
    /changed during elevation repair/
  );
});

test("route vertex audit finds importer-pinned route and segment elevations", () => {
  assert.match(ROUTE_VERTEX_IMPACT_SQL, /ST_DumpPoints\(linked\.path::geometry\)/);
  assert.match(ROUTE_VERTEX_IMPACT_SQL, /vertex_distance_m <= 20/);
  assert.match(ROUTE_VERTEX_IMPACT_SQL, /vertex_z = expected_elevation_m/);
  assert.match(ROUTE_VERTEX_IMPACT_SQL, /JOIN route_segments/);
  const impact = routeVertexImpact({
    linked_peaks_routes: 26,
    pinned_routes: 2,
    pinned_active_routes: 2,
    pinned_pending_routes: 0,
    route_destination_pins: 2,
    pinned_segments: 2,
    route_segment_pins: 2,
    route_pins: [{ routeId: "route-1" }],
    segment_pins: [{ segmentId: "segment-1" }],
  });
  assert.equal(impact.importerPinnedSummitContractApplies, true);
  assert.equal(impact.normalWorkflowRepair, "guarded_exact_vertex_update");
});

test("reviewed summit path repair changes one exact vertex by only the destination fraction", () => {
  assert.equal(REVIEWED_PATH_REPAIRS.length, 2);
  for (const repair of REVIEWED_PATH_REPAIRS) {
    assert.equal(repair.vertexIndex, repair.pointCount);
    assert.notEqual(repair.oldPathHash, repair.newPathHash);
    assert.match(repair.xyHash, /^[0-9a-f]{32}$/);
    assert.match(repair.otherPointsHash, /^[0-9a-f]{32}$/);
  }
  for (const sql of [UPDATE_REVIEWED_ROUTE_VERTICES_SQL, UPDATE_REVIEWED_SEGMENT_VERTICES_SQL]) {
    assert.match(sql, /ST_SetPoint/);
    assert.match(sql, /repair\.vertex_index - 1/);
    assert.match(sql, /repair\.proposed_elevation_m - repair\.expected_elevation_m = repair\.delta_m/);
    assert.match(sql, /repair\.delta_m > 0 AND repair\.delta_m < 1/);
    assert.match(sql, /trunc\(repair\.proposed_elevation_m\) = repair\.expected_elevation_m/);
    assert.match(sql, /SELECT count\(\*\)[\s\S]*= 1/);
    assert.match(sql, /other_points_hash/);
    assert.match(sql, /new_path_hash/);
    assert.match(sql, /xy_hash/);
  }
  assert.match(UPDATE_REVIEWED_ROUTE_VERTICES_SQL, /encode_route_elevation_profile/);
  assert.match(UPDATE_REVIEWED_ROUTE_VERTICES_SQL, /route_elevation_stats/);
  assert.match(UPDATE_REVIEWED_SEGMENT_VERTICES_SQL, /route_elevation_stats/);
});

test("path changes reconcile only the exact route and standard job evidence", () => {
  assert.match(RECONCILE_ROUTE_ELEVATION_JOBS_SQL, /path_fingerprint = current_fingerprint\.path_fingerprint/);
  assert.match(RECONCILE_ROUTE_ELEVATION_JOBS_SQL, /state = 'queued'/);
  assert.match(RECONCILE_ROUTE_ELEVATION_JOBS_SQL, /final_evidence = NULL/);
  assert.match(RECONCILE_STANDARD_ROUTE_JOBS_SQL, /destination_elevation_fraction_repair/);
  assert.match(RECONCILE_STANDARD_ROUTE_JOBS_SQL, /job\.state = repair\.expected_standard_job_state/);
  assert.doesNotMatch(RECONCILE_STANDARD_ROUTE_JOBS_SQL, /SET state =/);
});

test("postflight hashes reject any other point or field change", () => {
  const rows = REVIEWED_PATH_REPAIRS.map((repair) => ({
    destination_id: repair.destinationId,
    route_id: repair.routeId,
    segment_id: repair.segmentId,
    route_path_hash: repair.newPathHash,
    segment_path_hash: repair.newPathHash,
    route_xy_hash: repair.xyHash,
    segment_xy_hash: repair.xyHash,
    route_other_points_hash: repair.otherPointsHash,
    segment_other_points_hash: repair.otherPointsHash,
    route_other_fields_hash: repair.routeOtherFieldsHash,
    segment_other_fields_hash: repair.segmentOtherFieldsHash,
    route_point_count: repair.pointCount,
    segment_point_count: repair.pointCount,
    route_old_matches: 0,
    segment_old_matches: 0,
    route_new_matches: 1,
    segment_new_matches: 1,
    route_gain: repair.expectedNewGainM,
    route_loss: repair.expectedNewLossM,
    segment_gain: repair.expectedNewGainM,
    segment_loss: repair.expectedNewLossM,
    computed_route_gain: repair.expectedNewGainM,
    computed_route_loss: repair.expectedNewLossM,
    computed_segment_gain: repair.expectedNewGainM,
    computed_segment_loss: repair.expectedNewLossM,
    route_profile_canonical: true,
    route_profile_hash: repair.expectedNewProfileHash,
    segment_consumer_route_ids: [repair.routeId],
    route_job_state: "queued",
    route_job_fingerprint: `new-${repair.routeId}`,
    route_job_final_evidence: null,
    route_job_lease_expires_at: null,
    standard_job_state: repair.expectedStandardJobState,
    standard_job_evidence: {
      destination_elevation_fraction_repair: {
        auditReportSha256: REVIEWED_REPORT_SHA256,
        pathHash: repair.newPathHash,
      },
    },
    standard_job_review: {},
    standard_job_candidate_sha256: null,
    standard_job_candidate_artifact_is_null: true,
    standard_job_candidate_path_is_null: true,
    standard_job_has_lease: false,
    standard_job_lease_expires_at: null,
    current_route_fingerprint: `new-${repair.routeId}`,
  }));
  validatePathRepairAudit(rows, "after");
  assert.throws(
    () => validatePathRepairAudit([
      { ...rows[0], route_other_points_hash: "0".repeat(32) },
      rows[1],
    ], "after"),
    /changed a non-summit point/
  );
  assert.throws(
    () => validatePathRepairAudit([
      { ...rows[0], segment_other_fields_hash: "0".repeat(32) },
      rows[1],
    ], "after"),
    /changed a field outside the reviewed set/
  );
});

test("apply path uses a serializable transaction, advisory lock, and exact row counts", async () => {
  const source = await readFile(
    join(__dirname, "../apply-destination-elevation-fractions.ts"),
    "utf8"
  );
  assert.match(source, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /updated\.rowCount !== REVIEWED_CANDIDATE_COUNT/);
  assert.match(source, /postUpdate\.rowCount !== REVIEWED_CANDIDATE_COUNT/);
  assert.match(source, /ROLLBACK/);
});
