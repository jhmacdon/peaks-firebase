import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(__dirname, "../../../..");
const importerPath = join(
  repoRoot,
  ".claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts"
);
const importWrapperPath = join(
  repoRoot,
  ".agents/skills/peaks-route-factory/scripts/import_route_candidate.sh"
);
const routeJobsWrapperPath = join(
  repoRoot,
  ".agents/skills/peaks-route-factory/scripts/route_jobs.sh"
);
const claimRolePath = join(
  repoRoot,
  ".agents/skills/peaks-route-factory/scripts/route_job_claim_role.sh"
);
const routeDatabaseWrapperPath = join(
  repoRoot,
  ".agents/skills/peaks-route-factory/scripts/with_route_db.sh"
);
const jobsPath = join(__dirname, "../standard-route-jobs.ts");
const routeActionsPath = join(repoRoot, "web/src/lib/actions/routes.ts");
const publisherPath = join(
  repoRoot,
  ".claude/skills/peaks-standard-route-backfill/scripts/accept_pending_route_with_segments.mts"
);
const usgsCheckerPath = join(
  repoRoot,
  ".claude/skills/peaks-osm-route-approval/scripts/check_pending_usgs_routes.mts"
);
const usgsBuilderPath = join(
  repoRoot,
  ".claude/skills/peaks-standard-route-backfill/scripts/build_usgs_route_candidate.mts"
);
const osmBuilderPath = join(
  repoRoot,
  ".claude/skills/peaks-standard-route-backfill/scripts/build_osm_route_candidate.mts"
);
const stageCommandsPath = join(
  repoRoot,
  ".agents/skills/peaks-route-factory/references/stage-commands.md"
);
const workerContractPath = join(
  repoRoot,
  ".agents/skills/peaks-route-factory/references/worker-contract.md"
);

const importer = readFileSync(importerPath, "utf8");
const importWrapper = readFileSync(importWrapperPath, "utf8");
const routeJobsWrapper = readFileSync(routeJobsWrapperPath, "utf8");
const claimRole = readFileSync(claimRolePath, "utf8");
const routeDatabaseWrapper = readFileSync(routeDatabaseWrapperPath, "utf8");
const jobs = readFileSync(jobsPath, "utf8");
const routeActions = readFileSync(routeActionsPath, "utf8");
const publisher = readFileSync(publisherPath, "utf8");
const usgsChecker = readFileSync(usgsCheckerPath, "utf8");
const usgsBuilder = readFileSync(usgsBuilderPath, "utf8");
const osmBuilder = readFileSync(osmBuilderPath, "utf8");
const stageCommands = readFileSync(stageCommandsPath, "utf8");
const workerContract = readFileSync(workerContractPath, "utf8");

test("USGS rights and dateline terrain tiles fail closed", () => {
  assert.match(importer, /buildUsgsTrailAttribution\(originators\)/);
  assert.match(importer, /usgs_object_ids do not match the canonical source URL/);
  assert.match(importer, /worldTilePixel/);
  assert.match(usgsBuilder, /USGS_TRAILS_LICENSE_URL/);
  assert.doesNotMatch(usgsBuilder, /\$\{LICENSE_URL\}/);
  assert.match(
    usgsChecker,
    /provenance\.license_url !== USGS_TRAILS_LICENSE_URL/
  );
  assert.match(
    usgsChecker,
    /provenance\?\.attribution !== source\.attribution/
  );
});

test("candidate builders and importer share strict connector limits", () => {
  assert.match(osmBuilder, /const ENDPOINT_CONNECTOR_MAX_M = 125/);
  assert.match(osmBuilder, /snapM: ENDPOINT_CONNECTOR_MAX_M/);
  assert.match(osmBuilder, /options\.snapM > ENDPOINT_CONNECTOR_MAX_M/);
  assert.match(
    osmBuilder,
    /ensureMinimumRouteCoordinates\(rawCoordinates, 5\)/
  );

  assert.match(usgsBuilder, /const ENDPOINT_CONNECTOR_MAX_M = 125/);
  assert.match(usgsBuilder, /const SOURCE_JOIN_MAX_M = 5/);
  assert.match(usgsBuilder, /distanceM > SOURCE_JOIN_MAX_M/);
  assert.match(
    usgsBuilder,
    /trailheadDistanceM <= ENDPOINT_CONNECTOR_MAX_M/
  );
  assert.match(usgsBuilder, /summitDistanceM <= ENDPOINT_CONNECTOR_MAX_M/);
  assert.match(
    usgsBuilder,
    /ensureMinimumRouteCoordinates\(assembledCoordinates, 5\)/
  );

  assert.match(importer, /const ENDPOINT_CONNECTOR_MAX_M = 125/);
  assert.match(
    importer,
    /trailheadSnapM > ENDPOINT_CONNECTOR_MAX_M[\s\S]*summitSnapM > ENDPOINT_CONNECTOR_MAX_M/
  );
  assert.match(stageCommands, /--snap-m 125/);
  assert.match(stageCommands, /separate source lines only when their endpoints are within 5 m/);
  assert.match(workerContract, /joins between separate USGS source lines no longer than 5 m/);

  const oversizedOsmSnap = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      osmBuilderPath,
      "--destination-id",
      "destination",
      "--trailhead-id",
      "trailhead",
      "--way-ids",
      "1",
      "--snap-m",
      "126",
      "--format",
      "summary",
    ],
    {
      cwd: join(repoRoot, "cloud-sql/migrate"),
      encoding: "utf8",
    }
  );
  assert.equal(oversizedOsmSnap.status, 1, oversizedOsmSnap.stderr);
  assert.match(
    oversizedOsmSnap.stderr,
    /--snap-m must be an integer from 10 to 125/
  );
});

test("factory import wrapper rejects caller-chosen replacement and unknown flags", () => {
  for (const [flag, message] of [
    ["--upgrade-active-route", "forbidden in the route factory"],
    ["--replace-active-route", "derived from the leased queue job"],
    ["--replace-pending-route", "derived from the leased queue job"],
    ["--unreviewed-option", "unsupported route-factory import flag"],
  ]) {
    const result = spawnSync(importWrapperPath, [flag, "route-id"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, new RegExp(message));
  }
  assert.match(importWrapper, /--destination-id is required/);
  assert.match(importWrapper, /--lease-token is required/);
  assert.match(importWrapper, /source_url_count < 1 \|\| source_url_count > 4/);
});

test("factory artifacts are bound to destination, lease, checkout, and stage", () => {
  assert.match(
    importWrapper,
    /"\$\{destination_id\}-\$\{lease_token\}\.geojson"/
  );
  assert.match(
    importWrapper,
    /"\$\{destination_id\}-\$\{lease_token\}-import\.json"/
  );
  assert.match(importWrapper, /this checkout's worker-artifacts directory/);
  assert.match(importWrapper, /check-import-lease/);

  assert.match(routeJobsWrapper, /"\$\{destination_id\}-\$\{lease_token\}\.geojson"/);
  assert.match(routeJobsWrapper, /"\$\{destination_id\}-\$\{lease_token\}-candidate\.json"/);
  assert.match(routeJobsWrapper, /approved\) result_suffix="review"/);
  assert.match(routeJobsWrapper, /needs_revision\)[\s\S]*route-review[\s\S]*result_suffix="review"/);
  assert.match(routeJobsWrapper, /"\$\{destination_id\}-\$\{lease_token\}-\$\{result_suffix\}\.json"/);
  assert.match(routeJobsWrapper, /"\$\{destination_id\}-\$\{lease_token\}-review-packet\.json"/);
  assert.match(routeJobsWrapper, /"\$\{destination_id\}-\$\{lease_token\}-source-check\.json"/);
});

test("worker wrappers split factory and reviewer claim roles", () => {
  assert.match(routeJobsWrapper, /source "\$script_dir\/route_job_claim_role\.sh"/);
  assert.match(
    routeJobsWrapper,
    /route_job_validate_claim_stage "\$checkout_kind" "\$\{args\[@\]\}"/
  );
  assert.match(claimRole, /route-review\)[\s\S]*stage" != "review"/);
  assert.match(
    claimRole,
    /route-factory\|route-factory-02\|route-factory-03\|route-factory-04\|route-repair\|canonical/
  );
  assert.match(claimRole, /factory\|research\|import\|publish\|verify/);
  assert.doesNotMatch(claimRole, /factory\|research\|import\|review/);
  assert.match(
    routeDatabaseWrapper,
    /route-factory\|route-factory-02\|route-factory-03\|route-factory-04\|route-repair\)[\s\S]*credential_profile="factory"[\s\S]*peaks-route-factory-worker/
  );
  assert.match(
    routeDatabaseWrapper,
    /route-review\)[\s\S]*credential_profile="reviewer"[\s\S]*peaks-route-reviewer-worker/
  );
  assert.match(
    routeDatabaseWrapper,
    /\*\)[\s\S]*credential_profile="operator"/
  );
  assert.match(
    routeDatabaseWrapper,
    /factory:"\$repo_root\/\.claude\/skills\/peaks-standard-route-backfill\/scripts\/import_standard_route_from_osm_candidate\.mts"/
  );
  for (const checker of ["osm", "usgs", "official"]) {
    assert.match(
      routeDatabaseWrapper,
      new RegExp(
        `reviewer:"\\$repo_root/\\.claude/skills/peaks-osm-route-approval/` +
          `scripts/check_pending_${checker}_routes\\.mts"`
      )
    );
  }
  assert.doesNotMatch(
    routeDatabaseWrapper,
    /reviewer:"\$repo_root\/\.claude\/skills\/peaks-standard-route-backfill/
  );
  assert.doesNotMatch(
    routeDatabaseWrapper,
    /factory:"\$repo_root\/\.claude\/skills\/peaks-osm-route-approval/
  );
  assert.match(
    routeDatabaseWrapper,
    /Worker database wrapper rejected an unapproved (?:command|script)/
  );
  assert.match(jobs, /assertWorkerCanClaimStage\(workerId, stage\)/);
  assert.match(jobs, /reviewerLeaseOwnerForTransition\(/);
  assert.match(jobs, /reviewer: reviewerLeaseOwner/);
  assert.match(
    jobs,
    /result\.rows\.map\(\(\{ lease_token: _leaseToken, \.\.\.job \}\) => job\)/
  );
});

test("pending route creation and durable review binding share one commit", () => {
  const createStart = importer.indexOf("async function createPendingRoute(");
  const createEnd = importer.indexOf("async function upgradeActiveRoute(", createStart);
  const create = importer.slice(createStart, createEnd);
  const begin = create.indexOf('client.query("BEGIN ISOLATION LEVEL SERIALIZABLE")');
  const lock = create.indexOf("factoryImportContext(", begin);
  const insert = create.indexOf("`INSERT INTO routes", lock);
  const bind = create.lastIndexOf("bindFactoryPendingRoute(");
  const commit = create.lastIndexOf('client.query("COMMIT")');
  assert.ok(begin >= 0 && begin < lock && lock < insert && insert < bind && bind < commit);
  assert.match(create, /factoryImportContext\([\s\S]*true/);
  assert.match(create, /exactExisting[\s\S]*bindFactoryPendingRoute[\s\S]*COMMIT/);

  const bindStart = importer.indexOf("async function bindFactoryPendingRoute(");
  const bindEnd = importer.indexOf("async function createPendingRoute(", bindStart);
  const binding = importer.slice(bindStart, bindEnd);
  assert.match(binding, /assertPendingRouteMatchesCandidate/);
  assert.match(binding, /SET state = 'pending_review'/);
  assert.match(binding, /published_route_id = \$4/);
  assert.match(binding, /lease_expires_at >= clock_timestamp\(\)/);
  assert.match(binding, /lease_token = NULL/);
  assert.match(jobs, /rejectSplitImportTransition\(to\)/);
});

test("approval and activation rebind the live route to the reviewed candidate", () => {
  const approvalStart = jobs.indexOf("verifyRouteReviewAttestation({");
  const approvalEnd = jobs.indexOf('if (to === "verified")', approvalStart);
  const approval = jobs.slice(approvalStart, approvalEnd);
  assert.match(approval, /assertPendingRouteMatchesCandidate\(/);
  assert.match(approval, /approved_route_binding: approvedRouteBinding/);

  const publicationStart = jobs.indexOf('if (to === "published")');
  const publicationEnd = jobs.indexOf(
    'if (\n      to === "pending_review"',
    publicationStart
  );
  const publication = jobs.slice(publicationStart, publicationEnd);
  assert.match(publication, /assertPendingRouteMatchesCandidate\(/);

  const activationStart = routeActions.indexOf(
    "async function lockRouteFactoryActivation("
  );
  const activationEnd = routeActions.indexOf(
    "async function lockRouteReplacementSettlement(",
    activationStart
  );
  const activation = routeActions.slice(activationStart, activationEnd);
  assert.match(activation, /approved_route_binding,routeName/);
  assert.match(activation, /approved_route_binding,destinations/);
  assert.match(activation, /approved_route_binding,geometrySource/);
  assert.match(activation, /approved_route_binding,geometry/);
  assert.match(activation, /FOR UPDATE OF job, r/);
  assert.match(activation, /FOR UPDATE OF rd, d/);
  assert.match(activation, /candidate_binding_matches !== true/);
  assert.match(activation, /Approved route destinations changed after review/);
});

test("the queue publisher uses its bound lease for analysis and activation", () => {
  assert.match(
    publisher,
    /analyzePendingRoute\(\s*leaseToken,\s*routeId,\s*factoryActivation\s*\)/
  );
  assert.match(
    publisher,
    /acceptRouteWithSegments\(\s*leaseToken,\s*routeId,\s*factoryActivation\s*\)/
  );
  assert.match(routeActions, /token !== activation\.leaseToken/);
  assert.match(routeActions, /lease_expires_at >= clock_timestamp\(\)/);
  assert.match(
    routeActions,
    /analyzePendingRouteUnchecked\(id\)[\s\S]*factoryActivation[\s\S]*decomposition\.splits\.length > 0[\s\S]*decomposition\.affectedRoutes\.length > 0[\s\S]*Shared-segment changes require human web-admin review/
  );
});

test("discovery cutover preserves any pending route with outside references", () => {
  const cutoverStart = jobs.indexOf("async function cutoverDiscoveryChecks(");
  const cutoverEnd = jobs.indexOf("async function recoverLegacy(", cutoverStart);
  const cutover = jobs.slice(cutoverStart, cutoverEnd);
  for (const table of [
    "route_areas",
    "plan_routes",
    "session_routes",
    "trip_report_routes",
    "route_elevation_backfill_jobs",
    "route_integrity_repairs",
    "standard_route_backfill_jobs",
  ]) {
    assert.match(cutover, new RegExp(`FROM ${table}`));
  }
  assert.match(cutover, /external_reference_count !== 0/);
  assert.match(
    cutover,
    /SELECT id FROM routes WHERE id = \$1 FOR UPDATE[\s\S]*external_reference_count/
  );
  assert.match(
    cutover,
    /assertPendingRouteMatchesCandidate[\s\S]*DELETE FROM routes/
  );
  assert.match(jobs, /discovery_cutover_unbound_pending_route/);
});

test("candidate gate caps sources and rejects relabeled or weak-only evidence", () => {
  assert.match(jobs, /result\.identity_sources\.length > 4/);
  assert.match(jobs, /validateRouteIdentitySource\(source, index\)/);
  assert.match(jobs, /isStrongRouteIdentitySource\(source\.type\)/);
  assert.match(jobs, /strong identity source beyond AllTrails and Peakbagger/);
  assert.match(jobs, /geometry\.license !== "ODbL 1\.0"/);
  assert.match(jobs, /geometry\.license !== "Public domain"/);
  assert.match(jobs, /access-controlled or disputed candidates require two strong/);
  assert.match(
    jobs,
    /validateRouteAccessSource\([\s\S]*?access\.source_url,[\s\S]*?identitySources[\s\S]*?\)/
  );
  assert.match(jobs, /resultJson = validateTransitionPayload\(/);
  assert.match(jobs, /comparison\.max_offset_m > 1_000_000/);
});

test("seed UPSERT integrity-repair branches always include THEN", () => {
  assert.doesNotMatch(
    jobs,
    /WHEN EXCLUDED\.target_reasons ->> 'integrity_repair' = 'true'\s+WHEN/
  );
});

test("queue completion comes from the live target set and valid active routes", () => {
  assert.match(jobs, /FROM incoming\s+LEFT JOIN standard_route_backfill_jobs jobs/);
  assert.match(jobs, /COALESCE\(state, 'unseeded'\)/);
  assert.match(jobs, /jobs\.state = 'verified'[\s\S]*peaks_route_passes_publish_integrity\(/);
  assert.match(jobs, /AS invalid_verified/);
  assert.match(jobs, /listed_destination_missing_summit_feature/);
  assert.match(jobs, /WHEN NOT t\.summit_feature_valid THEN 'needs_human'/);
});
