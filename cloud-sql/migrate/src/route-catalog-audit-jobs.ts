#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
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

const AUDIT_RULE_VERSION = 3;

const candidateSql = `
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
      )
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
              segment.updated_at::text,
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
  JOIN route_destinations rd ON rd.destination_id = d.id
  JOIN catalog_routes r ON r.id = rd.route_id
  WHERE 'summit'::destination_feature = ANY(d.features)
  GROUP BY d.id, d.name, d.updated_at`;

function usage(exitCode = 2): never {
  console.error(`Usage:
  npm run routes:audit-jobs -- seed [--apply]
  npm run routes:audit-jobs -- claim --worker-id ID [--destination-id ID]
      [--lease-minutes 90] --apply
  npm run routes:audit-jobs -- heartbeat --lease-token TOKEN [--lease-minutes 90]
  npm run routes:audit-jobs -- complete --destination-id ID --lease-token TOKEN
      --state passed|needs_repair|needs_human --result-file FILE --apply
  npm run routes:audit-jobs -- release --lease-token TOKEN [--message TEXT]
  npm run routes:audit-jobs -- requeue --destination-id ID --reason TEXT --apply
  npm run routes:audit-jobs -- show [--destination-id ID] [--state STATE] [--limit 20]
  npm run routes:audit-jobs -- stats

Seed and claim are dry-run unless --apply is present. Complete requires --apply.`);
  process.exit(exitCode);
}

function flagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
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

async function seed(argv: string[]): Promise<void> {
  const apply = argv.includes("--apply");
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
  const leaseMinutes = positiveInteger(argv, "--lease-minutes", 90);
  const apply = argv.includes("--apply");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
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
  const leaseToken = requiredId(argv, "--lease-token");
  const leaseMinutes = positiveInteger(argv, "--lease-minutes", 90);
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
  const leaseToken = requiredId(argv, "--lease-token");
  const state = parseState(flagValue(argv, "--state"));
  const resultFile = flagValue(argv, "--result-file");
  if (!resultFile) throw new Error("--result-file is required");
  const result = JSON.parse(await fs.readFile(resultFile, "utf8")) as {
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
  const leaseToken = requiredId(argv, "--lease-token");
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || argv.includes("--help") || argv.includes("-h")) usage(command ? 0 : 2);
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
    case "complete":
      await complete(argv);
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
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
