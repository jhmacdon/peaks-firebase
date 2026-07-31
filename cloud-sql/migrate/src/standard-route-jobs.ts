#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import db from "./db";
import { verifyStandardRoute } from "./standard-route-verification";
import {
  BLOCKED_STATES,
  canTransition,
  canonicalJson,
  claimRankSql,
  isJobState,
  JobStage,
  JobState,
  stageForState,
  statesForStage,
} from "./standard-route-job-state";

type JsonObject = Record<string, unknown>;
const execFileAsync = promisify(execFile);

interface JobRow {
  destination_id: string;
  destination_name: string;
  country_code: string | null;
  state_code: string | null;
  lat: number | null;
  lng: number | null;
  state: JobState;
  priority: number;
  target_reasons: JsonObject;
  evidence: JsonObject;
  candidate: JsonObject;
  review: JsonObject;
  trailhead_id: string | null;
  candidate_path: string | null;
  candidate_sha256: string | null;
  published_route_id: string | null;
  blocker_code: string | null;
  blocker_message: string | null;
  attempt_count: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  updated_at: string;
}

function usage(exitCode = 2): never {
  console.error(`Usage:
  npm run routes:jobs -- seed [--apply] [--popularity-threshold 25]
  npm run routes:jobs -- claim --worker-id ID [--stage next] [--lease-minutes 90] [--apply]
  npm run routes:jobs -- materialize --destination-id ID --lease-token TOKEN --output FILE
  npm run routes:jobs -- heartbeat --lease-token TOKEN [--lease-minutes 90]
  npm run routes:jobs -- transition --destination-id ID --lease-token TOKEN --to STATE
      [--artifact-path FILE] [--route-id ID] [--result-file FILE]
      [--blocker-code CODE] [--message TEXT] [--retry-minutes N] --apply
  npm run routes:jobs -- release --lease-token TOKEN [--message TEXT] [--retry-minutes N]
  npm run routes:jobs -- requeue --destination-id ID --from STATE --reason TEXT
      --acknowledge-human-review --apply
  npm run routes:jobs -- show [--destination-id ID] [--state STATE] [--limit 20]
  npm run routes:jobs -- stats

Dry run is the default for seed and claim. Transitions require --apply.
All output is compact JSON so a worker can resume without rereading raw sources.`);
  process.exit(exitCode);
}

function flagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function positiveInteger(
  argv: string[],
  flag: string,
  fallback: number,
  maximum = 10_000
): number {
  const raw = flagValue(argv, flag);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${flag} must be an integer from 1 through ${maximum}`);
  }
  return value;
}

function print(value: unknown): void {
  console.log(JSON.stringify(value));
}

function requireId(argv: string[], flag: string): string {
  const value = flagValue(argv, flag);
  if (!value || !/^[A-Za-z0-9_.:@/-]+$/.test(value)) {
    throw new Error(`${flag} is required and contains unsupported characters`);
  }
  return value;
}

function parseStage(argv: string[]): JobStage {
  const value = flagValue(argv, "--stage") ?? "next";
  if (
    value !== "next" &&
    value !== "research" &&
    value !== "import" &&
    value !== "review" &&
    value !== "publish" &&
    value !== "verify"
  ) {
    throw new Error(
      "--stage must be next, research, import, review, publish, or verify"
    );
  }
  return value;
}

async function readResult(argv: string[]): Promise<JsonObject> {
  const file = flagValue(argv, "--result-file");
  if (!file) return {};
  const parsed = JSON.parse(await fs.readFile(path.resolve(file), "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--result-file must contain one JSON object");
  }
  return parsed as JsonObject;
}

const targetSql = `
WITH destination_popularity AS (
  SELECT d.id,
         d.session_count_offset + COUNT(sd.session_id) AS session_count,
         d.success_count_offset
           + COUNT(sd.session_id) FILTER (WHERE sd.relation = 'reached')
           AS success_count
  FROM destinations d
  LEFT JOIN session_destinations sd ON sd.destination_id = d.id
  WHERE 'summit'::destination_feature = ANY(d.features)
  GROUP BY d.id
),
target_reasons AS (
  SELECT d.id,
         p.session_count,
         p.success_count,
         d.prominence >= 1500 AS is_ultra_prominent,
         COALESCE(
           BOOL_OR(
             l.owner = 'peaks'
             AND (
               l.name ILIKE 'Ultras %'
               OR l.name IN (
                 'Colorado 14ers',
                 'Smoot''s 100',
                 'Washington Home Court 100'
               )
             )
           ),
           false
         ) AS is_target_list,
         p.session_count >= $1::integer AS is_high_popularity,
         COALESCE(
           ARRAY_AGG(DISTINCT l.name ORDER BY l.name)
             FILTER (
               WHERE l.owner = 'peaks'
                 AND (
                   l.name ILIKE 'Ultras %'
                   OR l.name IN (
                     'Colorado 14ers',
                     'Smoot''s 100',
                     'Washington Home Court 100'
                   )
                 )
             ),
           '{}'
         ) AS list_names
  FROM destinations d
  JOIN destination_popularity p ON p.id = d.id
  LEFT JOIN list_destinations ld ON ld.destination_id = d.id
  LEFT JOIN lists l ON l.id = ld.list_id
  WHERE 'summit'::destination_feature = ANY(d.features)
  GROUP BY d.id, p.session_count, p.success_count
),
targets AS (
  SELECT tr.*,
         (
           CASE WHEN tr.is_target_list THEN 30000 ELSE 0 END
           + CASE WHEN tr.is_high_popularity THEN 20000 ELSE 0 END
           + CASE WHEN tr.is_ultra_prominent THEN 10000 ELSE 0 END
           + LEAST(tr.session_count, 9999)
         )::integer AS priority
  FROM target_reasons tr
  WHERE tr.is_ultra_prominent
     OR tr.is_target_list
     OR tr.is_high_popularity
),
active_routes AS (
  SELECT DISTINCT ON (rd.destination_id)
         rd.destination_id,
         r.id AS route_id,
         (
           SELECT first_rd.destination_id
           FROM route_destinations first_rd
           JOIN destinations first_destination
             ON first_destination.id = first_rd.destination_id
           WHERE first_rd.route_id = r.id
             AND 'trailhead'::destination_feature =
                 ANY(first_destination.features)
           ORDER BY first_rd.ordinal
           LIMIT 1
         ) AS trailhead_id
  FROM route_destinations rd
  JOIN routes r ON r.id = rd.route_id
  JOIN targets t ON t.id = rd.destination_id
  WHERE r.owner = 'peaks' AND r.status = 'active'
  ORDER BY rd.destination_id, r.created_at, r.id
),
incoming AS (
  SELECT t.id AS destination_id,
         CASE WHEN ar.route_id IS NULL THEN 'queued' ELSE 'published' END AS state,
         t.priority,
         jsonb_build_object(
           'ultra_prominent', t.is_ultra_prominent,
           'target_list', t.is_target_list,
           'high_popularity', t.is_high_popularity,
           'list_names', t.list_names,
           'session_count', t.session_count,
           'success_count', t.success_count,
           'popularity_threshold', $1::integer
         ) AS target_reasons,
         ar.route_id,
         ar.trailhead_id
  FROM targets t
  LEFT JOIN active_routes ar ON ar.destination_id = t.id
)
`;

async function seed(argv: string[]): Promise<void> {
  const apply = argv.includes("--apply");
  const threshold = positiveInteger(argv, "--popularity-threshold", 25);

  if (!apply) {
    const result = await db.query<{
      targets: number;
      active: number;
      missing: number;
    }>(
      `${targetSql}
       SELECT COUNT(*)::int AS targets,
              COUNT(*) FILTER (WHERE state = 'published')::int AS active,
              COUNT(*) FILTER (WHERE state <> 'published')::int AS missing
       FROM incoming`,
      [threshold]
    );
    print({ mode: "dry_run", popularity_threshold: threshold, ...result.rows[0] });
    return;
  }

  await db.query(
    `${targetSql}
     INSERT INTO standard_route_backfill_jobs (
       destination_id,
       state,
       priority,
       target_reasons,
       trailhead_id,
       published_route_id,
       blocker_code,
       blocker_message,
       updated_at
     )
     SELECT destination_id,
            state,
            priority,
            target_reasons,
            trailhead_id,
            route_id,
            NULL,
            NULL,
            now()
     FROM incoming
     ON CONFLICT (destination_id) DO UPDATE SET
       priority = EXCLUDED.priority,
       target_reasons = EXCLUDED.target_reasons,
       state = CASE
         WHEN EXCLUDED.state = 'published'
           AND standard_route_backfill_jobs.state = 'verified' THEN 'verified'
         WHEN EXCLUDED.state = 'published' THEN 'published'
         WHEN standard_route_backfill_jobs.state = 'verified' THEN 'needs_human'
         ELSE standard_route_backfill_jobs.state
       END,
       trailhead_id = COALESCE(
         EXCLUDED.trailhead_id,
         standard_route_backfill_jobs.trailhead_id
       ),
       published_route_id = COALESCE(
         EXCLUDED.published_route_id,
         standard_route_backfill_jobs.published_route_id
       ),
       blocker_code = CASE
         WHEN EXCLUDED.state = 'published' THEN NULL
         WHEN standard_route_backfill_jobs.state = 'verified'
           THEN 'verified_route_missing'
         ELSE standard_route_backfill_jobs.blocker_code
       END,
       blocker_message = CASE
         WHEN EXCLUDED.state = 'published' THEN NULL
         WHEN standard_route_backfill_jobs.state = 'verified'
           THEN 'The active Peaks route disappeared after verification.'
         ELSE standard_route_backfill_jobs.blocker_message
       END,
       lease_owner = CASE
         WHEN EXCLUDED.state = 'published' THEN NULL
         ELSE standard_route_backfill_jobs.lease_owner
       END,
       lease_token = CASE
         WHEN EXCLUDED.state = 'published' THEN NULL
         ELSE standard_route_backfill_jobs.lease_token
       END,
       lease_expires_at = CASE
         WHEN EXCLUDED.state = 'published' THEN NULL
         ELSE standard_route_backfill_jobs.lease_expires_at
       END,
       updated_at = now()`,
    [threshold]
  );

  const counts = await db.query<{ state: JobState; count: number }>(
    `SELECT state, COUNT(*)::int AS count
     FROM standard_route_backfill_jobs
     GROUP BY state
     ORDER BY state`
  );
  print({
    mode: "apply",
    popularity_threshold: threshold,
    states: Object.fromEntries(counts.rows.map((row) => [row.state, row.count])),
  });
}

const jobColumns = `
  j.destination_id,
  d.name AS destination_name,
  d.country_code,
  d.state_code,
  ST_Y(d.location::geometry) AS lat,
  ST_X(d.location::geometry) AS lng,
  j.state,
  j.priority,
  j.target_reasons,
  j.evidence,
  j.candidate,
  j.review,
  j.trailhead_id,
  j.candidate_path,
  j.candidate_sha256,
  j.published_route_id,
  j.blocker_code,
  j.blocker_message,
  j.attempt_count,
  j.lease_owner,
  j.lease_token,
  j.lease_expires_at,
  j.updated_at
`;

async function claim(argv: string[]): Promise<void> {
  const apply = argv.includes("--apply");
  const workerId = requireId(argv, "--worker-id");
  const stage = parseStage(argv);
  const leaseMinutes = positiveInteger(argv, "--lease-minutes", 90, 240);
  const states = statesForStage(stage);
  const token = randomUUID();
  const rank = claimRankSql();

  if (!apply) {
    const peek = await db.query<JobRow>(
      `SELECT ${jobColumns}
       FROM standard_route_backfill_jobs j
       JOIN destinations d ON d.id = j.destination_id
       WHERE j.state = ANY($1::text[])
         AND j.next_attempt_at <= now()
         AND (j.lease_expires_at IS NULL OR j.lease_expires_at < now())
       ORDER BY ${rank}, j.priority DESC, j.updated_at, j.destination_id
       LIMIT 1`,
      [states]
    );
    const job = peek.rows[0] ?? null;
    print({
      mode: "dry_run",
      requested_stage: stage,
      stage: job ? stageForState(job.state) : null,
      job,
    });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<JobRow>(
      `WITH selected AS (
         SELECT j.destination_id
         FROM standard_route_backfill_jobs j
         WHERE j.state = ANY($1::text[])
           AND j.next_attempt_at <= now()
           AND (j.lease_expires_at IS NULL OR j.lease_expires_at < now())
         ORDER BY ${rank}, j.priority DESC, j.updated_at, j.destination_id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       ),
       claimed AS (
         UPDATE standard_route_backfill_jobs j
         SET state = CASE
               WHEN j.state IN ('queued', 'needs_revision', 'needs_geometry')
                 THEN 'researching'
               ELSE j.state
             END,
             lease_owner = $2,
             lease_token = $3,
             lease_expires_at = now() + ($4::text || ' minutes')::interval,
             blocker_code = CASE
               WHEN j.state IN (
                 'queued',
                 'needs_revision',
                 'needs_geometry'
               ) THEN NULL
               ELSE j.blocker_code
             END,
             blocker_message = CASE
               WHEN j.state IN (
                 'queued',
                 'needs_revision',
                 'needs_geometry'
               ) THEN NULL
               ELSE j.blocker_message
             END,
             attempt_count = attempt_count + 1,
             updated_at = now()
         FROM selected
         WHERE j.destination_id = selected.destination_id
         RETURNING j.*
       )
       SELECT
         c.destination_id,
         d.name AS destination_name,
         d.country_code,
         d.state_code,
         ST_Y(d.location::geometry) AS lat,
         ST_X(d.location::geometry) AS lng,
         c.state,
         c.priority,
         c.target_reasons,
         c.evidence,
         c.candidate,
         c.review,
         c.trailhead_id,
         c.candidate_path,
         c.candidate_sha256,
         c.published_route_id,
         c.blocker_code,
         c.blocker_message,
         c.attempt_count,
         c.lease_owner,
         c.lease_token,
         c.lease_expires_at,
         c.updated_at
       FROM claimed c
       JOIN destinations d ON d.id = c.destination_id`,
      [states, workerId, token, leaseMinutes]
    );
    await client.query("COMMIT");
    const job = result.rows[0] ?? null;
    print({
      mode: "apply",
      requested_stage: stage,
      stage: job ? stageForState(job.state) : null,
      job,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function heartbeat(argv: string[]): Promise<void> {
  const token = requireId(argv, "--lease-token");
  const leaseMinutes = positiveInteger(argv, "--lease-minutes", 90, 240);
  const result = await db.query<{
    destination_id: string;
    lease_expires_at: string;
  }>(
    `UPDATE standard_route_backfill_jobs
     SET lease_expires_at = now() + ($2::text || ' minutes')::interval,
         updated_at = now()
     WHERE lease_token = $1 AND lease_expires_at >= now()
     RETURNING destination_id, lease_expires_at`,
    [token, leaseMinutes]
  );
  if (!result.rows[0]) throw new Error("Active lease not found");
  print(result.rows[0]);
}

const requiredReviewGates = [
  "route_identity",
  "geometry_rights",
  "access",
  "map_review",
  "source_geometry",
  "pending_route",
  "endpoints",
  "provenance",
] as const;

const requiredVerificationGates = [
  "owner",
  "active",
  "destination_order",
  "segments",
  "provenance",
  "public_http",
] as const;

function requirePassingResult(
  result: JsonObject,
  gates: readonly string[],
  label: string
): void {
  if (result.verdict !== "PASS") {
    throw new Error(`${label} requires verdict PASS`);
  }
  const values =
    result.gates && typeof result.gates === "object" && !Array.isArray(result.gates)
      ? (result.gates as JsonObject)
      : {};
  const missing = gates.filter((gate) => values[gate] !== true);
  if (missing.length > 0) {
    throw new Error(`${label} is missing passing gates: ${missing.join(", ")}`);
  }
}

function requireReviewResult(result: JsonObject, routeId: string): void {
  requirePassingResult(result, requiredReviewGates, "approved");
  if (
    result.reviewer !== "peaks_route_reviewer" ||
    result.route_id !== routeId ||
    (result.source_check !== "osm" && result.source_check !== "usgs")
  ) {
    throw new Error("approved result is not bound to this route and reviewer");
  }
  const reviewedAt = new Date(String(result.reviewed_at ?? ""));
  const reviewAgeMs = Date.now() - reviewedAt.getTime();
  if (
    Number.isNaN(reviewedAt.getTime()) ||
    reviewAgeMs < -5 * 60_000 ||
    reviewAgeMs > 24 * 60 * 60_000
  ) {
    throw new Error("approved requires a fresh reviewed_at timestamp");
  }
  if (!Array.isArray(result.errors) || result.errors.length !== 0) {
    throw new Error("approved requires an empty errors array");
  }
  const measurements =
    result.measurements &&
    typeof result.measurements === "object" &&
    !Array.isArray(result.measurements)
      ? (result.measurements as JsonObject)
      : {};
  const numeric = (key: string): number => {
    const value = measurements[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`approved requires numeric measurements.${key}`);
    }
    return value;
  };
  if (
    numeric("start_connector_m") > 125 ||
    numeric("end_connector_m") > 125 ||
    numeric("core_max_offset_m") > 5 ||
    numeric("core_p95_offset_m") > 2 ||
    numeric("core_coverage_pct") < 99
  ) {
    throw new Error("approved measurements miss the source geometry thresholds");
  }
}

function requireCandidateResult(result: JsonObject): void {
  if (
    typeof result.route_name !== "string" ||
    result.route_name.trim().length < 3
  ) {
    throw new Error("candidate_ready requires result.route_name");
  }
  if (
    result.route_shape !== "out_and_back" &&
    result.route_shape !== "loop" &&
    result.route_shape !== "lollipop"
  ) {
    throw new Error("candidate_ready requires a valid result.route_shape");
  }
  if (
    !Array.isArray(result.identity_sources) ||
    result.identity_sources.length === 0
  ) {
    throw new Error("candidate_ready requires at least one identity source");
  }
  for (const source of result.identity_sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("candidate identity sources must be objects");
    }
    const url = (source as JsonObject).url;
    if (typeof url !== "string" || new URL(url).protocol !== "https:") {
      throw new Error("candidate identity source URLs must use HTTPS");
    }
  }
  const geometry =
    result.geometry &&
    typeof result.geometry === "object" &&
    !Array.isArray(result.geometry)
      ? (result.geometry as JsonObject)
      : {};
  if (
    typeof geometry.source_kind !== "string" ||
    typeof geometry.source_url !== "string" ||
    typeof geometry.license !== "string"
  ) {
    throw new Error("candidate_ready requires geometry source and license");
  }
  if (new URL(geometry.source_url).protocol !== "https:") {
    throw new Error("candidate geometry source URL must use HTTPS");
  }
  const mapReview =
    result.map_review &&
    typeof result.map_review === "object" &&
    !Array.isArray(result.map_review)
      ? (result.map_review as JsonObject)
      : {};
  if (mapReview.passed !== true) {
    throw new Error("candidate_ready requires a passing rendered-map review");
  }
}

async function runSourceGeometryCheck(
  routeId: string,
  sourceKind: string
): Promise<void> {
  const script =
    sourceKind === "openstreetmap"
      ? ".claude/skills/peaks-osm-route-approval/scripts/check_pending_osm_routes.mts"
      : sourceKind === "usgs-national-map"
        ? ".claude/skills/peaks-osm-route-approval/scripts/check_pending_usgs_routes.mts"
        : null;
  if (!script) {
    throw new Error(`No independent source checker for ${sourceKind}`);
  }
  const executable = path.resolve(
    "cloud-sql/migrate/node_modules/.bin/tsx"
  );
  let stdout = "";
  try {
    const result = await execFileAsync(
      executable,
      [path.resolve(script), "--route-id", routeId, "--format", "json"],
      { maxBuffer: 2 * 1024 * 1024, timeout: 120_000 }
    );
    stdout = result.stdout;
  } catch (error) {
    stdout =
      typeof (error as { stdout?: unknown }).stdout === "string"
        ? String((error as { stdout: string }).stdout)
        : "";
    if (!stdout) {
      throw new Error(
        `Independent source checker failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  const check = JSON.parse(stdout.trim()) as {
    verdict?: string;
    results?: Array<{ route_id?: string; passed?: boolean }>;
  };
  if (
    check.verdict !== "PASS" ||
    check.results?.length !== 1 ||
    check.results[0].route_id !== routeId ||
    check.results[0].passed !== true
  ) {
    throw new Error("Independent source geometry check did not pass");
  }
}

function validateTransitionPayload(
  from: JobState,
  to: JobState,
  result: JsonObject,
  artifactPath: string | null,
  routeId: string | null,
  blockerCode: string | null,
  message: string | null
): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal state transition: ${from} -> ${to}`);
  }
  if (to === "candidate_ready" && !artifactPath) {
    throw new Error("candidate_ready requires --artifact-path");
  }
  if (to === "candidate_ready") {
    requireCandidateResult(result);
  }
  if (to === "pending_review" && !routeId) {
    throw new Error("pending_review requires the imported pending --route-id");
  }
  if (
    to === "pending_review" &&
    (result.mode !== "apply" ||
      result.status !== "pending" ||
      result.route_id !== routeId)
  ) {
    throw new Error(
      "pending_review requires the importer apply result for the same route ID"
    );
  }
  if (to === "approved") {
    if (!routeId) throw new Error("approved requires --route-id");
    requireReviewResult(result, routeId);
  }
  if (to === "verified") {
    requirePassingResult(result, requiredVerificationGates, "verified");
  }
  if ((to === "published" || to === "verified") && !routeId) {
    throw new Error(`${to} requires --route-id`);
  }
  if (BLOCKED_STATES.has(to) && (!blockerCode || !message)) {
    throw new Error(`${to} requires --blocker-code and --message`);
  }
}

async function transition(argv: string[]): Promise<void> {
  if (!argv.includes("--apply")) {
    throw new Error("transition requires --apply");
  }
  const destinationId = requireId(argv, "--destination-id");
  const token = requireId(argv, "--lease-token");
  const toValue = flagValue(argv, "--to");
  if (!toValue || !isJobState(toValue)) {
    throw new Error("--to must be a valid job state");
  }
  const to = toValue;
  const artifactInput = flagValue(argv, "--artifact-path");
  const artifactPath = artifactInput ? path.resolve(artifactInput) : null;
  const routeId = flagValue(argv, "--route-id");
  if (routeId && !/^[A-Za-z0-9_-]+$/.test(routeId)) {
    throw new Error("--route-id contains unsupported characters");
  }
  const blockerCode = flagValue(argv, "--blocker-code");
  const message = flagValue(argv, "--message");
  const retryMinutes = positiveInteger(argv, "--retry-minutes", 1, 43_200);
  let resultJson = await readResult(argv);
  let candidateArtifact: JsonObject | null = null;
  let candidateSha256: string | null = null;
  let trailheadId: string | null = null;
  if (artifactPath) {
    const stat = await fs.stat(artifactPath);
    if (!stat.isFile() || path.extname(artifactPath) !== ".geojson") {
      throw new Error("--artifact-path must be an existing GeoJSON file");
    }
    const parsed = JSON.parse(await fs.readFile(artifactPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("--artifact-path must contain one GeoJSON object");
    }
    candidateArtifact = parsed as JsonObject;
    if (candidateArtifact.peaks_destination_id !== destinationId) {
      throw new Error("Candidate destination does not match the leased job");
    }
    if (
      typeof candidateArtifact.peaks_trailhead_id !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(candidateArtifact.peaks_trailhead_id) ||
      candidateArtifact.peaks_trailhead_id === "draft-trailhead"
    ) {
      throw new Error("Candidate must name a real trailhead ID");
    }
    trailheadId = candidateArtifact.peaks_trailhead_id;
    candidateSha256 = createHash("sha256")
      .update(canonicalJson(candidateArtifact))
      .digest("hex");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{
      state: JobState;
      trailhead_id: string | null;
      published_route_id: string | null;
    }>(
      `SELECT state, trailhead_id, published_route_id
       FROM standard_route_backfill_jobs
       WHERE destination_id = $1
         AND lease_token = $2
         AND lease_expires_at >= now()
       FOR UPDATE`,
      [destinationId, token]
    );
    const currentJob = current.rows[0];
    const from = currentJob?.state;
    if (!from) throw new Error("Active job lease not found");
    if (
      routeId &&
      currentJob.published_route_id &&
      routeId !== currentJob.published_route_id &&
      !(from === "candidate_ready" && to === "pending_review")
    ) {
      throw new Error("Route ID does not match the route already saved on the job");
    }
    if (to === "verified") {
      if (!routeId || !currentJob.trailhead_id) {
        throw new Error("verified requires a saved route and trailhead");
      }
      resultJson = (await verifyStandardRoute(client, {
        routeId,
        destinationId,
        trailheadId: currentJob.trailhead_id,
      })) as unknown as JsonObject;
    }
    validateTransitionPayload(
      from,
      to,
      resultJson,
      artifactPath,
      routeId,
      blockerCode,
      message
    );
    if (
      to === "pending_review" ||
      to === "approved" ||
      to === "published"
    ) {
      if (!routeId) throw new Error(`${to} requires --route-id`);
      const expectedStatus = to === "published" ? "active" : "pending";
      const routeCheck = await client.query<{
        owner: string;
        status: string;
        destination_linked: boolean;
        trailhead_first: boolean;
        segment_count: number;
        source_kind: string;
      }>(
        `SELECT r.owner,
                r.status,
                EXISTS (
                  SELECT 1
                  FROM route_destinations rd
                  WHERE rd.route_id = r.id
                    AND rd.destination_id = $2
                ) AS destination_linked,
                EXISTS (
                  SELECT 1
                  FROM route_destinations rd
                  WHERE rd.route_id = r.id
                    AND rd.destination_id = $3
                    AND rd.ordinal = 0
                ) AS trailhead_first,
                (
                  SELECT COUNT(*)::int
                  FROM route_segments rs
                  WHERE rs.route_id = r.id
                ) AS segment_count,
                r.provenance->>'source_kind' AS source_kind
         FROM routes r
         WHERE r.id = $1`,
        [routeId, destinationId, currentJob.trailhead_id]
      );
      const route = routeCheck.rows[0];
      if (
        route?.owner !== "peaks" ||
        route.status !== expectedStatus ||
        !route.destination_linked ||
        !route.trailhead_first ||
        route.segment_count < 1
      ) {
        throw new Error(
          `${to} route is not the expected Peaks ${expectedStatus} route`
        );
      }
      if (to === "approved") {
        await runSourceGeometryCheck(routeId, route.source_kind);
      }
    }

    const resultField =
      to === "candidate_ready"
        ? "candidate"
        : to === "approved" || to === "needs_revision"
          ? "review"
          : "evidence";
    const updated = await client.query<{
      destination_id: string;
      state: JobState;
      trailhead_id: string | null;
      candidate_path: string | null;
      candidate_sha256: string | null;
      published_route_id: string | null;
    }>(
      `UPDATE standard_route_backfill_jobs
       SET state = $3,
           ${resultField} = ${resultField} || $4::jsonb,
           candidate_path = COALESCE($5, candidate_path),
           published_route_id = COALESCE($6, published_route_id),
           trailhead_id = COALESCE($10, trailhead_id),
           candidate_artifact = CASE
             WHEN $3 = 'verified' THEN NULL
             ELSE COALESCE($11::jsonb, candidate_artifact)
           END,
           candidate_sha256 = COALESCE($12, candidate_sha256),
           blocker_code = $7,
           blocker_message = $8,
           last_error = NULL,
           next_attempt_at = CASE
             WHEN $3 = ANY(
               ARRAY[
                 'needs_geometry',
                 'waiting_rights',
                 'waiting_access',
                 'needs_human'
               ]::text[]
             )
               THEN now() + ($9::text || ' minutes')::interval
             ELSE now()
           END,
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = now()
       WHERE destination_id = $1 AND lease_token = $2
       RETURNING destination_id, state, trailhead_id, candidate_path,
                 candidate_sha256, published_route_id`,
      [
        destinationId,
        token,
        to,
        JSON.stringify(resultJson),
        artifactPath,
        routeId,
        BLOCKED_STATES.has(to) ? blockerCode : null,
        BLOCKED_STATES.has(to) ? message : null,
        retryMinutes,
        trailheadId,
        candidateArtifact ? JSON.stringify(candidateArtifact) : null,
        candidateSha256,
      ]
    );
    await client.query("COMMIT");
    print({ from, ...updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function materialize(argv: string[]): Promise<void> {
  const destinationId = requireId(argv, "--destination-id");
  const token = requireId(argv, "--lease-token");
  const output = flagValue(argv, "--output");
  if (!output) throw new Error("--output is required");
  const result = await db.query<{
    candidate_artifact: JsonObject;
    candidate_sha256: string;
  }>(
    `SELECT candidate_artifact, candidate_sha256
     FROM standard_route_backfill_jobs
     WHERE destination_id = $1
       AND lease_token = $2
       AND lease_expires_at >= now()`,
    [destinationId, token]
  );
  const artifact = result.rows[0]?.candidate_artifact;
  const expectedHash = result.rows[0]?.candidate_sha256;
  if (!artifact || !expectedHash) {
    throw new Error("The leased job has no saved candidate artifact");
  }
  const contents = `${canonicalJson(artifact)}\n`;
  const actualHash = createHash("sha256")
    .update(canonicalJson(artifact))
    .digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error("Saved candidate checksum does not match");
  }
  const outputPath = path.resolve(output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  let reused = false;
  try {
    await fs.writeFile(outputPath, contents, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = JSON.parse(await fs.readFile(outputPath, "utf8"));
    const existingHash = createHash("sha256")
      .update(canonicalJson(existing))
      .digest("hex");
    if (existingHash !== actualHash) {
      throw new Error("Existing materialized candidate has a different checksum");
    }
    reused = true;
  }
  print({
    destination_id: destinationId,
    output: outputPath,
    sha256: actualHash,
    reused,
  });
}

async function release(argv: string[]): Promise<void> {
  const token = requireId(argv, "--lease-token");
  const message = flagValue(argv, "--message");
  const retryMinutes = positiveInteger(argv, "--retry-minutes", 15, 43_200);
  const result = await db.query<{
    destination_id: string;
    state: JobState;
    next_attempt_at: string;
  }>(
    `UPDATE standard_route_backfill_jobs
     SET lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         last_error = $2,
         next_attempt_at = now() + ($3::text || ' minutes')::interval,
         updated_at = now()
     WHERE lease_token = $1
     RETURNING destination_id, state, next_attempt_at`,
    [token, message, retryMinutes]
  );
  if (!result.rows[0]) throw new Error("Lease not found");
  print(result.rows[0]);
}

async function requeue(argv: string[]): Promise<void> {
  if (!argv.includes("--apply")) throw new Error("requeue requires --apply");
  if (!argv.includes("--acknowledge-human-review")) {
    throw new Error("requeue requires --acknowledge-human-review");
  }
  if (process.env.PEAKS_ALLOW_ROUTE_REQUEUE !== "1") {
    throw new Error("Set PEAKS_ALLOW_ROUTE_REQUEUE=1 for a human-run requeue");
  }
  const destinationId = requireId(argv, "--destination-id");
  const fromValue = flagValue(argv, "--from");
  const reason = flagValue(argv, "--reason");
  if (
    fromValue !== "waiting_rights" &&
    fromValue !== "waiting_access" &&
    fromValue !== "needs_human"
  ) {
    throw new Error("--from must be waiting_rights, waiting_access, or needs_human");
  }
  if (!reason || reason.trim().length < 12) {
    throw new Error("--reason must explain the human decision");
  }
  const result = await db.query<{ destination_id: string; state: JobState }>(
    `UPDATE standard_route_backfill_jobs
     SET state = 'queued',
         evidence = evidence || jsonb_build_object(
           'requeued_at', now(),
           'requeue_reason', $3
         ),
         blocker_code = NULL,
         blocker_message = NULL,
         last_error = NULL,
         next_attempt_at = now(),
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = now()
     WHERE destination_id = $1 AND state = $2
     RETURNING destination_id, state`,
    [destinationId, fromValue, reason.trim()]
  );
  if (!result.rows[0]) throw new Error("Blocked job did not match --from");
  print(result.rows[0]);
}

async function show(argv: string[]): Promise<void> {
  const destinationId = flagValue(argv, "--destination-id");
  const stateValue = flagValue(argv, "--state");
  if (stateValue && !isJobState(stateValue)) {
    throw new Error("--state must be a valid job state");
  }
  const limit = positiveInteger(argv, "--limit", 20, 200);
  const result = await db.query<JobRow>(
    `SELECT ${jobColumns}
     FROM standard_route_backfill_jobs j
     JOIN destinations d ON d.id = j.destination_id
     WHERE ($1::text IS NULL OR j.destination_id = $1)
       AND ($2::text IS NULL OR j.state = $2)
     ORDER BY ${claimRankSql()}, j.priority DESC, j.updated_at, j.destination_id
     LIMIT $3`,
    [destinationId, stateValue, limit]
  );
  print(result.rows);
}

async function stats(): Promise<void> {
  const result = await db.query<{
    state: JobState;
    count: number;
    expired_leases: number;
  }>(
    `SELECT state,
            COUNT(*)::int AS count,
            COUNT(*) FILTER (
              WHERE lease_expires_at IS NOT NULL AND lease_expires_at < now()
            )::int AS expired_leases
     FROM standard_route_backfill_jobs
     GROUP BY state
     ORDER BY state`
  );
  const total = result.rows.reduce((sum, row) => sum + row.count, 0);
  const verified =
    result.rows.find((row) => row.state === "verified")?.count ?? 0;
  print({
    total,
    verified,
    remaining: total - verified,
    coverage_percent: total === 0 ? 0 : Number(((verified / total) * 100).toFixed(2)),
    states: Object.fromEntries(result.rows.map((row) => [row.state, row.count])),
    expired_leases: result.rows.reduce(
      (sum, row) => sum + row.expired_leases,
      0
    ),
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (argv.includes("--help") || argv.includes("-h")) usage(0);
  if (!command) usage();
  switch (command) {
    case "seed":
      await seed(argv);
      break;
    case "claim":
      await claim(argv);
      break;
    case "heartbeat":
      await heartbeat(argv);
      break;
    case "materialize":
      await materialize(argv);
      break;
    case "transition":
      await transition(argv);
      break;
    case "release":
      await release(argv);
      break;
    case "requeue":
      await requeue(argv);
      break;
    case "show":
      await show(argv);
      break;
    case "stats":
      await stats();
      break;
    default:
      usage();
  }
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ error: message }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
