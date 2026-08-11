#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import db from "./db";

type AuditState =
  | "queued"
  | "auditing"
  | "passed"
  | "needs_repair"
  | "needs_human"
  | "out_of_scope";

type AuditCandidate = Pick<
  AuditJob,
  "destination_id" | "destination_name" | "priority" | "route_count" |
  "catalog_fingerprint" | "audit_rule_version"
>;

interface AuditJob {
  destination_id: string;
  destination_name: string;
  state: AuditState;
  priority: number;
  route_count: number;
  audit_rule_version: number;
  catalog_fingerprint: string;
  attempt_count: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  final_result: Record<string, unknown> | null;
  audited_at: string | null;
  updated_at: string;
}

export interface AuditLeaseLossRow {
  destination_exists: boolean;
  job_exists: boolean;
  live_worker_lease: boolean;
}

export type AuditLeaseLossOutcome =
  | "destination_deleted"
  | "job_missing"
  | "lease_missing"
  | "lease_live";

const AUDIT_RULE_VERSION = 3;
const MAX_LEASE_MINUTES = 30;
export const STALE_ELEVATION_REASON = "elevation_profile_format_changed";

export function buildCandidateSql(staleElevationOnly = false): string {
  const staleRouteScope = staleElevationOnly ? `
      AND EXISTS (
        SELECT 1
        FROM route_destinations stale_route_destination
        JOIN stale_elevation_jobs stale_job
          ON stale_job.destination_id = stale_route_destination.destination_id
        WHERE stale_route_destination.route_id = r.id
      )` : "";
  const staleDestinationScope = staleElevationOnly ? `
  JOIN stale_elevation_jobs stale_job ON stale_job.destination_id = d.id` : "";
  return `
  WITH catalog_routes AS (
    SELECT r.*
    FROM routes r
    WHERE r.owner = 'peaks'
      AND (
        r.status = 'active'
        OR (
          r.status = 'superseded'
          AND r.id ~ '^osm-route-[0-9]+-[0-9a-f]{10}$'
          AND r.provenance IS NULL
          AND r.completion = 'none'
          AND r.shape IS NULL
          AND r.gain IS NULL
          AND r.gain_loss IS NULL
          AND jsonb_typeof(r.external_links) = 'array'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(r.external_links) link
            WHERE link->>'type' = 'osm'
              AND link->>'id' ~ '^relation/[0-9]+$'
          )
          AND NOT EXISTS (
            SELECT 1 FROM route_segments rs WHERE rs.route_id = r.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM route_destinations rd
            JOIN destinations linked_destination
              ON linked_destination.id = rd.destination_id
            WHERE rd.route_id = r.id
              AND 'trailhead'::destination_feature =
                  ANY(linked_destination.features)
          )
        )
      )${staleRouteScope}
  )
  SELECT
    d.id AS destination_id,
    d.name AS destination_name,
    COUNT(DISTINCT r.id)::int AS route_count,
    ${AUDIT_RULE_VERSION}::int AS audit_rule_version,
    (
      COUNT(*) FILTER (WHERE r.provenance IS NULL) * 100
      + COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM route_segments rs WHERE rs.route_id = r.id
          )
        ) * 100
      + COUNT(*) FILTER (WHERE r.distance > 25000) * 50
      + COALESCE(SUM((
          SELECT COUNT(*)
          FROM route_destinations summit_link
          JOIN destinations summit ON summit.id = summit_link.destination_id
          WHERE summit_link.route_id = r.id
            AND 'summit'::destination_feature = ANY(summit.features)
            AND (
              r.path IS NULL
              OR summit.location IS NULL
              OR ST_Distance(r.path, summit.location) > 5
            )
        )), 0)::int * 200
      + COUNT(*) FILTER (
          WHERE r.path IS NULL
             OR r.elevation_string IS NULL
             OR r.elevation_string IS DISTINCT FROM
                encode_route_elevation_profile(r.path)
             OR NOT route_elevation_profile_has_real_range(r.path)
        ) * 200
      + COUNT(*) FILTER (
          WHERE r.path IS NULL
             OR EXISTS (
               SELECT 1
               FROM route_elevation_stats(r.path) elevation_stats
               WHERE r.gain IS DISTINCT FROM elevation_stats.gain
                  OR r.gain_loss IS DISTINCT FROM elevation_stats.loss
             )
        ) * 200
      + COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM route_segments rs
            JOIN segments s ON s.id = rs.segment_id
            CROSS JOIN LATERAL route_elevation_stats(s.path) elevation_stats
            WHERE rs.route_id = r.id
              AND (
                s.gain IS DISTINCT FROM elevation_stats.gain
                OR s.gain_loss IS DISTINCT FROM elevation_stats.loss
              )
          )
        ) * 200
      + GREATEST(COUNT(DISTINCT r.id) - 1, 0) * 10
    )::int AS priority,
    md5(string_agg(
      concat_ws(
        ':',
        d.name,
        d.updated_at::text,
        'audit_rule_version',
        ${AUDIT_RULE_VERSION}::text,
        r.id,
        r.status,
        r.updated_at::text,
        COALESCE(r.elevation_string, ''),
        COALESCE(r.gain::text, ''),
        COALESCE(r.gain_loss::text, ''),
        COALESCE((
          SELECT string_agg(
            concat_ws(
              ':',
              linked.ordinal::text,
              linked_destination.id,
              linked_destination.name,
              linked_destination.updated_at::text
            ),
            ',' ORDER BY linked.ordinal, linked_destination.id
          )
          FROM route_destinations linked
          JOIN destinations linked_destination
            ON linked_destination.id = linked.destination_id
          WHERE linked.route_id = r.id
        ), ''),
        COALESCE((
          SELECT string_agg(
            concat_ws(
              ':',
              route_segment.ordinal::text,
              route_segment.direction,
              segment.id,
              COALESCE(encode(ST_AsEWKB(segment.path::geometry), 'hex'), ''),
              COALESCE(segment.provenance::text, ''),
              COALESCE(encode_route_elevation_profile(segment.path), ''),
              COALESCE(segment.gain::text, ''),
              COALESCE(segment.gain_loss::text, '')
            ),
            ',' ORDER BY route_segment.ordinal, segment.id
          )
          FROM route_segments route_segment
          JOIN segments segment ON segment.id = route_segment.segment_id
          WHERE route_segment.route_id = r.id
        ), '')
      ),
      '|' ORDER BY r.id
    )) AS catalog_fingerprint
  FROM destinations d
  ${staleDestinationScope}
  JOIN route_destinations rd ON rd.destination_id = d.id
  JOIN catalog_routes r ON r.id = rd.route_id
  WHERE 'summit'::destination_feature = ANY(d.features)
  GROUP BY d.id, d.name, d.updated_at`;
}

export const candidateSql = buildCandidateSql();
export const staleElevationCandidateSql = buildCandidateSql(true);
export const staleElevationJobScopeSql = `
  SELECT destination_id
  FROM route_catalog_audit_jobs
  WHERE final_result->>'stale_reason' = '${STALE_ELEVATION_REASON}'`;

export const staleElevationSeedSql = `
  WITH stale_elevation_jobs AS MATERIALIZED (
    ${staleElevationJobScopeSql}
  ), candidates AS MATERIALIZED (
    ${staleElevationCandidateSql}
  )
  UPDATE route_catalog_audit_jobs AS job
  SET destination_name = CASE WHEN candidate.destination_id IS NULL
        THEN job.destination_name ELSE candidate.destination_name END,
      priority = CASE WHEN candidate.destination_id IS NULL
        THEN job.priority ELSE candidate.priority END,
      route_count = CASE WHEN candidate.destination_id IS NULL
        THEN job.route_count ELSE candidate.route_count END,
      audit_rule_version = CASE WHEN candidate.destination_id IS NULL
        THEN job.audit_rule_version ELSE candidate.audit_rule_version END,
      catalog_fingerprint = CASE WHEN candidate.destination_id IS NULL
        THEN job.catalog_fingerprint ELSE candidate.catalog_fingerprint END,
      state = CASE
        WHEN candidate.destination_id IS NULL THEN 'out_of_scope'
        ELSE 'queued'
      END,
      final_result = CASE
        WHEN candidate.destination_id IS NULL THEN jsonb_build_object(
          'outcome', 'out_of_scope',
          'reason', 'no active or quarantined legacy route remains',
          'reconciled_stale_reason', '${STALE_ELEVATION_REASON}'
        )
        ELSE NULL
      END,
      audited_at = NULL,
      last_error = NULL,
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  FROM stale_elevation_jobs stale_job
  LEFT JOIN candidates candidate
    ON candidate.destination_id = stale_job.destination_id
  WHERE job.destination_id = stale_job.destination_id
    AND job.state <> 'auditing'
  RETURNING job.destination_id,
            job.state,
            candidate.destination_id IS NOT NULL AS candidate_found`;

export const auditLeaseLossSql = `
  SELECT EXISTS (
           SELECT 1 FROM destinations WHERE id = $1
         ) AS destination_exists,
         EXISTS (
           SELECT 1
           FROM route_catalog_audit_jobs
           WHERE destination_id = $1
         ) AS job_exists,
         EXISTS (
           SELECT 1
           FROM route_catalog_audit_jobs
           WHERE destination_id = $1
             AND state = 'auditing'
             AND lease_owner = $2
             AND lease_expires_at >= now()
         ) AS live_worker_lease`;

export function classifyAuditLeaseLoss(
  row: AuditLeaseLossRow
): AuditLeaseLossOutcome {
  if (!row.destination_exists && !row.job_exists) return "destination_deleted";
  if (row.live_worker_lease) return "lease_live";
  if (!row.job_exists) return "job_missing";
  return "lease_missing";
}

function usage(exitCode = 2): never {
  console.error(`Usage:
  npm run routes:audit-jobs -- seed [--apply]
      [--stale-elevation-only]
  npm run routes:audit-jobs -- claim --worker-id ID [--destination-id ID]
      [--lease-minutes 30] --apply
  npm run routes:audit-jobs -- heartbeat (--lease-token TOKEN | --worker-id ID)
      [--lease-minutes 30]
  npm run routes:audit-jobs -- complete --destination-id ID
      (--lease-token TOKEN | --worker-id ID)
      --state passed|needs_repair|needs_human --result-file FILE --apply
  npm run routes:audit-jobs -- release (--lease-token TOKEN | --worker-id ID)
      [--message TEXT]
  npm run routes:audit-jobs -- diagnose-loss --destination-id ID --worker-id ID
  npm run routes:audit-jobs -- requeue --destination-id ID --reason TEXT --apply
  npm run routes:audit-jobs -- show [--destination-id ID] [--state STATE] [--limit 20]
  npm run routes:audit-jobs -- stats

--stale-elevation-only is valid only with seed --apply and reconciles only jobs
marked stale by the elevation precision migration. Seed and claim are dry-run
unless --apply is present. Complete requires --apply.`);
  process.exit(exitCode);
}

function flagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

async function readAuditResultFile(filePath: string): Promise<string> {
  const absolutePath = path.resolve(filePath);
  const lexicalParent = path.dirname(absolutePath);
  if (lexicalParent !== "/tmp" && lexicalParent !== "/private/tmp") {
    throw new Error("--result-file must be a direct system temp file");
  }
  const fileName = path.basename(absolutePath);
  if (!/^peaks-route-audit-[A-Za-z0-9][A-Za-z0-9._-]*\.result\.json$/.test(fileName)) {
    throw new Error("--result-file name is not approved");
  }
  const physicalParent = await fs.realpath(lexicalParent);
  if (physicalParent !== "/tmp" && physicalParent !== "/private/tmp") {
    throw new Error("System temp root resolved unexpectedly");
  }
  const handle = await fs.open(
    path.join(physicalParent, fileName),
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

function positiveInteger(argv: string[], flag: string, fallback: number): number {
  const raw = flagValue(argv, flag);
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 1440) {
    throw new Error(`${flag} must be an integer from 1 through 1440`);
  }
  return value;
}

function auditLeaseMinutes(argv: string[]): number {
  const value = positiveInteger(
    argv,
    "--lease-minutes",
    MAX_LEASE_MINUTES
  );
  if (value > MAX_LEASE_MINUTES) {
    throw new Error(
      `--lease-minutes must not exceed ${MAX_LEASE_MINUTES}`
    );
  }
  return value;
}

function requiredId(argv: string[], flag: string): string {
  const value = flagValue(argv, flag);
  if (!value || !/^[A-Za-z0-9_.:@/-]+$/.test(value)) {
    throw new Error(`${flag} is required and contains unsupported characters`);
  }
  return value;
}

function optionalId(argv: string[], flag: string): string | null {
  const value = flagValue(argv, flag);
  if (value == null) return null;
  if (!/^[A-Za-z0-9_.:@/-]+$/.test(value)) {
    throw new Error(`${flag} contains unsupported characters`);
  }
  return value;
}

async function resolveLeaseToken(
  queryable: Pool | PoolClient,
  argv: string[],
  options: {
    destinationId?: string;
    requireLive: boolean;
  }
): Promise<string> {
  const explicitToken = optionalId(argv, "--lease-token");
  const workerId = optionalId(argv, "--worker-id");
  if (!explicitToken && !workerId) {
    throw new Error("--lease-token or --worker-id is required");
  }
  if (!workerId) return explicitToken!;

  const matches = await queryable.query<{ lease_token: string }>(
    `SELECT lease_token
     FROM route_catalog_audit_jobs
     WHERE lease_owner = $1
       AND state = 'auditing'
       AND lease_token IS NOT NULL
       AND ($2::text IS NULL OR lease_token = $2)
       AND ($3::text IS NULL OR destination_id = $3)
       AND (NOT $4::boolean OR lease_expires_at >= now())
     ORDER BY updated_at DESC, destination_id
     LIMIT 2`,
    [
      workerId,
      explicitToken,
      options.destinationId ?? null,
      options.requireLive,
    ]
  );
  if (matches.rows.length !== 1) {
    const leaseKind = options.requireLive ? "live audit lease" : "audit lease";
    throw new Error(`No single ${leaseKind} matched worker ${workerId}`);
  }
  return matches.rows[0].lease_token;
}

function parseState(value: string | null, allowAuditing = false): AuditState {
  const states: AuditState[] = [
    "queued", "auditing", "passed", "needs_repair", "needs_human",
    "out_of_scope",
  ];
  const completionStates: AuditState[] = [
    "passed", "needs_repair", "needs_human",
  ];
  if (!value || !states.includes(value as AuditState) ||
      (!allowAuditing && !completionStates.includes(value as AuditState))) {
    throw new Error(
      "--state must be passed, needs_repair, needs_human, or an allowed show state"
    );
  }
  return value as AuditState;
}

function print(value: unknown): void {
  console.log(JSON.stringify(value));
}

export function validateCatalogAuditArgs(command: string, argv: string[]): void {
  const targeted = argv.includes("--stale-elevation-only");
  if (targeted && command !== "seed") {
    throw new Error("--stale-elevation-only is valid only with seed --apply");
  }
  if (command === "seed") {
    for (const argument of argv) {
      if (argument !== "--apply" && argument !== "--stale-elevation-only") {
        throw new Error(`Unknown seed argument ${argument}`);
      }
    }
    if (targeted && !argv.includes("--apply")) {
      throw new Error("--stale-elevation-only requires seed --apply");
    }
  }
}

async function seedStaleElevationJobs(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      destination_id: string;
      state: AuditState;
      candidate_found: boolean;
    }>(staleElevationSeedSql);
    const remaining = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM (${staleElevationJobScopeSql}) stale_elevation_jobs`
    );
    const remainingCount = remaining.rows[0]?.count ?? 0;
    if (remainingCount !== 0) {
      throw new Error(
        `${remainingCount} stale elevation catalog jobs could not be reconciled; ` +
        "an audit lease may still be active"
      );
    }
    await client.query("COMMIT");
    print({
      mode: "apply",
      scope: "stale_elevation_only",
      seeded: result.rows.filter((row) => row.candidate_found).length,
      marked_out_of_scope: result.rows.filter((row) => !row.candidate_found).length,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seed(argv: string[]): Promise<void> {
  const apply = argv.includes("--apply");
  if (argv.includes("--stale-elevation-only")) {
    await seedStaleElevationJobs();
    return;
  }
  if (!apply) {
    const result = await db.query<{
      destinations: number;
      routes: number;
      high_priority: number;
    }>(
      `WITH candidates AS (${candidateSql})
       SELECT COUNT(*)::int AS destinations,
              COALESCE(SUM(route_count), 0)::int AS routes,
              COUNT(*) FILTER (WHERE priority > 0)::int AS high_priority
       FROM candidates`
    );
    print({ mode: "dry_run", ...result.rows[0] });
    return;
  }

  const result = await db.query<{
    destination_id: string;
    state: AuditState;
  }>(
    `INSERT INTO route_catalog_audit_jobs AS job (
       destination_id, destination_name, priority, route_count,
       audit_rule_version, catalog_fingerprint
     )
     SELECT destination_id, destination_name, priority, route_count,
            audit_rule_version, catalog_fingerprint
     FROM (${candidateSql}) candidates
     ON CONFLICT (destination_id) DO UPDATE SET
       destination_name = CASE
         WHEN job.state = 'auditing'
         THEN job.destination_name
         ELSE EXCLUDED.destination_name
       END,
       priority = CASE
         WHEN job.state = 'auditing'
         THEN job.priority
         ELSE EXCLUDED.priority
       END,
       route_count = CASE
         WHEN job.state = 'auditing'
         THEN job.route_count
         ELSE EXCLUDED.route_count
       END,
       audit_rule_version = CASE
         WHEN job.state = 'auditing' THEN job.audit_rule_version
         ELSE EXCLUDED.audit_rule_version
       END,
       catalog_fingerprint = CASE
         WHEN job.state = 'auditing'
         THEN job.catalog_fingerprint
         ELSE EXCLUDED.catalog_fingerprint
       END,
       state = CASE
         WHEN job.state = 'out_of_scope'
         THEN 'queued'
         WHEN job.state <> 'auditing'
          AND (job.audit_rule_version < EXCLUDED.audit_rule_version
            OR job.catalog_fingerprint <> EXCLUDED.catalog_fingerprint)
         THEN 'queued'
         ELSE job.state
       END,
       final_result = CASE
         WHEN job.state = 'out_of_scope'
         THEN NULL
         WHEN job.state <> 'auditing'
          AND (job.audit_rule_version < EXCLUDED.audit_rule_version
            OR job.catalog_fingerprint <> EXCLUDED.catalog_fingerprint)
         THEN NULL
         ELSE job.final_result
       END,
       audited_at = CASE
         WHEN job.state = 'out_of_scope'
         THEN NULL
         WHEN job.state <> 'auditing'
          AND (job.audit_rule_version < EXCLUDED.audit_rule_version
            OR job.catalog_fingerprint <> EXCLUDED.catalog_fingerprint)
         THEN NULL
         ELSE job.audited_at
       END,
       last_error = CASE
         WHEN job.state = 'out_of_scope'
         THEN NULL
         WHEN job.state <> 'auditing'
          AND (job.audit_rule_version < EXCLUDED.audit_rule_version
            OR job.catalog_fingerprint <> EXCLUDED.catalog_fingerprint)
         THEN NULL
         ELSE job.last_error
       END,
       updated_at = now()
     RETURNING destination_id, state`
  );
  const retired = await db.query(
    `WITH candidates AS (${candidateSql})
     UPDATE route_catalog_audit_jobs job
     SET state = 'out_of_scope',
         final_result = NULL,
         audited_at = NULL,
         last_error = 'no active or quarantined legacy route remains',
         updated_at = now()
     WHERE job.state <> 'auditing'
       AND NOT EXISTS (
         SELECT 1
         FROM candidates
         WHERE candidates.destination_id = job.destination_id
       )
       AND job.state <> 'out_of_scope'`
  );
  print({
    mode: "apply",
    seeded: result.rowCount,
    jobs: result.rows.length,
    marked_out_of_scope: retired.rowCount,
  });
}

async function claim(argv: string[]): Promise<void> {
  const workerId = requiredId(argv, "--worker-id");
  const requestedDestinationId = optionalId(argv, "--destination-id");
  const leaseMinutes = auditLeaseMinutes(argv);
  const apply = argv.includes("--apply");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtext('route_catalog_audit_claim:' || $1)
       )`,
      [workerId]
    );
    await client.query(
      `UPDATE route_catalog_audit_jobs
       SET state = 'queued',
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = COALESCE(last_error, 'expired lease recovered'),
           updated_at = now()
       WHERE state = 'auditing'
         AND lease_expires_at < now()`
    );
    const liveLeases = await client.query<AuditJob>(
      `SELECT *
       FROM route_catalog_audit_jobs
       WHERE state = 'auditing'
         AND lease_owner = $1
         AND lease_expires_at >= now()
       ORDER BY updated_at DESC, destination_id
       FOR UPDATE`,
      [workerId]
    );
    if (liveLeases.rows.length > 1) {
      throw new Error(
        `worker ${workerId} owns multiple live audit leases`
      );
    }
    if (liveLeases.rows[0]) {
      let resumed = liveLeases.rows[0];
      if (apply) {
        const renewed = await client.query<AuditJob>(
          `UPDATE route_catalog_audit_jobs
           SET lease_expires_at = now() + make_interval(mins => $3),
               updated_at = now()
           WHERE destination_id = $1
             AND lease_token = $2
             AND state = 'auditing'
           RETURNING *`,
          [
            resumed.destination_id,
            resumed.lease_token,
            leaseMinutes,
          ]
        );
        if (!renewed.rows[0]) {
          throw new Error("Existing live audit lease changed before renewal");
        }
        resumed = renewed.rows[0];
        await client.query("COMMIT");
      } else {
        await client.query("ROLLBACK");
      }
      print({
        mode: apply ? "apply" : "dry_run",
        outcome: "existing_live_lease",
        job: resumed,
      });
      return;
    }
    while (true) {
      const next = await client.query<AuditJob>(
        `SELECT *
         FROM route_catalog_audit_jobs
         WHERE state = 'queued'
           AND ($1::text IS NULL OR destination_id = $1)
         ORDER BY priority DESC, updated_at, destination_id
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [requestedDestinationId]
      );
      const job = next.rows[0];
      if (!job) {
        await client.query("ROLLBACK");
        print({ mode: apply ? "apply" : "dry_run", job: null });
        return;
      }
      const current = await client.query<AuditCandidate>(
        `SELECT *
         FROM (${candidateSql}) candidates
         WHERE destination_id = $1`,
        [job.destination_id]
      );
      const candidate = current.rows[0];
      if (!candidate) {
        if (!apply) {
          await client.query("ROLLBACK");
          print({
            mode: "dry_run",
            job,
            action: "mark_out_of_scope",
          });
          return;
        }
        await client.query(
          `UPDATE route_catalog_audit_jobs
           SET state = 'out_of_scope',
               final_result = NULL,
               audited_at = NULL,
               last_error = 'no active or quarantined legacy route remains',
               updated_at = now()
           WHERE destination_id = $1`,
          [job.destination_id]
        );
        continue;
      }
      if (!apply) {
        await client.query("ROLLBACK");
        print({ mode: "dry_run", job: { ...job, ...candidate } });
        return;
      }
      const leaseToken = randomUUID();
      const claimed = await client.query<AuditJob>(
        `UPDATE route_catalog_audit_jobs
         SET state = 'auditing',
             destination_name = $2,
             priority = $3,
             route_count = $4,
             audit_rule_version = $5,
             catalog_fingerprint = $6,
             attempt_count = attempt_count + 1,
             lease_owner = $7,
             lease_token = $8,
             lease_expires_at = now() + make_interval(mins => $9),
             last_error = NULL,
             updated_at = now()
         WHERE destination_id = $1
         RETURNING *`,
        [
          job.destination_id,
          candidate.destination_name,
          candidate.priority,
          candidate.route_count,
          candidate.audit_rule_version,
          candidate.catalog_fingerprint,
          workerId,
          leaseToken,
          leaseMinutes,
        ]
      );
      await client.query("COMMIT");
      print({ mode: "apply", job: claimed.rows[0] });
      return;
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function heartbeat(argv: string[]): Promise<void> {
  const leaseToken = await resolveLeaseToken(db, argv, { requireLive: true });
  const leaseMinutes = auditLeaseMinutes(argv);
  const result = await db.query<AuditJob>(
    `UPDATE route_catalog_audit_jobs
     SET lease_expires_at = now() + make_interval(mins => $2),
         updated_at = now()
     WHERE lease_token = $1
       AND state = 'auditing'
       AND lease_expires_at >= now()
     RETURNING *`,
    [leaseToken, leaseMinutes]
  );
  if (!result.rows[0]) throw new Error("No live audit lease matched");
  print(result.rows[0]);
}

async function complete(argv: string[]): Promise<void> {
  if (!argv.includes("--apply")) throw new Error("complete requires --apply");
  const destinationId = requiredId(argv, "--destination-id");
  const state = parseState(flagValue(argv, "--state"));
  const resultFile = flagValue(argv, "--result-file");
  if (!resultFile) throw new Error("--result-file is required");
  const result = JSON.parse(await readAuditResultFile(resultFile)) as {
    destination_id?: string;
    verdict?: string;
    state?: string;
  };
  const expectedVerdict = state === "passed"
    ? "PASS"
    : state === "needs_repair" ? "FAIL" : "REVIEW";
  if (result.destination_id !== destinationId ||
      result.state !== state ||
      result.verdict !== expectedVerdict) {
    throw new Error("Result destination, state, or verdict does not match completion");
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const leaseToken = await resolveLeaseToken(client, argv, {
      destinationId,
      requireLive: true,
    });
    const current = await client.query<AuditCandidate>(
      `SELECT *
       FROM (${candidateSql}) candidates
       WHERE destination_id = $1`,
      [destinationId]
    );
    const candidate = current.rows[0];
    if (!candidate) {
      const retired = await client.query<AuditJob>(
        `UPDATE route_catalog_audit_jobs
         SET state = 'out_of_scope',
             final_result = NULL,
             audited_at = NULL,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             last_error = 'no active or quarantined legacy route remains',
             updated_at = now()
         WHERE destination_id = $1
           AND lease_token = $2
           AND state = 'auditing'
           AND lease_expires_at >= now()
         RETURNING *`,
        [destinationId, leaseToken]
      );
      if (!retired.rows[0]) throw new Error("No live audit lease matched");
      await client.query("COMMIT");
      print({ outcome: "out_of_scope", job: retired.rows[0] });
      return;
    }
    const currentJob = await client.query<AuditJob>(
      `SELECT *
       FROM route_catalog_audit_jobs
       WHERE destination_id = $1
         AND lease_token = $2
         AND state = 'auditing'
         AND lease_expires_at >= now()
       FOR UPDATE`,
      [destinationId, leaseToken]
    );
    const job = currentJob.rows[0];
    if (!job) throw new Error("No live audit lease matched");
    if (job.catalog_fingerprint !== candidate.catalog_fingerprint ||
        job.audit_rule_version !== candidate.audit_rule_version) {
      const requeued = await client.query<AuditJob>(
        `UPDATE route_catalog_audit_jobs
         SET state = 'queued',
             destination_name = $2,
             priority = $3,
             route_count = $4,
             audit_rule_version = $5,
             catalog_fingerprint = $6,
             final_result = NULL,
             audited_at = NULL,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             last_error = 'catalog changed during audit',
             updated_at = now()
         WHERE destination_id = $1
         RETURNING *`,
        [
          destinationId,
          candidate.destination_name,
          candidate.priority,
          candidate.route_count,
          candidate.audit_rule_version,
          candidate.catalog_fingerprint,
        ]
      );
      await client.query("COMMIT");
      print({ outcome: "catalog_changed_requeued", job: requeued.rows[0] });
      return;
    }
    const updated = await client.query<AuditJob>(
      `UPDATE route_catalog_audit_jobs
       SET state = $3,
           final_result = $4::jsonb,
           audited_at = now(),
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = NULL,
           updated_at = now()
       WHERE destination_id = $1
         AND lease_token = $2
         AND state = 'auditing'
       RETURNING *`,
      [destinationId, leaseToken, state, JSON.stringify(result)]
    );
    await client.query("COMMIT");
    print({ outcome: "completed", job: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function release(argv: string[]): Promise<void> {
  const leaseToken = await resolveLeaseToken(db, argv, { requireLive: false });
  const message = flagValue(argv, "--message")?.trim() || "worker released lease";
  const result = await db.query<AuditJob>(
    `UPDATE route_catalog_audit_jobs
     SET state = 'queued',
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         last_error = $2,
         updated_at = now()
     WHERE lease_token = $1
       AND state = 'auditing'
     RETURNING *`,
    [leaseToken, message.slice(0, 500)]
  );
  if (!result.rows[0]) throw new Error("No audit lease matched");
  print(result.rows[0]);
}

async function diagnoseLoss(argv: string[]): Promise<void> {
  const destinationId = requiredId(argv, "--destination-id");
  const workerId = requiredId(argv, "--worker-id");
  const result = await db.query<AuditLeaseLossRow>(auditLeaseLossSql, [
    destinationId,
    workerId,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error("Lease-loss diagnosis returned no row");
  print({
    destination_id: destinationId,
    outcome: classifyAuditLeaseLoss(row),
    ...row,
  });
}

async function requeue(argv: string[]): Promise<void> {
  if (!argv.includes("--apply")) throw new Error("requeue requires --apply");
  const destinationId = requiredId(argv, "--destination-id");
  const reason = flagValue(argv, "--reason")?.trim();
  if (!reason) throw new Error("--reason is required");
  const result = await db.query<AuditJob>(
    `UPDATE route_catalog_audit_jobs
     SET state = 'queued',
         final_result = NULL,
         audited_at = NULL,
         last_error = $2,
         updated_at = now()
     WHERE destination_id = $1
       AND state IN ('passed', 'needs_repair', 'needs_human')
     RETURNING *`,
    [destinationId, `human requeue: ${reason.slice(0, 450)}`]
  );
  if (!result.rows[0]) {
    throw new Error("No completed audit job matched");
  }
  print(result.rows[0]);
}

async function show(argv: string[]): Promise<void> {
  const destinationId = flagValue(argv, "--destination-id");
  const stateValue = flagValue(argv, "--state");
  const state = stateValue ? parseState(stateValue, true) : null;
  const limit = positiveInteger(argv, "--limit", 20);
  const result = await db.query<AuditJob>(
    `SELECT *
     FROM route_catalog_audit_jobs
     WHERE ($1::text IS NULL OR destination_id = $1)
       AND ($2::text IS NULL OR state = $2)
     ORDER BY priority DESC, updated_at, destination_id
     LIMIT $3`,
    [destinationId, state, limit]
  );
  print(result.rows);
}

async function stats(): Promise<void> {
  const result = await db.query<{
    state: AuditState;
    count: number;
    expired_leases: number;
  }>(
    `SELECT state, COUNT(*)::int AS count,
            COUNT(*) FILTER (
              WHERE lease_expires_at IS NOT NULL AND lease_expires_at < now()
            )::int AS expired_leases
     FROM route_catalog_audit_jobs
     GROUP BY state
     ORDER BY state`
  );
  const total = result.rows.reduce((sum, row) => sum + row.count, 0);
  const terminalStates = new Set<AuditState>([
    "passed", "needs_repair", "needs_human", "out_of_scope",
  ]);
  const terminal = result.rows.reduce(
    (sum, row) => sum + (terminalStates.has(row.state) ? row.count : 0),
    0
  );
  print({
    total,
    completed: terminal,
    remaining: total - terminal,
    states: Object.fromEntries(result.rows.map((row) => [row.state, row.count])),
    expired_leases: result.rows.reduce((sum, row) => sum + row.expired_leases, 0),
  });
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;
  if (
    !command || command === "--help" || command === "-h" ||
    args.includes("--help") || args.includes("-h")
  ) usage(command ? 0 : 2);
  validateCatalogAuditArgs(command, args);
  switch (command) {
    case "seed":
      await seed(args);
      break;
    case "claim":
      await claim(args);
      break;
    case "heartbeat":
      await heartbeat(args);
      break;
    case "complete":
      await complete(args);
      break;
    case "release":
      await release(args);
      break;
    case "diagnose-loss":
      await diagnoseLoss(args);
      break;
    case "requeue":
      await requeue(args);
      break;
    case "show":
      await show(args);
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
      console.error(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }));
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.end();
    });
}
