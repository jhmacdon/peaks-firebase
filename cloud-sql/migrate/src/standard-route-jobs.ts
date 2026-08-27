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
  ROUTE_REVIEWER_WORKER_ID,
  assertWorkerCanClaimStage,
  canTransition,
  canonicalJson,
  claimRankSql,
  humanRequeueTargetState,
  isJobState,
  JobStage,
  JobState,
  reviewerLeaseOwnerForTransition,
  stageForState,
  statesForStage,
  verificationAction,
} from "./standard-route-job-state";
import {
  sourceCheckerArgs,
  sourceCheckerRuntimePaths,
} from "./standard-route-source-check";
import { assertPendingRouteMatchesCandidate } from "./standard-route-candidate-binding";
import { getPublishableArcgisTrailSource } from "./official-trail-sources";
import { parseRouteDiscoveryChecks } from "./standard-route-discovery-checks";
import {
  assertOfficialSourceCountryBinding,
  parseOfficialSourceAttempts,
} from "./standard-route-official-source-attempts";
import {
  isStrongRouteIdentitySource,
  validateRouteAccessSource,
  validateRouteIdentitySource,
} from "./standard-route-identity-source";
import {
  databaseRoleForClaim,
  databaseRoleForTransition,
  requireRouteWorkerDatabaseRole,
} from "./standard-route-worker-role";
import { resolveRouteArtifactPath } from "./standard-route-paths";
import { verifyRouteReviewAttestation } from "./standard-route-review-attestation";

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
  replacement_route_id: string | null;
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
  npm run routes:jobs -- claim --worker-id ID [--destination-id ID]
      [--integrity-repairs-only]
      [--stage factory|review] [--lease-minutes 90] [--apply]
  npm run routes:jobs -- materialize --destination-id ID --lease-token TOKEN --output FILE
  npm run routes:jobs -- materialize-result --destination-id ID
      --lease-token TOKEN --kind candidate --output FILE
  npm run routes:jobs -- check-import-lease --destination-id ID
      --lease-token TOKEN
  npm run routes:jobs -- heartbeat --lease-token TOKEN [--lease-minutes 90]
  npm run routes:jobs -- verify --destination-id ID --lease-token TOKEN
      [--retry-minutes 30] --apply
  npm run routes:jobs -- transition --destination-id ID --lease-token TOKEN --to STATE
      [--artifact-path FILE] [--route-id ID] [--result-file FILE]
      [--review-packet FILE] [--source-check FILE]
      [--blocker-code CODE] [--message TEXT] [--retry-minutes N] --apply
  npm run routes:jobs -- release --lease-token TOKEN [--message TEXT] [--retry-minutes N]
  npm run routes:jobs -- requeue --destination-id ID --from STATE --reason TEXT
      --acknowledge-human-review --apply
  npm run routes:jobs -- cutover-discovery-checks [--apply]
  npm run routes:jobs -- recover-legacy [--apply]
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

function optionalId(argv: string[], flag: string): string | null {
  const value = flagValue(argv, flag);
  if (value === null) return null;
  if (!/^[A-Za-z0-9_.:@/-]+$/.test(value)) {
    throw new Error(`${flag} contains unsupported characters`);
  }
  return value;
}

function parseStage(argv: string[]): JobStage {
  const value = flagValue(argv, "--stage") ?? "next";
  if (
    value !== "next" &&
    value !== "factory" &&
    value !== "research" &&
    value !== "import" &&
    value !== "review" &&
    value !== "publish" &&
    value !== "verify"
  ) {
    throw new Error(
      "--stage must be next, factory, research, import, review, publish, or verify"
    );
  }
  return value;
}

async function readResult(argv: string[]): Promise<JsonObject> {
  const file = flagValue(argv, "--result-file");
  if (!file) return {};
  const parsed = JSON.parse(
    await fs.readFile(resolveRouteArtifactPath(__dirname, file), "utf8")
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--result-file must contain one JSON object");
  }
  return parsed as JsonObject;
}

async function readRequiredJsonArtifact(
  argv: string[],
  flag: string
): Promise<JsonObject> {
  const file = flagValue(argv, flag);
  if (!file) throw new Error(`${flag} is required`);
  const parsed = JSON.parse(
    await fs.readFile(resolveRouteArtifactPath(__dirname, file), "utf8")
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${flag} must contain one JSON object`);
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
  GROUP BY d.id
),
target_reasons AS (
  SELECT d.id,
         d.country_code,
         COALESCE(
           upper(btrim(d.country_code)) ~ '^[A-Z]{2}$',
           false
         ) AS country_code_valid,
         p.session_count,
         p.success_count,
         'summit'::destination_feature = ANY(d.features)
           AS summit_feature_valid,
         'summit'::destination_feature = ANY(d.features)
           AND d.prominence >= 1500 AS is_ultra_prominent,
         COALESCE(
           BOOL_OR(l.owner = 'peaks'),
           false
         ) AS is_target_list,
         'summit'::destination_feature = ANY(d.features)
           AND p.session_count >= $1::integer AS is_high_popularity,
         COALESCE(
           ARRAY_AGG(DISTINCT l.name ORDER BY l.name)
             FILTER (WHERE l.owner = 'peaks'),
           '{}'
         ) AS list_names
  FROM destinations d
  JOIN destination_popularity p ON p.id = d.id
  LEFT JOIN list_destinations ld ON ld.destination_id = d.id
  LEFT JOIN lists l ON l.id = ld.list_id
  GROUP BY d.id, d.country_code, p.session_count, p.success_count
),
normal_targets AS (
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
queued_integrity_repairs AS (
  SELECT DISTINCT ON (repair.destination_id)
         repair.destination_id,
         repair.route_id AS repair_route_id,
         repair.reason AS repair_reason,
         repair.summit_gap_meters AS repair_gap_meters
  FROM route_integrity_repairs repair
  JOIN routes bad_route ON bad_route.id = repair.route_id
  JOIN destinations destination ON destination.id = repair.destination_id
  WHERE repair.state = 'queued'
    AND bad_route.owner = 'peaks'
    AND bad_route.status = 'active'
    AND 'summit'::destination_feature = ANY(destination.features)
  ORDER BY repair.destination_id, repair.created_at, repair.route_id
),
targets AS (
  SELECT normal_targets.id,
         normal_targets.country_code,
         normal_targets.country_code_valid,
         normal_targets.session_count,
         normal_targets.success_count,
         normal_targets.summit_feature_valid,
         normal_targets.is_ultra_prominent,
         normal_targets.is_target_list,
         normal_targets.is_high_popularity,
         normal_targets.list_names,
         normal_targets.priority,
         repair.repair_route_id,
         repair.repair_reason,
         repair.repair_gap_meters
  FROM normal_targets
  LEFT JOIN queued_integrity_repairs repair ON repair.destination_id = normal_targets.id
  UNION ALL
  SELECT destination.id,
         destination.country_code,
         COALESCE(
           upper(btrim(destination.country_code)) ~ '^[A-Z]{2}$',
           false
         ),
         0::bigint, 0::bigint, true, false, false, false, '{}',
         0::integer,
         repair.repair_route_id, repair.repair_reason, repair.repair_gap_meters
  FROM queued_integrity_repairs repair
  JOIN destinations destination ON destination.id = repair.destination_id
  LEFT JOIN normal_targets normal ON normal.id = destination.id
  WHERE normal.id IS NULL
),
active_routes AS (
  SELECT DISTINCT ON (rd.destination_id)
         rd.destination_id,
         r.id AS route_id,
         peaks_route_passes_publish_integrity(
           r.id,
           rd.destination_id,
           'active'
         ) AS ready_to_verify,
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
  LEFT JOIN standard_route_backfill_jobs current_job
    ON current_job.destination_id = rd.destination_id
  WHERE t.summit_feature_valid
    AND r.owner = 'peaks' AND r.status = 'active'
  ORDER BY rd.destination_id,
           ready_to_verify DESC NULLS LAST,
           COALESCE(r.id = current_job.published_route_id, false) DESC,
           r.created_at,
           r.id
),
target_context AS (
  SELECT t.*,
         ar.route_id AS active_route_id,
         ar.ready_to_verify,
         ar.trailhead_id,
         existing.state AS existing_state,
         existing.target_reasons AS existing_target_reasons,
         existing.candidate AS existing_candidate,
         existing.published_route_id AS existing_published_route_id,
         existing.replacement_route_id AS existing_replacement_route_id
  FROM targets t
  LEFT JOIN active_routes ar ON ar.destination_id = t.id
  LEFT JOIN standard_route_backfill_jobs existing
    ON existing.destination_id = t.id
),
target_status AS (
  SELECT context.*,
         CASE
           WHEN context.repair_route_id IS NOT NULL
             THEN false
           WHEN context.existing_target_reasons
                  ->> 'country_binding_research_required' = 'true'
             THEN NOT (
               context.existing_state IN ('published', 'verified')
               AND context.existing_published_route_id IS DISTINCT FROM
                 context.existing_target_reasons
                   ->> 'country_binding_route_id'
               AND context.existing_published_route_id =
                 context.active_route_id
               AND context.existing_candidate
                     ->> 'official_source_country_code' =
                   upper(btrim(context.country_code))
             )
           WHEN NOT context.country_code_valid
             THEN false
           WHEN context.existing_state IN (
                  'candidate_ready',
                  'pending_review',
                  'needs_revision',
                  'approved',
                  'published',
                  'verified'
                )
             AND context.existing_candidate
                   ->> 'official_source_country_code' IS DISTINCT FROM
                 upper(btrim(context.country_code))
             THEN true
           WHEN context.repair_route_id IS NOT NULL
             OR context.active_route_id IS NULL
             OR NOT context.ready_to_verify
             THEN false
           ELSE false
         END AS country_binding_research_required,
         CASE
           WHEN context.repair_route_id IS NOT NULL
             THEN NULL
           WHEN context.existing_target_reasons
                  ->> 'country_binding_research_required' = 'true'
             THEN context.existing_target_reasons
                    ->> 'country_binding_route_id'
           WHEN context.existing_state IN (
                  'candidate_ready',
                  'pending_review',
                  'needs_revision',
                  'approved',
                  'published',
                  'verified'
                )
             AND context.existing_candidate
                   ->> 'official_source_country_code' IS DISTINCT FROM
                 upper(btrim(context.country_code))
             THEN COALESCE(
               context.existing_replacement_route_id,
               context.active_route_id,
               context.existing_published_route_id
             )
           ELSE NULL
         END AS country_binding_route_id,
         CASE
           WHEN context.repair_route_id IS NOT NULL
             THEN NULL
           WHEN context.existing_target_reasons
                  ->> 'country_binding_research_required' = 'true'
             THEN context.existing_target_reasons
                    ->> 'prior_official_source_country_code'
           WHEN context.existing_state IN (
                  'candidate_ready',
                  'pending_review',
                  'needs_revision',
                  'approved',
                  'published',
                  'verified'
                )
             AND context.existing_candidate
                   ->> 'official_source_country_code' IS DISTINCT FROM
                 upper(btrim(context.country_code))
             THEN context.existing_candidate
                    ->> 'official_source_country_code'
           ELSE NULL
         END AS prior_official_source_country_code
  FROM target_context context
),
incoming AS (
  SELECT t.id AS destination_id,
         t.country_code,
         CASE
           WHEN NOT t.summit_feature_valid THEN 'needs_human'
           WHEN NOT t.country_code_valid THEN 'needs_human'
           WHEN t.repair_route_id IS NOT NULL THEN 'queued'
           WHEN t.country_binding_research_required THEN 'queued'
           WHEN t.active_route_id IS NOT NULL AND t.ready_to_verify THEN 'published'
           ELSE 'queued'
         END AS state,
         (t.priority + CASE WHEN t.repair_route_id IS NOT NULL THEN 100000 ELSE 0 END)::integer AS priority,
         jsonb_build_object(
           'ultra_prominent', t.is_ultra_prominent,
           'target_list', t.is_target_list,
           'summit_feature_valid', t.summit_feature_valid,
           'country_code_valid', t.country_code_valid,
           'high_popularity', t.is_high_popularity,
           'list_names', t.list_names,
           'session_count', t.session_count,
           'success_count', t.success_count,
           'popularity_threshold', $1::integer,
           'integrity_repair', t.repair_route_id IS NOT NULL,
           'repair_route_id', t.repair_route_id,
           'reason', t.repair_reason,
           'gap_meters', t.repair_gap_meters
         ) || CASE WHEN t.country_binding_research_required
           THEN jsonb_build_object(
             'country_binding_research_required', true,
             'country_binding_reset_required',
               t.existing_candidate
                 ->> 'official_source_country_code' IS DISTINCT FROM
               upper(btrim(t.country_code)),
             'country_binding_target_country_code',
               upper(btrim(t.country_code)),
             'country_binding_route_id', t.country_binding_route_id,
             'prior_official_source_country_code',
               t.prior_official_source_country_code
           )
           ELSE '{}'::jsonb
         END AS target_reasons,
         CASE WHEN t.summit_feature_valid
           THEN COALESCE(t.repair_route_id, t.active_route_id)
           ELSE NULL
         END AS route_id,
         t.repair_route_id,
         CASE WHEN t.summit_feature_valid THEN t.trailhead_id ELSE NULL END
           AS trailhead_id,
         CASE WHEN NOT t.summit_feature_valid
           THEN 'listed_destination_missing_summit_feature'
           WHEN NOT t.country_code_valid
             THEN 'route_target_invalid_country_code'
           ELSE NULL
         END AS blocker_code,
         CASE WHEN NOT t.summit_feature_valid
           THEN 'This Peaks-list destination lacks the summit feature; fix its catalog data before building a route.'
           WHEN NOT t.country_code_valid
             THEN 'This route target lacks a valid two-letter country code; fix its catalog data before building or verifying a route.'
           ELSE NULL
         END AS blocker_message
  FROM target_status t
)
`;

interface GoalStats {
  total: number;
  verified: number;
  unseeded: number;
  invalid_verified: number;
  data_blockers: number;
  expired_leases: number;
  states: JsonObject;
}

async function loadGoalStats(popularityThreshold: number): Promise<GoalStats> {
  const result = await db.query<GoalStats>(
    `${targetSql},
     live_goal AS (
       SELECT incoming.destination_id,
              jobs.state,
              jobs.lease_expires_at,
              incoming.blocker_code IS NOT NULL AS data_blocker,
              jobs.destination_id IS NULL AS unseeded,
              CASE
                WHEN jobs.state = 'verified'
                  AND jobs.published_route_id IS NOT NULL
                  AND jobs.candidate ->> 'official_source_country_code'
                    ~ '^[A-Z]{2}$'
                  AND jobs.candidate ->> 'official_source_country_code' =
                    upper(btrim(incoming.country_code))
                  THEN peaks_route_passes_publish_integrity(
                    jobs.published_route_id,
                    incoming.destination_id,
                    'active'
                  )
                ELSE false
              END AS verified_route_valid
       FROM incoming
       LEFT JOIN standard_route_backfill_jobs jobs
         ON jobs.destination_id = incoming.destination_id
     ),
     state_counts AS (
       SELECT COALESCE(state, 'unseeded') AS state, COUNT(*)::int AS count
       FROM live_goal
       GROUP BY COALESCE(state, 'unseeded')
     )
     SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE state = 'verified' AND verified_route_valid
            )::int AS verified,
            COUNT(*) FILTER (WHERE unseeded)::int AS unseeded,
            COUNT(*) FILTER (
              WHERE state = 'verified' AND NOT verified_route_valid
            )::int AS invalid_verified,
            COUNT(*) FILTER (WHERE data_blocker)::int AS data_blockers,
            COUNT(*) FILTER (
              WHERE lease_expires_at IS NOT NULL
                AND lease_expires_at < now()
            )::int AS expired_leases,
            COALESCE(
              (SELECT jsonb_object_agg(state, count) FROM state_counts),
              '{}'::jsonb
            ) AS states
     FROM live_goal`,
    [popularityThreshold]
  );
  return result.rows[0];
}

function printGoalStats(stats: GoalStats, extra: JsonObject = {}): void {
  print({
    ...extra,
    total: stats.total,
    verified: stats.verified,
    remaining: stats.total - stats.verified,
    unseeded: stats.unseeded,
    invalid_verified: stats.invalid_verified,
    data_blockers: stats.data_blockers,
    coverage_percent:
      stats.total === 0
        ? 0
        : Number(((stats.verified / stats.total) * 100).toFixed(2)),
    states: stats.states,
    expired_leases: stats.expired_leases,
  });
}

async function seed(argv: string[]): Promise<void> {
  const apply = argv.includes("--apply");
  const threshold = positiveInteger(argv, "--popularity-threshold", 25);

  if (!apply) {
    const result = await db.query<{
      targets: number;
      active: number;
      ready_to_verify: number;
      legacy_to_rebuild: number;
      missing: number;
      data_blockers: number;
    }>(
      `${targetSql}
       SELECT COUNT(*)::int AS targets,
              COUNT(*) FILTER (WHERE route_id IS NOT NULL)::int AS active,
              COUNT(*) FILTER (WHERE state = 'published')::int AS ready_to_verify,
              COUNT(*) FILTER (
                WHERE route_id IS NOT NULL AND state = 'queued'
              )::int AS legacy_to_rebuild,
              COUNT(*) FILTER (WHERE route_id IS NULL)::int AS missing,
              COUNT(*) FILTER (
                WHERE blocker_code IS NOT NULL
              )::int AS data_blockers
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
       candidate,
       trailhead_id,
       published_route_id,
       replacement_route_id,
       blocker_code,
       blocker_message,
       updated_at
     )
     SELECT destination_id,
            state,
            priority,
            target_reasons,
            CASE
              WHEN state = 'published' THEN jsonb_build_object(
                'official_source_country_code',
                upper(btrim(country_code))
              )
              ELSE '{}'::jsonb
            END,
            trailhead_id,
            route_id,
            CASE
              WHEN state = 'queued' AND route_id IS NOT NULL THEN route_id
              ELSE NULL
            END,
            blocker_code,
            blocker_message,
            now()
     FROM incoming
     ON CONFLICT (destination_id) DO UPDATE SET
       priority = CASE
         WHEN standard_route_backfill_jobs.lease_token IS NOT NULL
           AND standard_route_backfill_jobs.lease_expires_at >= now()
           THEN standard_route_backfill_jobs.priority
         ELSE EXCLUDED.priority
       END,
       target_reasons = CASE
         WHEN standard_route_backfill_jobs.lease_token IS NOT NULL
           AND standard_route_backfill_jobs.lease_expires_at >= now()
           THEN standard_route_backfill_jobs.target_reasons
         ELSE EXCLUDED.target_reasons
       END,
       state = CASE
         WHEN standard_route_backfill_jobs.lease_token IS NOT NULL
           AND standard_route_backfill_jobs.lease_expires_at >= now()
           THEN standard_route_backfill_jobs.state
         WHEN EXCLUDED.target_reasons ->> 'summit_feature_valid' = 'false'
           THEN 'needs_human'
         WHEN EXCLUDED.target_reasons ->> 'country_code_valid' = 'false'
           THEN 'needs_human'
         WHEN EXCLUDED.target_reasons
                ->> 'country_binding_reset_required' = 'true'
           THEN 'queued'
         WHEN standard_route_backfill_jobs.blocker_code IN (
                'listed_destination_missing_summit_feature',
                'route_target_invalid_country_code'
              )
           THEN EXCLUDED.state
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'repair_route_id' IS NOT DISTINCT FROM
               EXCLUDED.target_reasons ->> 'repair_route_id'
           AND standard_route_backfill_jobs.state IN (
             'researching',
             'candidate_ready',
             'pending_review',
             'needs_revision',
             'approved',
             'needs_geometry',
             'waiting_rights',
             'waiting_access',
             'needs_human'
           )
           THEN standard_route_backfill_jobs.state
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           THEN 'queued'
         WHEN EXCLUDED.state = 'published'
           AND standard_route_backfill_jobs.state IN (
             'queued',
             'researching',
             'candidate_ready',
             'needs_geometry'
           )
           THEN 'published'
         WHEN standard_route_backfill_jobs.state = 'verified'
           AND EXCLUDED.state = 'published'
           AND EXCLUDED.published_route_id =
               standard_route_backfill_jobs.published_route_id
           THEN 'verified'
         WHEN standard_route_backfill_jobs.state = 'verified'
           THEN 'needs_human'
         WHEN standard_route_backfill_jobs.state = 'published'
           THEN EXCLUDED.state
         ELSE standard_route_backfill_jobs.state
       END,
       trailhead_id = CASE
         WHEN standard_route_backfill_jobs.lease_token IS NOT NULL
           AND standard_route_backfill_jobs.lease_expires_at >= now()
           THEN standard_route_backfill_jobs.trailhead_id
         WHEN EXCLUDED.target_reasons ->> 'summit_feature_valid' = 'false'
           THEN NULL
         WHEN EXCLUDED.target_reasons ->> 'country_code_valid' = 'false'
           THEN standard_route_backfill_jobs.trailhead_id
         WHEN standard_route_backfill_jobs.blocker_code IN (
                'listed_destination_missing_summit_feature',
                'route_target_invalid_country_code'
              )
           THEN EXCLUDED.trailhead_id
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'repair_route_id' IS NOT DISTINCT FROM
               EXCLUDED.target_reasons ->> 'repair_route_id'
           AND standard_route_backfill_jobs.state IN (
             'researching',
             'candidate_ready',
             'pending_review',
             'needs_revision',
             'approved',
             'needs_geometry',
             'waiting_rights',
             'waiting_access',
             'needs_human'
           )
           THEN standard_route_backfill_jobs.trailhead_id
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           THEN COALESCE(
             EXCLUDED.trailhead_id,
             standard_route_backfill_jobs.trailhead_id
           )
         WHEN EXCLUDED.state = 'published'
           AND standard_route_backfill_jobs.state IN (
             'queued',
             'researching',
             'candidate_ready',
             'needs_geometry'
           )
           THEN EXCLUDED.trailhead_id
         WHEN standard_route_backfill_jobs.state IN ('queued', 'published')
           THEN COALESCE(
             EXCLUDED.trailhead_id,
             standard_route_backfill_jobs.trailhead_id
           )
         ELSE standard_route_backfill_jobs.trailhead_id
       END,
       published_route_id = CASE
         WHEN standard_route_backfill_jobs.lease_token IS NOT NULL
           AND standard_route_backfill_jobs.lease_expires_at >= now()
           THEN standard_route_backfill_jobs.published_route_id
         WHEN EXCLUDED.target_reasons ->> 'summit_feature_valid' = 'false'
           THEN NULL
         WHEN EXCLUDED.target_reasons ->> 'country_code_valid' = 'false'
           THEN standard_route_backfill_jobs.published_route_id
         WHEN standard_route_backfill_jobs.blocker_code IN (
                'listed_destination_missing_summit_feature',
                'route_target_invalid_country_code'
              )
           THEN EXCLUDED.published_route_id
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'repair_route_id' IS NOT DISTINCT FROM
               EXCLUDED.target_reasons ->> 'repair_route_id'
           AND standard_route_backfill_jobs.state IN (
             'researching',
             'candidate_ready',
             'pending_review',
             'needs_revision',
             'approved',
             'needs_geometry',
             'waiting_rights',
             'waiting_access',
             'needs_human'
           )
           THEN standard_route_backfill_jobs.published_route_id
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           THEN COALESCE(
             standard_route_backfill_jobs.published_route_id,
             EXCLUDED.published_route_id
           )
         WHEN EXCLUDED.state = 'published'
           AND standard_route_backfill_jobs.state IN (
             'queued',
             'researching',
             'candidate_ready',
             'needs_geometry'
           )
           THEN EXCLUDED.published_route_id
         WHEN standard_route_backfill_jobs.state IN ('queued', 'published')
           THEN COALESCE(
             EXCLUDED.published_route_id,
             standard_route_backfill_jobs.published_route_id
           )
         ELSE standard_route_backfill_jobs.published_route_id
       END,
       replacement_route_id = CASE
         WHEN standard_route_backfill_jobs.lease_token IS NOT NULL
           AND standard_route_backfill_jobs.lease_expires_at >= now()
           THEN standard_route_backfill_jobs.replacement_route_id
         WHEN EXCLUDED.target_reasons ->> 'summit_feature_valid' = 'false'
           THEN NULL
         WHEN EXCLUDED.target_reasons ->> 'country_code_valid' = 'false'
           THEN standard_route_backfill_jobs.replacement_route_id
         WHEN EXCLUDED.target_reasons
                ->> 'country_binding_reset_required' = 'true'
           THEN EXCLUDED.replacement_route_id
         WHEN standard_route_backfill_jobs.blocker_code IN (
                'listed_destination_missing_summit_feature',
                'route_target_invalid_country_code'
              )
           THEN EXCLUDED.replacement_route_id
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'repair_route_id' IS NOT DISTINCT FROM
               EXCLUDED.target_reasons ->> 'repair_route_id'
           AND standard_route_backfill_jobs.state IN (
             'researching',
             'candidate_ready',
             'pending_review',
             'needs_revision',
             'approved',
             'needs_geometry',
             'waiting_rights',
             'waiting_access',
             'needs_human'
           )
           THEN standard_route_backfill_jobs.replacement_route_id
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           THEN EXCLUDED.replacement_route_id
         WHEN EXCLUDED.state = 'published'
           AND standard_route_backfill_jobs.state IN (
             'queued',
             'researching',
             'candidate_ready',
             'needs_geometry'
           )
           THEN NULL
         ELSE COALESCE(
           standard_route_backfill_jobs.replacement_route_id,
           EXCLUDED.replacement_route_id
         )
       END,
       blocker_code = CASE
         WHEN standard_route_backfill_jobs.lease_token IS NOT NULL
           AND standard_route_backfill_jobs.lease_expires_at >= now()
           THEN standard_route_backfill_jobs.blocker_code
         WHEN EXCLUDED.target_reasons ->> 'summit_feature_valid' = 'false'
           THEN EXCLUDED.blocker_code
         WHEN EXCLUDED.target_reasons ->> 'country_code_valid' = 'false'
           THEN EXCLUDED.blocker_code
         WHEN EXCLUDED.target_reasons
                ->> 'country_binding_reset_required' = 'true'
           THEN 'route_target_country_binding_drift'
         WHEN standard_route_backfill_jobs.blocker_code IN (
                'listed_destination_missing_summit_feature',
                'route_target_invalid_country_code'
              )
           THEN EXCLUDED.blocker_code
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'repair_route_id' IS NOT DISTINCT FROM
               EXCLUDED.target_reasons ->> 'repair_route_id'
           AND standard_route_backfill_jobs.state IN (
             'researching',
             'candidate_ready',
             'pending_review',
             'needs_revision',
             'approved',
             'needs_geometry',
             'waiting_rights',
             'waiting_access',
             'needs_human'
           )
           THEN standard_route_backfill_jobs.blocker_code
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true' THEN NULL
         WHEN EXCLUDED.state = 'published'
           AND standard_route_backfill_jobs.state IN (
             'queued',
             'researching',
             'candidate_ready',
             'needs_geometry'
           )
           THEN NULL
         WHEN standard_route_backfill_jobs.state = 'verified'
           AND EXCLUDED.state = 'published'
           AND EXCLUDED.published_route_id =
               standard_route_backfill_jobs.published_route_id
           THEN NULL
         WHEN standard_route_backfill_jobs.state = 'verified'
           AND EXCLUDED.published_route_id IS NULL
           THEN 'verified_route_missing'
         WHEN standard_route_backfill_jobs.state = 'verified'
           THEN 'verified_route_invalid'
         ELSE standard_route_backfill_jobs.blocker_code
       END,
       blocker_message = CASE
         WHEN standard_route_backfill_jobs.lease_token IS NOT NULL
           AND standard_route_backfill_jobs.lease_expires_at >= now()
           THEN standard_route_backfill_jobs.blocker_message
         WHEN EXCLUDED.target_reasons ->> 'summit_feature_valid' = 'false'
           THEN EXCLUDED.blocker_message
         WHEN EXCLUDED.target_reasons ->> 'country_code_valid' = 'false'
           THEN EXCLUDED.blocker_message
         WHEN EXCLUDED.target_reasons
                ->> 'country_binding_reset_required' = 'true'
           THEN 'The destination country changed after route research; research and review route sources again under the live country.'
         WHEN standard_route_backfill_jobs.blocker_code IN (
                'listed_destination_missing_summit_feature',
                'route_target_invalid_country_code'
              )
           THEN EXCLUDED.blocker_message
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'repair_route_id' IS NOT DISTINCT FROM
               EXCLUDED.target_reasons ->> 'repair_route_id'
           AND standard_route_backfill_jobs.state IN (
             'researching',
             'candidate_ready',
             'pending_review',
             'needs_revision',
             'approved',
             'needs_geometry',
             'waiting_rights',
             'waiting_access',
             'needs_human'
           )
           THEN standard_route_backfill_jobs.blocker_message
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true' THEN NULL
         WHEN EXCLUDED.state = 'published'
           AND standard_route_backfill_jobs.state IN (
             'queued',
             'researching',
             'candidate_ready',
             'needs_geometry'
           )
           THEN NULL
         WHEN standard_route_backfill_jobs.state = 'verified'
           AND EXCLUDED.state = 'published'
           AND EXCLUDED.published_route_id =
               standard_route_backfill_jobs.published_route_id
           THEN NULL
         WHEN standard_route_backfill_jobs.state = 'verified'
           AND EXCLUDED.published_route_id IS NULL
           THEN 'The active Peaks route disappeared after verification.'
         WHEN standard_route_backfill_jobs.state = 'verified'
           THEN 'The verified route no longer meets route integrity gates.'
         ELSE standard_route_backfill_jobs.blocker_message
       END,
       evidence = CASE
         WHEN EXCLUDED.target_reasons ->> 'country_code_valid' = 'false'
           THEN standard_route_backfill_jobs.evidence
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'repair_route_id' IS NOT DISTINCT FROM
               EXCLUDED.target_reasons ->> 'repair_route_id'
           AND standard_route_backfill_jobs.state IN (
             'researching',
             'candidate_ready',
             'pending_review',
             'needs_revision',
             'approved',
             'needs_geometry',
             'waiting_rights',
             'waiting_access',
             'needs_human'
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN standard_route_backfill_jobs.evidence
         WHEN (
             EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
             OR EXCLUDED.target_reasons ->> 'summit_feature_valid' = 'false'
             OR standard_route_backfill_jobs.blocker_code IN (
                'listed_destination_missing_summit_feature',
                'route_target_invalid_country_code'
             )
             OR (
               EXCLUDED.state = 'published'
               AND standard_route_backfill_jobs.state IN (
                 'queued',
                 'researching',
                 'candidate_ready',
                 'needs_geometry'
               )
             )
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN '{}'::jsonb
         ELSE standard_route_backfill_jobs.evidence
       END,
       candidate = CASE
         WHEN EXCLUDED.target_reasons ->> 'country_code_valid' = 'false'
           THEN standard_route_backfill_jobs.candidate
         WHEN EXCLUDED.target_reasons
                ->> 'country_binding_reset_required' = 'true'
           AND NOT (
             standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now()
           )
           THEN '{}'::jsonb
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'repair_route_id' IS NOT DISTINCT FROM
               EXCLUDED.target_reasons ->> 'repair_route_id'
           AND standard_route_backfill_jobs.state IN (
             'researching',
             'candidate_ready',
             'pending_review',
             'needs_revision',
             'approved',
             'needs_geometry',
             'waiting_rights',
             'waiting_access',
             'needs_human'
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN standard_route_backfill_jobs.candidate
         WHEN EXCLUDED.state = 'published'
           AND standard_route_backfill_jobs.state IN (
             'queued',
             'researching',
             'candidate_ready',
             'needs_geometry'
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN EXCLUDED.candidate
         WHEN EXCLUDED.state = 'published'
           AND standard_route_backfill_jobs.blocker_code IN (
             'listed_destination_missing_summit_feature',
             'route_target_invalid_country_code'
           )
           THEN EXCLUDED.candidate
         WHEN (
             EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
             OR EXCLUDED.target_reasons ->> 'summit_feature_valid' = 'false'
             OR standard_route_backfill_jobs.blocker_code IN (
                'listed_destination_missing_summit_feature',
                'route_target_invalid_country_code'
             )
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN '{}'::jsonb
         ELSE standard_route_backfill_jobs.candidate
       END,
       review = CASE
         WHEN EXCLUDED.target_reasons ->> 'country_code_valid' = 'false'
           THEN standard_route_backfill_jobs.review
         WHEN EXCLUDED.target_reasons
                ->> 'country_binding_reset_required' = 'true'
           AND NOT (
             standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now()
           )
           THEN '{}'::jsonb
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'repair_route_id' IS NOT DISTINCT FROM
               EXCLUDED.target_reasons ->> 'repair_route_id'
           AND standard_route_backfill_jobs.state IN (
             'researching',
             'candidate_ready',
             'pending_review',
             'needs_revision',
             'approved',
             'needs_geometry',
             'waiting_rights',
             'waiting_access',
             'needs_human'
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN standard_route_backfill_jobs.review
         WHEN (
             EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
             OR EXCLUDED.target_reasons ->> 'summit_feature_valid' = 'false'
             OR standard_route_backfill_jobs.blocker_code IN (
                'listed_destination_missing_summit_feature',
                'route_target_invalid_country_code'
             )
             OR (
               EXCLUDED.state = 'published'
               AND standard_route_backfill_jobs.state IN (
                 'queued',
                 'researching',
                 'candidate_ready',
                 'needs_geometry'
               )
             )
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN '{}'::jsonb
         ELSE standard_route_backfill_jobs.review
       END,
       candidate_path = CASE
         WHEN EXCLUDED.target_reasons ->> 'country_code_valid' = 'false'
           THEN standard_route_backfill_jobs.candidate_path
         WHEN EXCLUDED.target_reasons
                ->> 'country_binding_reset_required' = 'true'
           AND NOT (
             standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now()
           )
           THEN NULL
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'repair_route_id' IS NOT DISTINCT FROM
               EXCLUDED.target_reasons ->> 'repair_route_id'
           AND standard_route_backfill_jobs.state IN (
             'researching',
             'candidate_ready',
             'pending_review',
             'needs_revision',
             'approved',
             'needs_geometry',
             'waiting_rights',
             'waiting_access',
             'needs_human'
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN standard_route_backfill_jobs.candidate_path
         WHEN (
             EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
             OR EXCLUDED.target_reasons ->> 'summit_feature_valid' = 'false'
             OR standard_route_backfill_jobs.blocker_code IN (
                'listed_destination_missing_summit_feature',
                'route_target_invalid_country_code'
             )
             OR (
               EXCLUDED.state = 'published'
               AND standard_route_backfill_jobs.state IN (
                 'queued',
                 'researching',
                 'candidate_ready',
                 'needs_geometry'
               )
             )
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN NULL
         ELSE standard_route_backfill_jobs.candidate_path
       END,
       candidate_sha256 = CASE
         WHEN EXCLUDED.target_reasons ->> 'country_code_valid' = 'false'
           THEN standard_route_backfill_jobs.candidate_sha256
         WHEN EXCLUDED.target_reasons
                ->> 'country_binding_reset_required' = 'true'
           AND NOT (
             standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now()
           )
           THEN NULL
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'repair_route_id' IS NOT DISTINCT FROM
               EXCLUDED.target_reasons ->> 'repair_route_id'
           AND standard_route_backfill_jobs.state IN (
             'researching',
             'candidate_ready',
             'pending_review',
             'needs_revision',
             'approved',
             'needs_geometry',
             'waiting_rights',
             'waiting_access',
             'needs_human'
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN standard_route_backfill_jobs.candidate_sha256
         WHEN (
             EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
             OR EXCLUDED.target_reasons ->> 'summit_feature_valid' = 'false'
             OR standard_route_backfill_jobs.blocker_code IN (
                'listed_destination_missing_summit_feature',
                'route_target_invalid_country_code'
             )
             OR (
               EXCLUDED.state = 'published'
               AND standard_route_backfill_jobs.state IN (
                 'queued',
                 'researching',
                 'candidate_ready',
                 'needs_geometry'
               )
             )
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN NULL
         ELSE standard_route_backfill_jobs.candidate_sha256
       END,
       candidate_artifact = CASE
         WHEN EXCLUDED.target_reasons ->> 'country_code_valid' = 'false'
           THEN standard_route_backfill_jobs.candidate_artifact
         WHEN EXCLUDED.target_reasons
                ->> 'country_binding_reset_required' = 'true'
           AND NOT (
             standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now()
           )
           THEN NULL
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'repair_route_id' IS NOT DISTINCT FROM
               EXCLUDED.target_reasons ->> 'repair_route_id'
           AND standard_route_backfill_jobs.state IN (
             'researching',
             'candidate_ready',
             'pending_review',
             'needs_revision',
             'approved',
             'needs_geometry',
             'waiting_rights',
             'waiting_access',
             'needs_human'
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN standard_route_backfill_jobs.candidate_artifact
         WHEN (
             EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
             OR EXCLUDED.target_reasons ->> 'summit_feature_valid' = 'false'
             OR standard_route_backfill_jobs.blocker_code IN (
                'listed_destination_missing_summit_feature',
                'route_target_invalid_country_code'
             )
             OR (
               EXCLUDED.state = 'published'
               AND standard_route_backfill_jobs.state IN (
                 'queued',
                 'researching',
                 'candidate_ready',
                 'needs_geometry'
               )
             )
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN NULL
         ELSE standard_route_backfill_jobs.candidate_artifact
       END,
       next_attempt_at = CASE
         WHEN EXCLUDED.target_reasons ->> 'country_code_valid' = 'false'
           THEN standard_route_backfill_jobs.next_attempt_at
         WHEN EXCLUDED.target_reasons
                ->> 'country_binding_reset_required' = 'true'
           AND NOT (
             standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now()
           )
           THEN now()
         WHEN EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'integrity_repair' = 'true'
           AND standard_route_backfill_jobs.target_reasons
                 ->> 'repair_route_id' IS NOT DISTINCT FROM
               EXCLUDED.target_reasons ->> 'repair_route_id'
           AND standard_route_backfill_jobs.state IN (
             'researching',
             'candidate_ready',
             'pending_review',
             'needs_revision',
             'approved',
             'needs_geometry',
             'waiting_rights',
             'waiting_access',
             'needs_human'
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN standard_route_backfill_jobs.next_attempt_at
         WHEN (
             EXCLUDED.target_reasons ->> 'integrity_repair' = 'true'
             OR EXCLUDED.target_reasons ->> 'summit_feature_valid' = 'false'
             OR standard_route_backfill_jobs.blocker_code IN (
                'listed_destination_missing_summit_feature',
                'route_target_invalid_country_code'
             )
             OR (
               EXCLUDED.state = 'published'
               AND standard_route_backfill_jobs.state IN (
                 'queued',
                 'researching',
                 'candidate_ready',
                 'needs_geometry'
               )
             )
           )
           AND NOT (standard_route_backfill_jobs.lease_token IS NOT NULL
             AND standard_route_backfill_jobs.lease_expires_at >= now())
           THEN now()
         ELSE standard_route_backfill_jobs.next_attempt_at
       END,
       last_error = CASE
         WHEN standard_route_backfill_jobs.lease_token IS NOT NULL
           AND standard_route_backfill_jobs.lease_expires_at >= now()
           THEN standard_route_backfill_jobs.last_error
         WHEN EXCLUDED.target_reasons ->> 'country_code_valid' = 'false'
           THEN NULL
         WHEN EXCLUDED.target_reasons
                ->> 'country_binding_reset_required' = 'true'
           THEN NULL
         WHEN standard_route_backfill_jobs.blocker_code IN (
           'listed_destination_missing_summit_feature',
           'route_target_invalid_country_code'
         )
           THEN NULL
         WHEN NOT (
           standard_route_backfill_jobs.lease_token IS NOT NULL
           AND standard_route_backfill_jobs.lease_expires_at >= now()
         )
         AND EXCLUDED.state = 'published'
         AND standard_route_backfill_jobs.state IN (
           'queued',
           'researching',
           'candidate_ready',
           'needs_geometry'
         )
           THEN NULL
         ELSE standard_route_backfill_jobs.last_error
       END,
       lease_owner = CASE
         WHEN standard_route_backfill_jobs.lease_token IS NOT NULL
           AND standard_route_backfill_jobs.lease_expires_at >= now()
           THEN standard_route_backfill_jobs.lease_owner
         ELSE NULL
       END,
       lease_token = CASE
         WHEN standard_route_backfill_jobs.lease_token IS NOT NULL
           AND standard_route_backfill_jobs.lease_expires_at >= now()
           THEN standard_route_backfill_jobs.lease_token
         ELSE NULL
       END,
       lease_expires_at = CASE
         WHEN standard_route_backfill_jobs.lease_token IS NOT NULL
           AND standard_route_backfill_jobs.lease_expires_at >= now()
           THEN standard_route_backfill_jobs.lease_expires_at
         ELSE NULL
       END,
       updated_at = now()`,
    [threshold]
  );

  const stats = await loadGoalStats(threshold);
  printGoalStats(stats, {
    mode: "apply",
    popularity_threshold: threshold,
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
  j.replacement_route_id,
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
  const requestedDestinationId = optionalId(argv, "--destination-id");
  const integrityRepairsOnly = argv.includes("--integrity-repairs-only");
  const stage = parseStage(argv);
  assertWorkerCanClaimStage(workerId, stage);
  const leaseMinutes = positiveInteger(argv, "--lease-minutes", 90, 240);
  const states = statesForStage(stage);
  const token = randomUUID();
  const rank = claimRankSql();

  if (!apply) {
    await requireRouteWorkerDatabaseRole(db, databaseRoleForClaim(stage));
    const peek = await db.query<JobRow>(
      `SELECT ${jobColumns}
       FROM standard_route_backfill_jobs j
       JOIN destinations d ON d.id = j.destination_id
       WHERE j.state = ANY($1::text[])
         AND upper(btrim(d.country_code)) ~ '^[A-Z]{2}$'
         AND j.next_attempt_at <= now()
         AND (j.lease_expires_at IS NULL OR j.lease_expires_at < now())
         AND ($2::text IS NULL OR j.destination_id = $2)
         AND (
           NOT $3::boolean
           OR j.target_reasons->>'integrity_repair' = 'true'
         )
       ORDER BY ${rank}, j.priority DESC, j.updated_at, j.destination_id
       LIMIT 1`,
      [states, requestedDestinationId, integrityRepairsOnly]
    );
    const job = peek.rows[0] ?? null;
    print({
      mode: "dry_run",
      requested_stage: stage,
      requested_destination_id: requestedDestinationId,
      integrity_repairs_only: integrityRepairsOnly,
      stage: job ? stageForState(job.state) : null,
      job,
    });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await requireRouteWorkerDatabaseRole(client, databaseRoleForClaim(stage));
    const result = await client.query<JobRow>(
       `WITH selected AS (
         SELECT j.destination_id
         FROM standard_route_backfill_jobs j
         JOIN destinations claim_destination
           ON claim_destination.id = j.destination_id
         WHERE j.state = ANY($1::text[])
           AND upper(btrim(claim_destination.country_code)) ~ '^[A-Z]{2}$'
           AND j.next_attempt_at <= now()
           AND (j.lease_expires_at IS NULL OR j.lease_expires_at < now())
           AND ($5::text IS NULL OR j.destination_id = $5)
           AND (
             NOT $6::boolean
             OR j.target_reasons->>'integrity_repair' = 'true'
           )
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
         c.replacement_route_id,
         c.blocker_code,
         c.blocker_message,
         c.attempt_count,
         c.lease_owner,
         c.lease_token,
         c.lease_expires_at,
         c.updated_at
       FROM claimed c
       JOIN destinations d ON d.id = c.destination_id`,
      [
        states,
        workerId,
        token,
        leaseMinutes,
        requestedDestinationId,
        integrityRepairsOnly,
      ]
    );
    await client.query("COMMIT");
    const job = result.rows[0] ?? null;
    print({
      mode: "apply",
      requested_stage: stage,
      requested_destination_id: requestedDestinationId,
      integrity_repairs_only: integrityRepairsOnly,
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

async function checkImportLease(argv: string[]): Promise<void> {
  const destinationId = requireId(argv, "--destination-id");
  const token = requireId(argv, "--lease-token");
  const result = await db.query<{
    candidate: JsonObject;
    candidate_artifact: JsonObject | null;
    candidate_path: string | null;
    candidate_sha256: string | null;
    trailhead_id: string | null;
    destination_country_code: string | null;
  }>(
    `SELECT candidate, candidate_artifact, candidate_path, candidate_sha256,
            trailhead_id, d.country_code AS destination_country_code
     FROM standard_route_backfill_jobs j
     JOIN destinations d ON d.id = j.destination_id
     WHERE j.destination_id = $1
       AND j.lease_token = $2
       AND j.lease_expires_at >= now()
       AND j.state = 'candidate_ready'`,
    [destinationId, token]
  );
  const job = result.rows[0];
  if (
    !job ||
    !job.candidate_artifact ||
    !job.candidate_path ||
    !job.candidate_sha256 ||
    !job.trailhead_id
  ) {
    throw new Error(
      "Import requires an active candidate_ready lease with durable candidate evidence"
    );
  }
  const candidateHash = createHash("sha256")
    .update(canonicalJson(job.candidate_artifact))
    .digest("hex");
  if (candidateHash !== job.candidate_sha256) {
    throw new Error("Saved candidate checksum does not match");
  }
  assertOfficialSourceCountryBinding(
    job.candidate.official_source_country_code,
    { countryCode: job.destination_country_code }
  );
  if (
    !job.candidate.discovery_checks ||
    typeof job.candidate.discovery_checks !== "object" ||
    Array.isArray(job.candidate.discovery_checks)
  ) {
    throw new Error(
      "Saved candidate predates the required AllTrails and Peakbagger discovery checks"
    );
  }
  print({ destination_id: destinationId, state: "candidate_ready" });
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
  "summit_contact",
  "elevation_profile",
  "segment_assembly",
] as const;

const requiredVerificationGates = [
  "owner",
  "active",
  "destination_order",
  "segments",
  "provenance",
  "summit_contact",
  "elevation_profile",
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
    result.reviewer !== ROUTE_REVIEWER_WORKER_ID ||
    result.route_id !== routeId ||
    (result.source_check !== "osm" &&
      result.source_check !== "usgs" &&
      result.source_check !== "official")
  ) {
    throw new Error("approved result is not bound to this route and reviewer lease");
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
    numeric("core_coverage_pct") < 99 ||
    numeric("summit_max_gap_m") > 5 ||
    numeric("profile_point_count") < 2 ||
    numeric("profile_point_count") !== numeric("path_point_count") ||
    numeric("segment_count") < 1 ||
    numeric("matching_assembly_point_count") !== numeric("path_point_count")
  ) {
    throw new Error("approved measurements miss the source geometry thresholds");
  }
}

function candidateHttpsUrl(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  ) {
    throw new Error(`${label} must be a public HTTPS URL`);
  }
  return parsed.toString();
}

export function parseStandardRouteCandidateResult(
  result: JsonObject,
  destinationName: string,
  destinationCountryCode: string | null
): JsonObject {
  const topLevelKeys = [
    "access",
    "comparison",
    "discovery_checks",
    "geometry",
    "identity_conflicts",
    "identity_sources",
    "map_review",
    "official_source_attempts",
    "official_source_country_code",
    "route_name",
    "route_shape",
  ].sort();
  if (
    JSON.stringify(Object.keys(result).sort()) !==
    JSON.stringify(topLevelKeys)
  ) {
    throw new Error(
      `candidate result must contain exactly ${topLevelKeys.join(", ")}`
    );
  }
  if (
    typeof result.route_name !== "string" ||
    result.route_name.trim().length < 3
  ) {
    throw new Error("candidate_ready requires result.route_name");
  }
  const routeName = result.route_name.trim();
  if (
    result.route_shape !== "out_and_back" &&
    result.route_shape !== "loop" &&
    result.route_shape !== "lollipop"
  ) {
    throw new Error("candidate_ready requires a valid result.route_shape");
  }
  const routeShape = result.route_shape;
  if (
    !Array.isArray(result.identity_sources) ||
    result.identity_sources.length === 0
  ) {
    throw new Error("candidate_ready requires at least one identity source");
  }
  if (result.identity_sources.length > 4) {
    throw new Error("candidate_ready permits no more than four identity sources");
  }
  const identitySources: Array<{ type: string; url: string }> = [];
  for (const [index, source] of result.identity_sources.entries()) {
    identitySources.push(validateRouteIdentitySource(source, index));
  }
  const uniqueIdentitySources = new Set(
    identitySources.map((source) => `${source.type}\n${source.url}`)
  );
  if (uniqueIdentitySources.size !== identitySources.length) {
    throw new Error("candidate identity sources must be unique");
  }
  const strongSources = identitySources.filter(
    (source) => isStrongRouteIdentitySource(source.type)
  );
  if (strongSources.length === 0) {
    throw new Error(
      "candidate_ready requires a strong identity source beyond AllTrails and Peakbagger"
    );
  }
  const discoveryChecks = parseRouteDiscoveryChecks(
    result.discovery_checks,
    identitySources,
    { name: destinationName }
  );
  const identityConflicts = result.identity_conflicts ?? [];
  if (!Array.isArray(identityConflicts) || identityConflicts.length > 2) {
    throw new Error("candidate identity_conflicts must contain at most two entries");
  }
  const parsedIdentityConflicts: Array<{ url: string; note: string }> = [];
  for (const [index, rawConflict] of identityConflicts.entries()) {
    if (
      !rawConflict ||
      typeof rawConflict !== "object" ||
      Array.isArray(rawConflict)
    ) {
      throw new Error("candidate identity conflicts must be objects");
    }
    const conflict = rawConflict as JsonObject;
    if (
      JSON.stringify(Object.keys(conflict).sort()) !==
      JSON.stringify(["note", "url"])
    ) {
      throw new Error(
        `candidate identity_conflicts[${index}] must contain exactly url and note`
      );
    }
    const conflictUrl = candidateHttpsUrl(
      conflict.url,
      `candidate identity_conflicts[${index}].url`
    );
    if (
      typeof conflict.note !== "string" ||
      conflict.note.trim().length < 3 ||
      conflict.note.trim().length > 500
    ) {
      throw new Error("candidate identity conflict notes must contain 3 to 500 characters");
    }
    if (!identitySources.some((source) => source.url === conflictUrl)) {
      throw new Error("candidate identity conflict URLs must appear in identity_sources");
    }
    parsedIdentityConflicts.push({
      url: conflictUrl,
      note: conflict.note.trim(),
    });
  }
  const access =
    result.access &&
    typeof result.access === "object" &&
    !Array.isArray(result.access)
      ? (result.access as JsonObject)
      : {};
  if (
    JSON.stringify(Object.keys(access).sort()) !==
    JSON.stringify(["source_url", "status"])
  ) {
    throw new Error(
      "candidate access must contain exactly status and source_url"
    );
  }
  const accessStatuses = new Set([
    "open",
    "permit_required",
    "seasonal",
    "guide_required",
  ]);
  if (typeof access.status !== "string" || !accessStatuses.has(access.status)) {
    throw new Error(
      "candidate_ready requires access.status open, permit_required, seasonal, or guide_required"
    );
  }
  const accessSourceUrl = validateRouteAccessSource(
    access.source_url,
    identitySources
  );
  if (
    (access.status !== "open" || identityConflicts.length > 0) &&
    strongSources.length < 2
  ) {
    throw new Error(
      "access-controlled or disputed candidates require two strong identity sources"
    );
  }
  const comparison =
    result.comparison &&
    typeof result.comparison === "object" &&
    !Array.isArray(result.comparison)
      ? (result.comparison as JsonObject)
      : {};
  const comparisonKeys = Object.keys(comparison).sort();
  let parsedComparison: JsonObject;
  if (typeof comparison.private_reference_used !== "boolean") {
    throw new Error("candidate comparison.private_reference_used must be boolean");
  }
  if (comparison.private_reference_used) {
    if (
      JSON.stringify(comparisonKeys) !==
      JSON.stringify(["max_offset_m", "private_reference_used"])
    ) {
      throw new Error(
        "a used private comparison must contain exactly private_reference_used and max_offset_m"
      );
    }
    if (
      typeof comparison.max_offset_m !== "number" ||
      !Number.isFinite(comparison.max_offset_m) ||
      comparison.max_offset_m < 0 ||
      comparison.max_offset_m > 1_000_000
    ) {
      throw new Error(
        "candidate comparison.max_offset_m must be from 0 through 1000000"
      );
    }
    parsedComparison = {
      private_reference_used: true,
      max_offset_m: comparison.max_offset_m,
    };
  } else if (
    JSON.stringify(comparisonKeys) !==
    JSON.stringify(["private_reference_used"])
  ) {
    throw new Error(
      "an unused private comparison must contain only private_reference_used"
    );
  } else {
    parsedComparison = { private_reference_used: false };
  }
  const geometry =
    result.geometry &&
    typeof result.geometry === "object" &&
    !Array.isArray(result.geometry)
      ? (result.geometry as JsonObject)
      : {};
  if (
    JSON.stringify(Object.keys(geometry).sort()) !==
    JSON.stringify(["license", "source_kind", "source_url"])
  ) {
    throw new Error(
      "candidate geometry must contain exactly source_kind, source_url, and license"
    );
  }
  if (
    typeof geometry.source_kind !== "string" ||
    typeof geometry.source_url !== "string" ||
    typeof geometry.license !== "string"
  ) {
    throw new Error("candidate_ready requires geometry source and license");
  }
  const geometrySourceUrl = candidateHttpsUrl(
    geometry.source_url,
    "candidate geometry.source_url"
  );
  const sourceKind = String(geometry.source_kind);
  if (sourceKind === "openstreetmap") {
    const hostname = new URL(geometrySourceUrl).hostname.toLowerCase();
    if (
      geometry.license !== "ODbL 1.0" ||
      (hostname !== "openstreetmap.org" &&
        !hostname.endsWith(".openstreetmap.org"))
    ) {
      throw new Error(
        "OpenStreetMap candidate geometry must use the exact ODbL license and host"
      );
    }
  } else if (sourceKind === "usgs-national-map") {
    if (
      geometry.license !== "Public domain" ||
      new URL(geometrySourceUrl).hostname.toLowerCase() !==
        "partnerships.nationalmap.gov"
    ) {
      throw new Error(
        "USGS candidate geometry must use the exact public-domain license and host"
      );
    }
  } else {
    const officialSource = getPublishableArcgisTrailSource(sourceKind);
    if (geometry.license !== officialSource.license.name) {
      throw new Error(
        "candidate geometry must use an allowlisted publishable source"
      );
    }
  }
  const officialSourceCountryCode = assertOfficialSourceCountryBinding(
    result.official_source_country_code,
    { countryCode: destinationCountryCode }
  );
  const officialSourceAttempts = parseOfficialSourceAttempts(
    result.official_source_attempts,
    { countryCode: destinationCountryCode },
    { source_kind: sourceKind, source_url: geometrySourceUrl }
  );
  const mapReview =
    result.map_review &&
    typeof result.map_review === "object" &&
    !Array.isArray(result.map_review)
      ? (result.map_review as JsonObject)
      : {};
  if (
    JSON.stringify(Object.keys(mapReview).sort()) !==
    JSON.stringify(["notes", "passed"])
  ) {
    throw new Error(
      "candidate map_review must contain exactly passed and notes"
    );
  }
  if (mapReview.passed !== true) {
    throw new Error("candidate_ready requires a passing rendered-map review");
  }
  if (
    typeof mapReview.notes !== "string" ||
    mapReview.notes.trim().length < 3 ||
    mapReview.notes.trim().length > 500
  ) {
    throw new Error("candidate map_review.notes must contain 3 to 500 characters");
  }
  return {
    route_name: routeName,
    route_shape: routeShape,
    discovery_checks: discoveryChecks,
    official_source_country_code: officialSourceCountryCode,
    official_source_attempts: officialSourceAttempts,
    identity_sources: identitySources,
    identity_conflicts: parsedIdentityConflicts,
    geometry: {
      source_kind: sourceKind,
      source_url: geometrySourceUrl,
      license: geometry.license,
    },
    access: {
      status: access.status,
      source_url: accessSourceUrl,
    },
    comparison: parsedComparison,
    map_review: {
      passed: true,
      notes: mapReview.notes.trim(),
    },
  };
}

async function runSourceGeometryCheck(
  routeId: string,
  sourceKind: string,
  replacementRouteId: string | null
): Promise<void> {
  let script: string;
  if (sourceKind === "openstreetmap") {
    script =
      ".claude/skills/peaks-osm-route-approval/scripts/check_pending_osm_routes.mts";
  } else if (sourceKind === "usgs-national-map") {
    script =
      ".claude/skills/peaks-osm-route-approval/scripts/check_pending_usgs_routes.mts";
  } else {
    getPublishableArcgisTrailSource(sourceKind);
    script =
      ".claude/skills/peaks-osm-route-approval/scripts/check_pending_official_routes.mts";
  }
  const runtime = sourceCheckerRuntimePaths(
    __dirname,
    script
  );
  let stdout = "";
  try {
    const result = await execFileAsync(
      runtime.executable,
      sourceCheckerArgs(
        runtime.script,
        routeId,
        replacementRouteId
      ),
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
  destinationName: string,
  destinationCountryCode: string | null,
  artifactPath: string | null,
  routeId: string | null,
  blockerCode: string | null,
  message: string | null
): JsonObject {
  let validatedResult = result;
  if (!canTransition(from, to)) {
    throw new Error(`Illegal state transition: ${from} -> ${to}`);
  }
  if (to === "candidate_ready" && !artifactPath) {
    throw new Error("candidate_ready requires --artifact-path");
  }
  if (to === "candidate_ready") {
    validatedResult = parseStandardRouteCandidateResult(
      result,
      destinationName,
      destinationCountryCode
    );
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
  return validatedResult;
}

function rejectSplitImportTransition(to: JobState): void {
  if (to === "pending_review") {
    throw new Error(
      "The factory importer creates and binds pending_review in one transaction"
    );
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
  rejectSplitImportTransition(to);
  const artifactInput = flagValue(argv, "--artifact-path");
  const artifactPath = artifactInput
    ? resolveRouteArtifactPath(__dirname, artifactInput)
    : null;
  const routeId = flagValue(argv, "--route-id");
  if (routeId && !/^[A-Za-z0-9_-]+$/.test(routeId)) {
    throw new Error("--route-id contains unsupported characters");
  }
  const blockerCode = flagValue(argv, "--blocker-code");
  const message = flagValue(argv, "--message");
  const retryMinutes = positiveInteger(argv, "--retry-minutes", 1, 43_200);
  let resultJson = await readResult(argv);
  const reviewPacket = flagValue(argv, "--review-packet")
    ? await readRequiredJsonArtifact(argv, "--review-packet")
    : null;
  const sourceCheck = flagValue(argv, "--source-check")
    ? await readRequiredJsonArtifact(argv, "--source-check")
    : null;
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
      candidate: JsonObject;
      candidate_path: string | null;
      candidate_artifact: JsonObject | null;
      candidate_sha256: string | null;
      trailhead_id: string | null;
      published_route_id: string | null;
      replacement_route_id: string | null;
      destination_name: string;
      destination_country_code: string | null;
      lease_owner: string | null;
    }>(
      `SELECT state, candidate, candidate_path, candidate_artifact,
              candidate_sha256, trailhead_id, published_route_id,
              replacement_route_id, d.name AS destination_name,
              d.country_code AS destination_country_code, lease_owner
       FROM standard_route_backfill_jobs j
       JOIN destinations d ON d.id = j.destination_id
       WHERE j.destination_id = $1
         AND j.lease_token = $2
         AND j.lease_expires_at >= now()
       FOR UPDATE OF j`,
      [destinationId, token]
    );
    const currentJob = current.rows[0];
    const from = currentJob?.state;
    if (!from) throw new Error("Active job lease not found");
    if (to === "approved" || to === "published" || to === "verified") {
      assertOfficialSourceCountryBinding(
        currentJob.candidate.official_source_country_code,
        { countryCode: currentJob.destination_country_code }
      );
    }
    await requireRouteWorkerDatabaseRole(
      client,
      databaseRoleForTransition(from)
    );
    const reviewerLeaseOwner = reviewerLeaseOwnerForTransition(
      from,
      to,
      currentJob.lease_owner
    );
    if (reviewerLeaseOwner) {
      if (
        !routeId ||
        !reviewPacket ||
        !sourceCheck ||
        !currentJob.candidate_sha256
      ) {
        throw new Error(
          "review outcomes require the exact route, review packet, source check, and durable candidate checksum"
        );
      }
      resultJson = {
        ...resultJson,
        reviewer: reviewerLeaseOwner,
      };
      verifyRouteReviewAttestation({
        reviewPacket,
        reviewResult: resultJson,
        candidateResult: currentJob.candidate,
        sourceCheck,
        candidateSha256: currentJob.candidate_sha256,
        destinationId,
        routeId,
        reviewerId: reviewerLeaseOwner,
      });
    }
    if (
      routeId &&
      currentJob.published_route_id &&
      routeId !== currentJob.published_route_id &&
      !(from === "candidate_ready" && to === "pending_review")
    ) {
      throw new Error("Route ID does not match the route already saved on the job");
    }
    if (to === "pending_review") {
      const resultReplacementRouteId =
        typeof resultJson.replacement_route_id === "string"
          ? resultJson.replacement_route_id
          : null;
      if (resultReplacementRouteId !== currentJob.replacement_route_id) {
        throw new Error(
          "Importer replacement route does not match the durable job"
        );
      }
    }
    if (to === "approved") {
      if (!routeId) throw new Error("approved requires --route-id");
      const approvedRouteBinding = await assertPendingRouteMatchesCandidate(
        client,
        {
          routeId,
          destinationId,
          trailheadId: currentJob.trailhead_id,
          candidatePath: currentJob.candidate_path,
          candidateSha256: currentJob.candidate_sha256,
          candidateResult: currentJob.candidate,
          candidateArtifact: currentJob.candidate_artifact,
          importerResult: {
            route_name: currentJob.candidate.route_name,
          },
        }
      );
      const machine = await client.query<{
        passes: boolean;
        summit_max_gap_m: number | null;
        path_point_count: number;
        profile_point_count: number;
        segment_count: number;
      }>(
        `SELECT peaks_route_passes_publish_integrity(
                  r.id, $2, 'pending'
                ) AS passes,
                (
                  SELECT max(ST_Distance(r.path, summit.location))
                    FILTER (WHERE summit.location IS NOT NULL)
                  FROM route_destinations summit_rd
                  JOIN destinations summit
                    ON summit.id = summit_rd.destination_id
                  WHERE summit_rd.route_id = r.id
                    AND 'summit'::destination_feature = ANY(summit.features)
                ) AS summit_max_gap_m,
                ST_NPoints(r.path::geometry)::int AS path_point_count,
                CASE WHEN r.elevation_string IS NOT NULL
                           AND r.elevation_string = encode_route_elevation_profile(r.path)
                     THEN ST_NPoints(r.path::geometry)::int ELSE 0 END
                  AS profile_point_count,
                (
                  SELECT count(*)::int FROM route_segments rs
                  WHERE rs.route_id = r.id
                ) AS segment_count
         FROM routes r
         WHERE r.id = $1
         FOR UPDATE OF r`,
        [routeId, destinationId]
      );
      const checked = machine.rows[0];
      if (checked?.passes !== true || checked.summit_max_gap_m === null) {
        throw new Error(
          "approved route failed machine summit, elevation, provenance, or segment assembly gates"
        );
      }
      const reviewGates =
        resultJson.gates &&
        typeof resultJson.gates === "object" &&
        !Array.isArray(resultJson.gates)
          ? (resultJson.gates as JsonObject)
          : {};
      const reviewMeasurements =
        resultJson.measurements &&
        typeof resultJson.measurements === "object" &&
        !Array.isArray(resultJson.measurements)
          ? (resultJson.measurements as JsonObject)
          : {};
      resultJson = {
        ...resultJson,
        approved_route_binding: approvedRouteBinding,
        gates: {
          ...reviewGates,
          summit_contact: true,
          elevation_profile: true,
          segment_assembly: true,
        },
        measurements: {
          ...reviewMeasurements,
          summit_max_gap_m: checked.summit_max_gap_m,
          path_point_count: checked.path_point_count,
          profile_point_count: checked.profile_point_count,
          segment_count: checked.segment_count,
          matching_assembly_point_count: checked.path_point_count,
        },
      };
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
    resultJson = validateTransitionPayload(
      from,
      to,
      resultJson,
      currentJob.destination_name,
      currentJob.destination_country_code,
      artifactPath,
      routeId,
      blockerCode,
      message
    );
    if (to === "pending_review") {
      if (!routeId) {
        throw new Error("pending_review requires --route-id");
      }
      await assertPendingRouteMatchesCandidate(client, {
        routeId,
        destinationId,
        trailheadId: currentJob.trailhead_id,
        candidatePath: currentJob.candidate_path,
        candidateSha256: currentJob.candidate_sha256,
        candidateResult: currentJob.candidate,
        candidateArtifact: currentJob.candidate_artifact,
        importerResult: resultJson,
      });
    }
    if (to === "published") {
      if (!routeId) {
        throw new Error("published requires --route-id");
      }
      await assertPendingRouteMatchesCandidate(client, {
        routeId,
        destinationId,
        trailheadId: currentJob.trailhead_id,
        candidatePath: currentJob.candidate_path,
        candidateSha256: currentJob.candidate_sha256,
        candidateResult: currentJob.candidate,
        candidateArtifact: currentJob.candidate_artifact,
        importerResult: {
          route_name: currentJob.candidate.route_name,
        },
      });
    }
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
        publish_integrity_valid: boolean;
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
                peaks_route_passes_publish_integrity(
                  r.id,
                  $2,
                  $4
                ) AS publish_integrity_valid,
                r.provenance->>'source_kind' AS source_kind
         FROM routes r
         WHERE r.id = $1`,
        [routeId, destinationId, currentJob.trailhead_id, expectedStatus]
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
        if (!route.publish_integrity_valid) {
          throw new Error(
            "approved route failed machine summit, elevation, provenance, or segment assembly gates"
          );
        }
        await runSourceGeometryCheck(
          routeId,
          route.source_kind,
          currentJob.replacement_route_id
        );
      }
    }

    const resultField =
      to === "candidate_ready"
        ? "candidate"
        : reviewerLeaseOwner
          ? "review"
          : "evidence";
    const updated = await client.query<{
      destination_id: string;
      state: JobState;
      trailhead_id: string | null;
      candidate_path: string | null;
      candidate_sha256: string | null;
      published_route_id: string | null;
      replacement_route_id: string | null;
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
                 candidate_sha256, published_route_id, replacement_route_id`,
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
       AND lease_expires_at >= now()
       AND state = 'candidate_ready'`,
    [destinationId, token]
  );
  const artifact = result.rows[0]?.candidate_artifact;
  const expectedHash = result.rows[0]?.candidate_sha256;
  if (!artifact || !expectedHash) {
    throw new Error(
      "materialize requires an active candidate_ready import-stage lease " +
        "with a saved artifact; claim import after the research turn ends"
    );
  }
  const contents = `${canonicalJson(artifact)}\n`;
  const actualHash = createHash("sha256")
    .update(canonicalJson(artifact))
    .digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error("Saved candidate checksum does not match");
  }
  const outputPath = resolveRouteArtifactPath(__dirname, output);
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

async function materializeResult(argv: string[]): Promise<void> {
  const destinationId = requireId(argv, "--destination-id");
  const token = requireId(argv, "--lease-token");
  const kind = flagValue(argv, "--kind");
  const output = flagValue(argv, "--output");
  if (kind !== "candidate") {
    throw new Error("--kind must be candidate");
  }
  if (!output) throw new Error("--output is required");
  const result = await db.query<{ candidate: JsonObject }>(
    `SELECT candidate
     FROM standard_route_backfill_jobs
     WHERE destination_id = $1
       AND lease_token = $2
       AND lease_expires_at >= now()
       AND state = 'pending_review'`,
    [destinationId, token]
  );
  const saved = result.rows[0]?.candidate;
  if (
    !saved ||
    typeof saved !== "object" ||
    Array.isArray(saved) ||
    Object.keys(saved).length === 0
  ) {
    throw new Error(
      "materialize-result requires an active pending_review lease with a saved candidate result"
    );
  }
  const contents = `${canonicalJson(saved)}\n`;
  const outputPath = resolveRouteArtifactPath(__dirname, output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  let reused = false;
  try {
    await fs.writeFile(outputPath, contents, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = JSON.parse(await fs.readFile(outputPath, "utf8"));
    if (canonicalJson(existing) !== canonicalJson(saved)) {
      throw new Error(
        "Existing materialized candidate result differs from the durable queue"
      );
    }
    reused = true;
  }
  print({
    destination_id: destinationId,
    kind,
    output: outputPath,
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

async function verifyJob(argv: string[]): Promise<void> {
  if (!argv.includes("--apply")) throw new Error("verify requires --apply");
  const destinationId = requireId(argv, "--destination-id");
  const token = requireId(argv, "--lease-token");
  const retryMinutes = positiveInteger(argv, "--retry-minutes", 30, 1_440);
  const current = await db.query<{
    state: JobState;
    trailhead_id: string | null;
    published_route_id: string | null;
    candidate: JsonObject;
    destination_country_code: string | null;
  }>(
    `SELECT state, trailhead_id, published_route_id, candidate,
            d.country_code AS destination_country_code
     FROM standard_route_backfill_jobs j
     JOIN destinations d ON d.id = j.destination_id
     WHERE j.destination_id = $1
       AND j.lease_token = $2
       AND j.lease_expires_at >= now()`,
    [destinationId, token]
  );
  const job = current.rows[0];
  if (
    job?.state !== "published" ||
    !job.trailhead_id ||
    !job.published_route_id
  ) {
    throw new Error(
      "verify requires a leased published job with route and trailhead"
    );
  }
  assertOfficialSourceCountryBinding(
    job.candidate.official_source_country_code,
    { countryCode: job.destination_country_code }
  );

  const verification = await verifyStandardRoute(db, {
    routeId: job.published_route_id,
    destinationId,
    trailheadId: job.trailhead_id,
  });
  const action = verificationAction(verification);
  const nextState =
    action === "verified"
      ? "verified"
      : action === "rebuild"
        ? "needs_revision"
        : action === "needs_human"
          ? "needs_human"
          : "published";
  const blockerCode =
    action === "needs_human" ? "active_route_integrity_conflict" : null;
  const blockerMessage =
    action === "needs_human"
      ? `Active route failed ownership, activation, or destination-order gates: ${verification.errors.join(", ")}`
      : null;
  const lastError =
    action === "retry"
      ? `Public route verification did not match; retrying: ${verification.errors.join(", ")}`
      : null;

  const updated = await db.query<{
    destination_id: string;
    state: JobState;
    next_attempt_at: string;
  }>(
    `UPDATE standard_route_backfill_jobs
     SET state = $3,
         replacement_route_id = CASE
           WHEN $5 = 'rebuild' THEN published_route_id
           ELSE replacement_route_id
         END,
         evidence = evidence || jsonb_build_object(
           'last_verification', $4::jsonb,
           'verification_action', $5::text
         ),
         candidate_artifact = CASE
           WHEN $3 = 'verified' THEN NULL
           ELSE candidate_artifact
         END,
         blocker_code = $6,
         blocker_message = $7,
         last_error = $8,
         next_attempt_at = CASE
           WHEN $5 = 'retry'
             THEN now() + ($9::text || ' minutes')::interval
           ELSE now()
         END,
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = now()
     WHERE destination_id = $1
       AND lease_token = $2
       AND state = 'published'
     RETURNING destination_id, state, next_attempt_at`,
    [
      destinationId,
      token,
      nextState,
      JSON.stringify(verification),
      action,
      blockerCode,
      blockerMessage,
      lastError,
      retryMinutes,
    ]
  );
  if (!updated.rows[0]) {
    throw new Error("Published job lease changed during verify");
  }
  print({ action, ...updated.rows[0], verification });
}

type DiscoveryCutoverJob = {
  destination_id: string;
  state: "candidate_ready" | "pending_review";
  candidate: JsonObject;
  candidate_path: string | null;
  candidate_artifact: JsonObject | null;
  candidate_sha256: string | null;
  trailhead_id: string | null;
  published_route_id: string | null;
  replacement_route_id: string | null;
};

function lacksDiscoveryChecks(candidate: JsonObject): boolean {
  return (
    !candidate.discovery_checks ||
    typeof candidate.discovery_checks !== "object" ||
    Array.isArray(candidate.discovery_checks)
  );
}

async function markDiscoveryCutoverHuman(
  client: import("pg").PoolClient,
  job: DiscoveryCutoverJob,
  reason: string
): Promise<void> {
  await client.query(
    `UPDATE standard_route_backfill_jobs
     SET state = 'needs_human',
         evidence = evidence || jsonb_build_object(
           'discovery_checks_cutover', jsonb_build_object(
             'at', clock_timestamp(),
             'action', 'preserved_unbound_pending_route'
           )
         ),
         blocker_code = 'discovery_cutover_unbound_pending_route',
         blocker_message = $2,
         last_error = NULL,
         next_attempt_at = now(),
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = now()
     WHERE destination_id = $1`,
    [job.destination_id, reason]
  );
}

async function resetDiscoveryCutoverJob(
  client: import("pg").PoolClient,
  job: DiscoveryCutoverJob,
  retainedActiveRouteId: string | null,
  removedPendingRouteId: string | null
): Promise<void> {
  await client.query(
    `UPDATE standard_route_backfill_jobs
     SET state = 'queued',
         evidence = evidence || jsonb_build_object(
           'discovery_checks_cutover', jsonb_build_object(
             'at', clock_timestamp(),
             'action', 'reset_for_discovery_checks',
             'removed_pending_route_id', $2::text
           )
         ),
         candidate = '{}'::jsonb,
         review = '{}'::jsonb,
         trailhead_id = NULL,
         candidate_path = NULL,
         candidate_sha256 = NULL,
         candidate_artifact = NULL,
         published_route_id = $3,
         replacement_route_id = $3,
         blocker_code = NULL,
         blocker_message = NULL,
         last_error = NULL,
         next_attempt_at = now(),
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = now()
     WHERE destination_id = $1`,
    [job.destination_id, removedPendingRouteId, retainedActiveRouteId]
  );
}

async function cutoverDiscoveryChecks(argv: string[]): Promise<void> {
  const apply = argv.includes("--apply");
  const preview = await db.query<
    DiscoveryCutoverJob & { published_route_status: string | null }
  >(
    `SELECT j.destination_id, j.state, j.candidate, j.candidate_path,
            j.candidate_artifact, j.candidate_sha256, j.trailhead_id,
            j.published_route_id, j.replacement_route_id,
            published.status AS published_route_status
     FROM standard_route_backfill_jobs j
     LEFT JOIN routes published ON published.id = j.published_route_id
     WHERE j.state IN ('candidate_ready', 'pending_review')
       AND (
         NOT (j.candidate ? 'discovery_checks')
         OR jsonb_typeof(j.candidate->'discovery_checks') IS DISTINCT FROM 'object'
       )
     ORDER BY j.destination_id`
  );
  if (!apply) {
    print({
      mode: "dry_run",
      incompatible: preview.rowCount,
      jobs: preview.rows.map((job) => ({
        destination_id: job.destination_id,
        state: job.state,
        published_route_id: job.published_route_id,
        published_route_status: job.published_route_status,
      })),
    });
    return;
  }

  const client = await db.connect();
  let reset = 0;
  let pendingRoutesRemoved = 0;
  let needsHuman = 0;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const locked = await client.query<DiscoveryCutoverJob>(
      `SELECT destination_id, state, candidate, candidate_path,
              candidate_artifact, candidate_sha256, trailhead_id,
              published_route_id, replacement_route_id
       FROM standard_route_backfill_jobs
       WHERE state IN ('candidate_ready', 'pending_review')
         AND (
           NOT (candidate ? 'discovery_checks')
           OR jsonb_typeof(candidate->'discovery_checks') IS DISTINCT FROM 'object'
         )
       ORDER BY destination_id
       FOR UPDATE`
    );

    for (const job of locked.rows) {
      if (!lacksDiscoveryChecks(job.candidate)) continue;
      let retainedActiveRouteId: string | null = null;
      if (job.replacement_route_id) {
        const replacement = await client.query<{
          owner: string;
          status: string;
          destination_linked: boolean;
        }>(
          `SELECT r.owner, r.status,
                  EXISTS (
                    SELECT 1 FROM route_destinations rd
                    WHERE rd.route_id = r.id AND rd.destination_id = $2
                  ) AS destination_linked
           FROM routes r
           WHERE r.id = $1
           FOR UPDATE`,
          [job.replacement_route_id, job.destination_id]
        );
        const route = replacement.rows[0];
        if (
          route?.owner !== "peaks" ||
          route.status !== "active" ||
          !route.destination_linked
        ) {
          await markDiscoveryCutoverHuman(
            client,
            job,
            "Legacy job names a replacement route that is not the linked active Peaks route."
          );
          needsHuman += 1;
          continue;
        }
        retainedActiveRouteId = job.replacement_route_id;
      }

      if (!job.published_route_id) {
        await resetDiscoveryCutoverJob(
          client,
          job,
          retainedActiveRouteId,
          null
        );
        reset += 1;
        continue;
      }

      // Hold the parent row before counting children. Foreign-key inserts need
      // a conflicting key-share lock, so no new cascading reference can appear
      // between these checks and the guarded delete.
      await client.query(
        `SELECT id FROM routes WHERE id = $1 FOR UPDATE`,
        [job.published_route_id]
      );
      const routeResult = await client.query<{
        owner: string;
        status: string;
        destination_count: number;
        destination_linked: boolean;
        trailhead_first: boolean;
        queue_reference_count: number;
        external_reference_count: number;
      }>(
        `SELECT r.owner, r.status,
                (SELECT count(*)::int FROM route_destinations rd
                 WHERE rd.route_id = r.id) AS destination_count,
                EXISTS (
                  SELECT 1 FROM route_destinations rd
                  WHERE rd.route_id = r.id AND rd.destination_id = $2
                ) AS destination_linked,
                EXISTS (
                  SELECT 1 FROM route_destinations rd
                  WHERE rd.route_id = r.id
                    AND rd.destination_id = $3 AND rd.ordinal = 0
                ) AS trailhead_first,
                (SELECT count(*)::int FROM standard_route_backfill_jobs other
                 WHERE other.published_route_id = r.id) AS queue_reference_count,
                (
                  (SELECT count(*) FROM route_areas item
                   WHERE item.route_id = r.id) +
                  (SELECT count(*) FROM plan_routes item
                   WHERE item.route_id = r.id) +
                  (SELECT count(*) FROM session_routes item
                   WHERE item.route_id = r.id) +
                  (SELECT count(*) FROM trip_report_routes item
                   WHERE item.route_id = r.id) +
                  (SELECT count(*) FROM route_elevation_backfill_jobs item
                   WHERE item.route_id = r.id) +
                  (SELECT count(*) FROM route_integrity_repairs item
                   WHERE item.route_id = r.id
                      OR item.replacement_route_id = r.id) +
                  (SELECT count(*) FROM standard_route_backfill_jobs other
                   WHERE other.destination_id <> $2
                     AND (other.published_route_id = r.id
                       OR other.replacement_route_id = r.id))
                )::int AS external_reference_count
         FROM routes r
         WHERE r.id = $1`,
        [job.published_route_id, job.destination_id, job.trailhead_id]
      );
      const route = routeResult.rows[0];
      if (!route) {
        await resetDiscoveryCutoverJob(
          client,
          job,
          retainedActiveRouteId,
          null
        );
        reset += 1;
        continue;
      }
      if (
        job.state === "candidate_ready" &&
        route.owner === "peaks" &&
        route.status === "active" &&
        route.destination_linked
      ) {
        if (
          retainedActiveRouteId &&
          retainedActiveRouteId !== job.published_route_id
        ) {
          await markDiscoveryCutoverHuman(
            client,
            job,
            "Legacy candidate names two different active route bindings."
          );
          needsHuman += 1;
          continue;
        }
        const activeId = job.published_route_id;
        await resetDiscoveryCutoverJob(client, job, activeId, null);
        reset += 1;
        continue;
      }
      if (
        route.owner !== "peaks" ||
        route.status !== "pending" ||
        !route.destination_linked ||
        !route.trailhead_first ||
        route.destination_count !== 2 ||
        route.queue_reference_count !== 1 ||
        route.external_reference_count !== 0
      ) {
        await markDiscoveryCutoverHuman(
          client,
          job,
          "Legacy pending route is not an exclusive, exact factory route; it was preserved."
        );
        needsHuman += 1;
        continue;
      }

      try {
        await assertPendingRouteMatchesCandidate(client, {
          routeId: job.published_route_id,
          destinationId: job.destination_id,
          trailheadId: job.trailhead_id,
          candidatePath: job.candidate_path,
          candidateSha256: job.candidate_sha256,
          candidateResult: job.candidate,
          candidateArtifact: job.candidate_artifact,
          importerResult: {
            route_name: job.candidate.route_name,
          },
        });
      } catch {
        await markDiscoveryCutoverHuman(
          client,
          job,
          "Legacy pending route does not match its saved candidate; it was preserved."
        );
        needsHuman += 1;
        continue;
      }

      const segments = await client.query<{ segment_id: string }>(
        `SELECT rs.segment_id
         FROM route_segments rs
         WHERE rs.route_id = $1`,
        [job.published_route_id]
      );
      const deleted = await client.query(
        `DELETE FROM routes
         WHERE id = $1 AND owner = 'peaks' AND status = 'pending'
         RETURNING id`,
        [job.published_route_id]
      );
      if (deleted.rows.length !== 1) {
        throw new Error("Legacy pending route changed during discovery cutover");
      }
      if (segments.rows.length > 0) {
        await client.query(
          `DELETE FROM segments s
           WHERE s.id = ANY($1::text[])
             AND NOT EXISTS (
               SELECT 1 FROM route_segments rs WHERE rs.segment_id = s.id
             )`,
          [segments.rows.map((row) => row.segment_id)]
        );
      }
      await resetDiscoveryCutoverJob(
        client,
        job,
        retainedActiveRouteId,
        job.published_route_id
      );
      pendingRoutesRemoved += 1;
      reset += 1;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  print({
    mode: "apply",
    incompatible: preview.rowCount,
    reset,
    pending_routes_removed: pendingRoutesRemoved,
    needs_human: needsHuman,
  });
}

async function recoverLegacy(argv: string[]): Promise<void> {
  const apply = argv.includes("--apply");
  const predicate = `
    j.state = 'needs_human'
    AND j.blocker_code = 'active_route_missing_provenance_segments'
    AND r.owner = 'peaks'
    AND r.status = 'active'
    AND (
      NOT is_valid_route_provenance(r.provenance)
      OR NOT EXISTS (
        SELECT 1
        FROM route_segments rs
        JOIN segments s ON s.id = rs.segment_id
        WHERE rs.route_id = r.id
          AND s.path IS NOT NULL
          AND s.provenance IS NOT DISTINCT FROM r.provenance
      )
    )`;
  if (!apply) {
    const result = await db.query<{
      destination_id: string;
      published_route_id: string;
    }>(
      `SELECT j.destination_id, j.published_route_id
       FROM standard_route_backfill_jobs j
       JOIN routes r ON r.id = j.published_route_id
       WHERE ${predicate}
       ORDER BY j.destination_id`
    );
    print({ mode: "dry_run", recoverable: result.rowCount, jobs: result.rows });
    return;
  }
  const result = await db.query<{ destination_id: string; state: JobState }>(
    `UPDATE standard_route_backfill_jobs j
     SET state = 'queued',
         replacement_route_id = j.published_route_id,
         evidence = evidence || jsonb_build_object(
           'legacy_recovery_at', now(),
           'legacy_recovery_reason',
           'Rebuild active route with factory provenance and segments'
         ),
         blocker_code = NULL,
         blocker_message = NULL,
         last_error = NULL,
         next_attempt_at = now(),
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = now()
     FROM routes r
     WHERE r.id = j.published_route_id
       AND ${predicate}
     RETURNING j.destination_id, j.state`
  );
  print({ mode: "apply", recovered: result.rowCount, jobs: result.rows });
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
  if (!fromValue || !isJobState(fromValue)) {
    throw new Error("--from must be a valid route job state");
  }
  const targetState = humanRequeueTargetState(fromValue);
  if (!targetState) {
    throw new Error(
      "--from must be needs_revision, waiting_rights, waiting_access, or needs_human"
    );
  }
  if (!reason || reason.trim().length < 12) {
    throw new Error("--reason must explain the human decision");
  }
  const result = await db.query<{ destination_id: string; state: JobState }>(
    `UPDATE standard_route_backfill_jobs
     SET state = $3,
         evidence = evidence || jsonb_build_object(
           'requeued_at', now(),
           'requeue_reason', $4::text
         ),
         blocker_code = NULL,
         blocker_message = NULL,
         last_error = NULL,
         next_attempt_at = now(),
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = now()
     WHERE destination_id = $1
       AND state = $2
       AND (
         $2 <> 'needs_revision'
         OR EXISTS (
           SELECT 1
           FROM routes r
           WHERE r.id = standard_route_backfill_jobs.published_route_id
             AND r.owner = 'peaks'
             AND r.status = 'pending'
         )
       )
     RETURNING destination_id, state`,
    [destinationId, fromValue, targetState, reason.trim()]
  );
  if (!result.rows[0]) {
    throw new Error(
      "Job did not match --from or lacks the pending route required for review"
    );
  }
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
  print(
    result.rows.map(({ lease_token: _leaseToken, ...job }) => job)
  );
}

async function stats(): Promise<void> {
  printGoalStats(await loadGoalStats(25), { popularity_threshold: 25 });
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
    case "materialize-result":
      await materializeResult(argv);
      break;
    case "check-import-lease":
      await checkImportLease(argv);
      break;
    case "verify":
      await verifyJob(argv);
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
    case "cutover-discovery-checks":
      await cutoverDiscoveryChecks(argv);
      break;
    case "recover-legacy":
      await recoverLegacy(argv);
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

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ error: message }));
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.end();
    });
}
