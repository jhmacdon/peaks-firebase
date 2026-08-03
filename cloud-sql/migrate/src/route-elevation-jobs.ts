#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PoolClient } from "pg";
import db from "./db";
import { computeRouteElevationStats, decodeElevationProfile, profileIsUsable } from "./route-elevation-profile";
import { sampleTerrariumProfile } from "./lib/terrarium-route-profile";

type JobState = "queued" | "working" | "retry" | "blocked" | "complete" | "out_of_scope";
type Point = { lat: number; lng: number; elevation: number | null };

interface Job {
  route_id: string;
  state: JobState;
  path_fingerprint: string;
  priority: number;
  attempt_count: number;
  source_kind: string;
  last_error: string | null;
  final_evidence: Record<string, unknown> | null;
  next_attempt_at: string;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
}

interface RouteSnapshot {
  id: string;
  owner: string;
  status: string;
  path_hash: string | null;
  xy_hash: string | null;
  points: Point[];
}

interface SegmentSnapshot {
  id: string;
  path_hash: string | null;
  points: Point[];
}

const MAX_ATTEMPTS = 5;
const REQUIRED_WORKER_ID = "luna-route-elevation-01";
const CANDIDATES_SQL = `
  SELECT r.id AS route_id,
         md5(concat_ws('|', r.id, r.owner, r.status, COALESCE(r.name, ''),
             COALESCE(r.distance::text, ''), COALESCE(r.shape::text, ''),
             encode(ST_AsEWKB(r.path::geometry), 'hex'),
             COALESCE((SELECT string_agg(concat_ws(':', rs.ordinal::text, rs.direction, s.id,
               encode(ST_AsEWKB(s.path::geometry), 'hex')), ',' ORDER BY rs.ordinal, rs.segment_id)
               FROM route_segments rs JOIN segments s ON s.id = rs.segment_id WHERE rs.route_id = r.id), ''))
           ) AS path_fingerprint,
         CASE WHEN r.status = 'active' THEN 100 ELSE 0 END AS priority
  FROM routes r
  WHERE r.owner = 'peaks' AND r.path IS NOT NULL`;

function compactJob(job: Job | undefined): Record<string, unknown> | null {
  if (!job) return null;
  return {
    route_id: job.route_id,
    state: job.state,
    priority: job.priority,
    attempt_count: job.attempt_count,
    source_kind: job.source_kind,
    next_attempt_at: job.next_attempt_at,
    lease_token: job.lease_token,
    lease_expires_at: job.lease_expires_at,
  };
}

function print(value: unknown): void { console.log(JSON.stringify(value)); }

function safeError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text.replace(/-?\d{1,3}\.\d{3,}/g, "[number]").replace(/\s+/g, " ").slice(0, 240);
}

function requiredId(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index < 0 ? null : argv[index + 1];
  if (!value || value.startsWith("--") || !/^[A-Za-z0-9_.:@/-]+$/.test(value)) {
    throw new Error(`${flag} is required and contains unsupported characters`);
  }
  return value;
}

function optionalId(argv: string[], flag: string): string | null {
  if (!argv.includes(flag)) return null;
  return requiredId(argv, flag);
}

function requiredMessage(argv: string[]): string {
  const index = argv.indexOf("--message");
  const value = index < 0 ? null : argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error("--message is required");
  return safeError(value);
}

export function validateArgs(command: string, argv: string[]): void {
  const allowed: Record<string, string[]> = {
    seed: ["--apply"],
    claim: ["--worker-id", "--apply"],
    heartbeat: ["--lease-token"],
    process: ["--route-id", "--lease-token", "--apply"],
    release: ["--lease-token", "--message"],
    show: ["--route-id", "--state"],
    stats: [],
  };
  if (!(command in allowed)) throw new Error("Unknown command");
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) throw new Error("Unexpected argument");
    if (!allowed[command]!.includes(token)) throw new Error(`Unknown flag ${token}`);
    if (token !== "--apply") index += 1;
  }
}

export function requireWorkerId(workerId: string): string {
  if (workerId !== REQUIRED_WORKER_ID) {
    throw new Error(`--worker-id must be ${REQUIRED_WORKER_ID}`);
  }
  return workerId;
}

export function equalRouteIdSets(first: string[], second: string[]): boolean {
  const firstUnique = [...new Set(first)].sort();
  const secondUnique = [...new Set(second)].sort();
  if (
    firstUnique.length !== first.length ||
    secondUnique.length !== second.length ||
    firstUnique.length !== secondUnique.length
  ) {
    return false;
  }
  return firstUnique.every((routeId, index) => routeId === secondUnique[index]);
}

function usage(): never {
  throw new Error("Usage: seed [--apply] | claim --worker-id ID --apply | heartbeat --lease-token TOKEN | process --route-id ID --lease-token TOKEN --apply | release --lease-token TOKEN --message TEXT | show [--route-id ID] [--state STATE] | stats");
}

async function seed(apply: boolean): Promise<void> {
  if (!apply) {
    const result = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM (${CANDIDATES_SQL}) candidates`);
    print({ mode: "dry_run", candidates: result.rows[0]?.count ?? 0 });
    return;
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const seeded = await client.query(
      `INSERT INTO route_elevation_backfill_jobs (route_id, path_fingerprint, priority, state, next_attempt_at)
       SELECT route_id, path_fingerprint, priority, 'queued', now() FROM (${CANDIDATES_SQL}) candidates
       ON CONFLICT (route_id) DO UPDATE SET
         path_fingerprint = CASE WHEN route_elevation_backfill_jobs.state = 'working'
           AND route_elevation_backfill_jobs.lease_expires_at >= now() THEN route_elevation_backfill_jobs.path_fingerprint
           ELSE EXCLUDED.path_fingerprint END,
         priority = CASE WHEN route_elevation_backfill_jobs.state = 'working'
           AND route_elevation_backfill_jobs.lease_expires_at >= now() THEN route_elevation_backfill_jobs.priority
           ELSE EXCLUDED.priority END,
         state = CASE
           WHEN route_elevation_backfill_jobs.state = 'working' AND route_elevation_backfill_jobs.lease_expires_at >= now() THEN 'working'
           WHEN route_elevation_backfill_jobs.state = 'working' THEN 'retry'
           WHEN route_elevation_backfill_jobs.state = 'complete' AND route_elevation_backfill_jobs.path_fingerprint <> EXCLUDED.path_fingerprint THEN 'queued'
           WHEN route_elevation_backfill_jobs.state = 'out_of_scope' THEN 'queued'
           ELSE route_elevation_backfill_jobs.state END,
         next_attempt_at = CASE WHEN route_elevation_backfill_jobs.state = 'working' AND route_elevation_backfill_jobs.lease_expires_at < now() THEN now()
           WHEN route_elevation_backfill_jobs.state IN ('complete', 'out_of_scope')
           AND route_elevation_backfill_jobs.path_fingerprint <> EXCLUDED.path_fingerprint THEN now()
           ELSE route_elevation_backfill_jobs.next_attempt_at END,
         lease_owner = CASE WHEN route_elevation_backfill_jobs.state = 'working' AND route_elevation_backfill_jobs.lease_expires_at >= now()
           THEN route_elevation_backfill_jobs.lease_owner ELSE NULL END,
         lease_token = CASE WHEN route_elevation_backfill_jobs.state = 'working' AND route_elevation_backfill_jobs.lease_expires_at >= now()
           THEN route_elevation_backfill_jobs.lease_token ELSE NULL END,
         lease_expires_at = CASE WHEN route_elevation_backfill_jobs.state = 'working' AND route_elevation_backfill_jobs.lease_expires_at >= now()
           THEN route_elevation_backfill_jobs.lease_expires_at ELSE NULL END`
    );
    const retired = await client.query(
      `UPDATE route_elevation_backfill_jobs j SET state = 'out_of_scope', lease_owner = NULL, lease_token = NULL,
         lease_expires_at = NULL, last_error = 'route no longer Peaks-owned with a path'
       WHERE (j.state <> 'working' OR j.lease_expires_at < now())
         AND NOT EXISTS (SELECT 1 FROM (${CANDIDATES_SQL}) candidates WHERE candidates.route_id = j.route_id)`
    );
    await client.query("COMMIT");
    print({ mode: "apply", seeded: seeded.rowCount, marked_out_of_scope: retired.rowCount });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function claim(workerId: string, apply: boolean): Promise<void> {
  if (!apply) throw new Error("claim requires --apply");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE route_elevation_backfill_jobs SET state = 'retry', lease_owner = NULL, lease_token = NULL,
         lease_expires_at = NULL, next_attempt_at = now(), last_error = COALESCE(last_error, 'expired lease recovered')
       WHERE state = 'working' AND lease_expires_at < now()`
    );
    const next = await client.query<Job>(
      `SELECT * FROM route_elevation_backfill_jobs WHERE state IN ('queued', 'retry') AND next_attempt_at <= now()
       ORDER BY priority DESC, next_attempt_at, route_id FOR UPDATE SKIP LOCKED LIMIT 1`
    );
    const job = next.rows[0];
    if (!job || !apply) { await client.query("ROLLBACK"); print({ mode: apply ? "apply" : "dry_run", job: compactJob(job) }); return; }
    const claimed = await client.query<Job>(
      `UPDATE route_elevation_backfill_jobs SET state = 'working', attempt_count = attempt_count + 1,
       lease_owner = $2, lease_token = $3, lease_expires_at = now() + interval '15 minutes', last_error = NULL
       WHERE route_id = $1 RETURNING *`, [job.route_id, workerId, randomUUID()]
    );
    await client.query("COMMIT");
    print({ mode: "apply", job: compactJob(claimed.rows[0]) });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function heartbeat(token: string): Promise<void> {
  const result = await db.query<Job>(
    `UPDATE route_elevation_backfill_jobs SET lease_expires_at = now() + interval '15 minutes'
     WHERE state = 'working' AND lease_token = $1 AND lease_expires_at >= now() RETURNING *`, [token]
  );
  if (!result.rows[0]) throw new Error("No live route elevation lease matched");
  print({ job: compactJob(result.rows[0]) });
}

async function release(token: string, message: string): Promise<void> {
  const result = await db.query<Job>(
    `UPDATE route_elevation_backfill_jobs SET state = CASE WHEN attempt_count >= $2 THEN 'blocked' ELSE 'retry' END,
       lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = $3,
       next_attempt_at = CASE WHEN attempt_count >= $2 THEN next_attempt_at
         ELSE now() + make_interval(mins => LEAST(60, (2 ^ LEAST(attempt_count, 5))::int)) END
     WHERE state = 'working' AND lease_token = $1 RETURNING *`, [token, MAX_ATTEMPTS, message]
  );
  if (!result.rows[0]) throw new Error("No route elevation lease matched");
  print({ job: compactJob(result.rows[0]) });
}

async function pointsFor(client: PoolClient | typeof db, table: "routes" | "segments", id: string): Promise<Point[]> {
  const result = await client.query<{ lat: number; lng: number; elevation: number | null }>(
    `SELECT ST_Y((dumped).geom)::float8 AS lat, ST_X((dumped).geom)::float8 AS lng,
            ST_Z((dumped).geom)::float8 AS elevation FROM ${table}, ST_DumpPoints(path::geometry) dumped
     WHERE id = $1 ORDER BY (dumped).path`, [id]
  );
  return result.rows;
}

async function routeSnapshot(client: PoolClient | typeof db, id: string): Promise<RouteSnapshot | null> {
  const route = await client.query<{ id: string; owner: string; status: string; path_hash: string | null; xy_hash: string | null }>(
    `SELECT id, owner, status, CASE WHEN path IS NULL THEN NULL ELSE md5(encode(ST_AsEWKB(path::geometry), 'hex')) END AS path_hash,
            CASE WHEN path IS NULL THEN NULL ELSE md5(encode(ST_AsEWKB(ST_Force2D(path::geometry)), 'hex')) END AS xy_hash
     FROM routes WHERE id = $1`, [id]
  );
  const current = route.rows[0];
  return current ? { ...current, points: await pointsFor(client, "routes", id) } : null;
}

async function segmentSnapshots(client: PoolClient | typeof db, routeId: string): Promise<SegmentSnapshot[]> {
  const rows = await client.query<{ id: string; path_hash: string | null }>(
    `SELECT s.id, CASE WHEN s.path IS NULL THEN NULL ELSE md5(encode(ST_AsEWKB(s.path::geometry), 'hex')) END AS path_hash
     FROM route_segments rs JOIN segments s ON s.id = rs.segment_id WHERE rs.route_id = $1 ORDER BY rs.ordinal`, [routeId]
  );
  return Promise.all(rows.rows.map(async (row) => ({ ...row, points: await pointsFor(client, "segments", row.id) })));
}

async function affectedPeaksRoutes(client: PoolClient | typeof db, segmentIds: string[]): Promise<RouteSnapshot[]> {
  if (segmentIds.length === 0) return [];
  const routes = await client.query<{ id: string }>(
    `SELECT DISTINCT r.id FROM routes r JOIN route_segments rs ON rs.route_id = r.id
     WHERE r.owner = 'peaks' AND rs.segment_id = ANY($1::text[]) ORDER BY r.id`, [segmentIds]
  );
  return Promise.all(routes.rows.map((row) => routeSnapshot(client, row.id).then((snapshot) => {
    if (!snapshot) throw new Error("Affected route disappeared while terrain was sampled");
    return snapshot;
  })));
}

function existingProfile(points: Point[]): number[] | null {
  const elevations = points.map((point) => point.elevation);
  return elevations.every((elevation): elevation is number => elevation !== null && elevation >= -12_000 && elevation <= 12_000) && profileIsUsable(elevations) ? elevations : null;
}

async function completeProfile(points: Point[]): Promise<{ elevations: number[]; sourceKind: string }> {
  const existing = existingProfile(points);
  if (existing) return { elevations: existing, sourceKind: "existing_z" };
  return {
    elevations: await sampleTerrariumProfile(points.map(({ lat, lng }) => ({ lat, lng })), {
      cacheDir: process.env.PEAKS_TERRARIUM_CACHE_DIR ?? join(tmpdir(), "peaks-route-elevation-terrarium"),
    }),
    sourceKind: "terrarium_z14",
  };
}

async function applyProfile(client: PoolClient, table: "routes" | "segments", id: string, elevations: number[]): Promise<void> {
  const stats = computeRouteElevationStats(elevations);
  const fields = table === "routes" ? ", gain = $3, gain_loss = $4" : ", gain = $3, gain_loss = $4";
  const result = await client.query(
    `WITH points AS (
       SELECT row_number() OVER (ORDER BY (dumped).path)::int AS n, (dumped).geom AS geom
       FROM ${table}, ST_DumpPoints(path::geometry) dumped WHERE id = $1
     ), rebuilt AS (
       SELECT ST_SetSRID(ST_MakeLine(array_agg(ST_SetSRID(ST_MakePoint(ST_X(geom), ST_Y(geom), $2[n]), 4326) ORDER BY n)), 4326)::geography AS path
       FROM points
     ) UPDATE ${table} SET path = rebuilt.path ${fields} FROM rebuilt WHERE id = $1`,
    [id, elevations, stats.gain, stats.loss]
  );
  if (result.rowCount !== 1) throw new Error(`Could not update ${table}`);
}

async function liveJob(client: PoolClient, routeId: string, token: string): Promise<Job | null> {
  const result = await client.query<Job>(
    `SELECT * FROM route_elevation_backfill_jobs WHERE route_id = $1 AND state = 'working'
     AND lease_token = $2 AND lease_expires_at >= now() FOR UPDATE`, [routeId, token]
  );
  return result.rows[0] ?? null;
}

async function currentFingerprint(client: PoolClient | typeof db, routeId: string): Promise<string | null> {
  const result = await client.query<{ path_fingerprint: string }>(
    `SELECT path_fingerprint FROM (${CANDIDATES_SQL}) candidates WHERE route_id = $1`, [routeId]
  );
  return result.rows[0]?.path_fingerprint ?? null;
}

async function verifyPublicRoute(route: RouteSnapshot, expectedCount: number, fingerprint: string): Promise<{ kind: string }> {
  if (route.status !== "active") return { kind: "public_not_applicable: pending" };
  const base = process.env.PEAKS_PUBLIC_ROUTE_VERIFIER_BASE_URL;
  if (!base) throw new Error("Public route verifier base URL is required for active routes");
  const response = await fetch(`${base.replace(/\/$/, "")}/routes/${encodeURIComponent(route.id)}?elevation_fingerprint=${encodeURIComponent(fingerprint)}`, {
    headers: { "cache-control": "no-cache" },
  });
  if (!response.ok) throw new Error(`Public route verification failed (${response.status})`);
  const body = await response.json() as { profile_count?: unknown };
  if (body.profile_count !== expectedCount) throw new Error("Public route profile count did not match");
  return { kind: "public_profile_count_verified" };
}

async function verifyPersistedRoute(client: PoolClient, snapshot: RouteSnapshot, elevations: number[]): Promise<void> {
  const result = await client.query<{ point_count: number; valid_z: boolean; xy_hash: string; elevation_string: string | null; gain: number | null; gain_loss: number | null }>(
    `SELECT ST_NPoints(path::geometry)::int AS point_count,
            (SELECT bool_and(ST_Z((dumped).geom) BETWEEN -12000 AND 12000) FROM ST_DumpPoints(routes.path::geometry) dumped) AS valid_z,
            md5(encode(ST_AsEWKB(ST_Force2D(path::geometry)), 'hex')) AS xy_hash,
            elevation_string, gain, gain_loss FROM routes WHERE id = $1`, [snapshot.id]
  );
  const saved = result.rows[0];
  const profile = decodeElevationProfile(saved?.elevation_string ?? null, elevations.length);
  const stats = computeRouteElevationStats(elevations);
  if (!saved || !saved.valid_z || saved.xy_hash !== snapshot.xy_hash || saved.point_count !== elevations.length ||
      !profileIsUsable(profile) || Math.abs((saved.gain ?? NaN) - stats.gain) > 0.001 ||
      Math.abs((saved.gain_loss ?? NaN) - stats.loss) > 0.001) {
    throw new Error("Affected route verification failed");
  }
}

async function extendLease(routeId: string, token: string): Promise<void> {
  const result = await db.query(
    `UPDATE route_elevation_backfill_jobs SET lease_expires_at = now() + interval '15 minutes'
     WHERE route_id = $1 AND state = 'working' AND lease_token = $2 AND lease_expires_at >= now()`, [routeId, token]
  );
  if (result.rowCount !== 1) throw new Error("Route elevation lease expired before public verification");
}

async function failLease(routeId: string, token: string, error: unknown): Promise<void> {
  const result = await db.query<Job>(
    `UPDATE route_elevation_backfill_jobs SET state = CASE WHEN attempt_count >= $3 THEN 'blocked' ELSE 'retry' END,
       lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = $4,
       next_attempt_at = CASE WHEN attempt_count >= $3 THEN next_attempt_at ELSE now() + interval '2 minutes' END
     WHERE route_id = $1 AND state = 'working' AND lease_token = $2 RETURNING *`,
    [routeId, token, MAX_ATTEMPTS, safeError(error)]
  );
  if (!result.rows[0]) throw new Error("No live route elevation lease matched");
  print({ outcome: "retry", job: compactJob(result.rows[0]) });
}

async function hasLiveLease(routeId: string, token: string): Promise<boolean> {
  const result = await db.query<{ live: boolean }>(
    `SELECT true AS live FROM route_elevation_backfill_jobs WHERE route_id = $1 AND state = 'working'
     AND lease_token = $2 AND lease_expires_at >= now()`, [routeId, token]
  );
  return result.rows[0]?.live === true;
}

async function processRoute(routeId: string, token: string, apply: boolean): Promise<void> {
  if (!apply) throw new Error("process requires --apply");
  if (!await hasLiveLease(routeId, token)) throw new Error("No live route elevation lease matched");
  const beforeSampling = await db.query<Job>(
    `SELECT * FROM route_elevation_backfill_jobs WHERE route_id = $1 AND state = 'working'
     AND lease_token = $2 AND lease_expires_at >= now()`, [routeId, token]
  );
  const preflightJob = beforeSampling.rows[0];
  if (!preflightJob) throw new Error("No live route elevation lease matched");
  const preflightFingerprint = await currentFingerprint(db, routeId);
  if (preflightFingerprint !== preflightJob.path_fingerprint) {
    const state = preflightFingerprint ? "queued" : "out_of_scope";
    const requeued = await db.query<Job>(
      `UPDATE route_elevation_backfill_jobs SET state = $3, path_fingerprint = COALESCE($4, path_fingerprint),
       lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, next_attempt_at = now(),
       last_error = CASE WHEN $4 IS NULL THEN 'route is out of scope' ELSE 'path changed before terrain sampling' END
       WHERE route_id = $1 AND state = 'working' AND lease_token = $2 RETURNING *`,
      [routeId, token, state, preflightFingerprint]
    );
    if (!requeued.rows[0]) throw new Error("No live route elevation lease matched");
    print({ outcome: preflightFingerprint ? "path_changed_requeued" : "out_of_scope", job: compactJob(requeued.rows[0]) });
    return;
  }
  try {
    const snapshot = await routeSnapshot(db, routeId);
    if (!snapshot) throw new Error("Route does not exist");
    const primaryProfile = snapshot.owner === "peaks" && snapshot.points.length >= 2 ? await completeProfile(snapshot.points) : null;
    const segments = primaryProfile ? await segmentSnapshots(db, routeId) : [];
    const segmentProfiles = new Map<string, { elevations: number[]; sourceKind: string }>();
    for (const segment of segments) segmentProfiles.set(segment.id, await completeProfile(segment.points));
    const affected = primaryProfile ? await affectedPeaksRoutes(db, segments.map((segment) => segment.id)) : [];
    if (primaryProfile && !affected.some((route) => route.id === routeId)) affected.push(snapshot);
    const affectedProfiles = new Map<string, { elevations: number[]; sourceKind: string }>();
    for (const route of affected) {
      affectedProfiles.set(route.id, route.id === routeId ? primaryProfile! : await completeProfile(route.points));
    }
    let written: { pointCount: number; sourceKind: string; fingerprint: string } | null = null;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const job = await liveJob(client, routeId, token);
      if (!job) throw new Error("No live route elevation lease matched");
      const fingerprint = await currentFingerprint(client, routeId);
      if (fingerprint !== job.path_fingerprint) {
        const updated = await client.query<Job>(
          `UPDATE route_elevation_backfill_jobs SET state = 'queued', path_fingerprint = COALESCE($2, path_fingerprint),
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = 'path changed during processing', next_attempt_at = now()
           WHERE route_id = $1 RETURNING *`, [routeId, fingerprint]
        );
        await client.query("COMMIT"); print({ outcome: "path_changed_requeued", job: compactJob(updated.rows[0]) }); return;
      }
      const fresh = await routeSnapshot(client, routeId);
      if (!fresh || fresh.owner !== "peaks" || !fresh.path_hash || fresh.points.length < 2) {
        const updated = await client.query<Job>(
          `UPDATE route_elevation_backfill_jobs SET state = 'out_of_scope', lease_owner = NULL, lease_token = NULL,
           lease_expires_at = NULL, last_error = 'route is not a Peaks-owned usable path' WHERE route_id = $1 RETURNING *`, [routeId]
        );
        await client.query("COMMIT"); print({ outcome: "out_of_scope", job: compactJob(updated.rows[0]) }); return;
      }
      if (!primaryProfile || fresh.path_hash !== snapshot.path_hash) throw new Error("Route changed while terrain was sampled");
      const segmentIds = [...new Set(segments.map((segment) => segment.id))].sort();
      if (segmentIds.length > 0) {
        const lockedSegments = await client.query<{ id: string; path_hash: string | null }>(
          `SELECT id,
                  CASE WHEN path IS NULL THEN NULL
                       ELSE md5(encode(ST_AsEWKB(path::geometry), 'hex'))
                  END AS path_hash
           FROM segments
           WHERE id = ANY($1::text[])
           ORDER BY id
           FOR UPDATE`,
          [segmentIds]
        );
        if (
          lockedSegments.rows.length !== segmentIds.length ||
          lockedSegments.rows.some((row) => {
            const sampled = segments.find((segment) => segment.id === row.id);
            return !sampled || row.path_hash !== sampled.path_hash;
          })
        ) {
          throw new Error("Source segment changed while terrain was sampled");
        }

        await client.query(
          `SELECT route_id, segment_id, ordinal
           FROM route_segments
           WHERE segment_id = ANY($1::text[])
           ORDER BY segment_id, route_id, ordinal
           FOR UPDATE`,
          [segmentIds]
        );
        const currentAffected = await client.query<{ id: string }>(
          `SELECT DISTINCT r.id
           FROM route_segments rs
           JOIN routes r ON r.id = rs.route_id
           WHERE rs.segment_id = ANY($1::text[])
             AND r.owner = 'peaks'
           ORDER BY r.id`,
          [segmentIds]
        );
        if (
          !equalRouteIdSets(
            affected.map((route) => route.id),
            currentAffected.rows.map((route) => route.id)
          )
        ) {
          throw new Error("Affected route membership changed while terrain was sampled");
        }
      }
      const routeIds = affected.map((route) => route.id).sort();
      if (routeIds.length > 0) {
        const locked = await client.query<{ id: string; owner: string; path_hash: string | null }>(
          `SELECT id, owner, CASE WHEN path IS NULL THEN NULL ELSE md5(encode(ST_AsEWKB(path::geometry), 'hex')) END AS path_hash
           FROM routes WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`, [routeIds]
        );
        if (locked.rows.length !== routeIds.length || locked.rows.some((row) => {
          const sampled = affected.find((route) => route.id === row.id);
          return row.owner !== "peaks" || !sampled || row.path_hash !== sampled.path_hash;
        })) throw new Error("Affected route changed while terrain was sampled");
      }
      const segmentsNeedingElevation = segments.filter((segment) => !existingProfile(segment.points));
      for (const segment of segmentsNeedingElevation) {
        await applyProfile(client, "segments", segment.id, segmentProfiles.get(segment.id)!.elevations);
      }
      // Rebuild every Peaks route that shares these source segments, even when
      // the source segment already had usable Z. This keeps route materialized
      // paths and stats in one transaction; user-owned routes are absent from affected.
      for (const route of affected) await applyProfile(client, "routes", route.id, affectedProfiles.get(route.id)!.elevations);
      const verified = await client.query<{ point_count: number; valid_z: boolean; elevation_string: string | null; gain: number | null; gain_loss: number | null }>(
        `SELECT ST_NPoints(path::geometry)::int AS point_count,
                (SELECT bool_and(ST_Z((dumped).geom) BETWEEN -12000 AND 12000)
                 FROM ST_DumpPoints(routes.path::geometry) dumped) AS valid_z,
                elevation_string, gain, gain_loss
         FROM routes WHERE id = $1 FOR UPDATE`, [routeId]
      );
      const saved = verified.rows[0];
      const encoded = decodeElevationProfile(saved?.elevation_string ?? null, primaryProfile.elevations.length);
      const stats = computeRouteElevationStats(primaryProfile.elevations);
      if (!saved || !saved.valid_z || saved.point_count !== primaryProfile.elevations.length || !profileIsUsable(encoded) ||
          encoded.length !== primaryProfile.elevations.length || Math.abs((saved.gain ?? NaN) - stats.gain) > 0.001 ||
          Math.abs((saved.gain_loss ?? NaN) - stats.loss) > 0.001) throw new Error("Fresh route profile verification failed");
      for (const route of affected) await verifyPersistedRoute(client, route, affectedProfiles.get(route.id)!.elevations);
      const finalFingerprint = await currentFingerprint(client, routeId);
      if (!finalFingerprint) throw new Error("Route left scope before completion");
      const sourceKind = [primaryProfile, ...segmentProfiles.values(), ...affectedProfiles.values()]
        .some((profile) => profile.sourceKind === "terrarium_z14") ? "terrarium_z14" : "existing_z";
      written = { pointCount: saved.point_count, sourceKind, fingerprint: finalFingerprint };
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    if (!written) throw new Error("Route write did not finish");
    await extendLease(routeId, token);
    const publicEvidence = await verifyPublicRoute(snapshot, written.pointCount, written.fingerprint);
    const completeClient = await db.connect();
    try {
      await completeClient.query("BEGIN");
      const job = await liveJob(completeClient, routeId, token);
      if (!job || await currentFingerprint(completeClient, routeId) !== written.fingerprint) {
        throw new Error("Route changed before public verification completed");
      }
      const completed = await completeClient.query<Job>(
        `UPDATE route_elevation_backfill_jobs SET state = 'complete', path_fingerprint = $2, source_kind = $3,
         lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = NULL,
         final_evidence = $4::jsonb WHERE route_id = $1 RETURNING *`,
        [routeId, written.fingerprint, written.sourceKind,
         JSON.stringify({ source_kind: written.sourceKind, point_count: written.pointCount, verification: publicEvidence.kind })]
      );
      await completeClient.query("COMMIT");
      print({ outcome: "complete", job: compactJob(completed.rows[0]) });
    } catch (error) { await completeClient.query("ROLLBACK"); throw error; } finally { completeClient.release(); }
  } catch (error) { await failLease(routeId, token, error); }
}

async function show(routeId: string | null, state: string | null): Promise<void> {
  if (state && !(["queued", "working", "retry", "blocked", "complete", "out_of_scope"] as string[]).includes(state)) throw new Error("Invalid state");
  const result = await db.query<Job>(
    `SELECT * FROM route_elevation_backfill_jobs WHERE ($1::text IS NULL OR route_id = $1) AND ($2::text IS NULL OR state = $2)
     ORDER BY priority DESC, next_attempt_at, route_id`, [routeId, state]
  );
  print(result.rows.map(compactJob));
}

async function stats(): Promise<void> {
  const result = await db.query<{ state: JobState; count: number }>(`SELECT state, count(*)::int AS count FROM route_elevation_backfill_jobs GROUP BY state ORDER BY state`);
  print({ states: Object.fromEntries(result.rows.map((row) => [row.state, row.count])), total: result.rows.reduce((sum, row) => sum + row.count, 0) });
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv;
  if (!command) usage();
  validateArgs(command, rest);
  switch (command) {
    case "seed": return seed(rest.includes("--apply"));
    case "claim": return claim(requireWorkerId(requiredId(rest, "--worker-id")), rest.includes("--apply"));
    case "heartbeat": return heartbeat(requiredId(rest, "--lease-token"));
    case "process": return processRoute(requiredId(rest, "--route-id"), requiredId(rest, "--lease-token"), rest.includes("--apply"));
    case "release": return release(requiredId(rest, "--lease-token"), requiredMessage(rest));
    case "show": return show(optionalId(rest, "--route-id"), optionalId(rest, "--state"));
    case "stats": return stats();
    default: return usage();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => { console.error(JSON.stringify({ error: safeError(error) })); process.exitCode = 1; }).finally(() => db.end());
}
