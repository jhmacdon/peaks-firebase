#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PoolClient } from "pg";
import db from "./db";
import {
  publicElevationLineageMatches,
  type PersistedElevationLineage,
  type PublicElevationLineage,
} from "./elevation-lineage";
import {
  computeRouteElevationStats,
  decodeElevationProfile,
  profileIsUsable,
  routeProfileHasRealRange,
} from "./route-elevation-profile";
import { sampleTerrariumProfile } from "./lib/terrarium-route-profile";

type JobState = "queued" | "working" | "retry" | "blocked" | "complete" | "out_of_scope";
type Point = { lat: number; lng: number; elevation: number | null };

interface Job {
  route_id: string;
  route_name?: string | null;
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
  name: string | null;
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
  gain: number | null;
  gain_loss: number | null;
  computed_gain: number | null;
  computed_loss: number | null;
  user_route_reference_count: number;
}

const MAX_ATTEMPTS = 5;
const REQUIRED_WORKER_ID = "luna-route-elevation-01";
const TERRAIN_SOURCE_ENDPOINT =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/{x}/{y}.png";
const TERRAIN_SOURCE_NAME =
  "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)";
const TERRAIN_SOURCE_URL = "https://registry.opendata.aws/terrain-tiles/";
const TERRAIN_DATA_LICENSE =
  "Source-specific license terms in Tilezen Joerd attribution.md";
const TERRAIN_LICENSE_URL =
  "https://github.com/tilezen/joerd/blob/master/docs/attribution.md";
const TERRAIN_ATTRIBUTION = `* ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and
  funded under National Science Foundation awards 1043681, 1559691, and 1542736;
* Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017;
* Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM)
  Österreich;
* Canada terrain data contains information licensed under the Open Government
  Licence – Canada;
* Europe terrain data produced using Copernicus data and information funded by the
  European Union - EU-DEM layers;
* Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration
* Mexico terrain data source: INEGI, Continental relief, 2016;
* New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New
  Zealand and the New Zealand Government (All rights reserved);
* Norway terrain data © Kartverket;
* United Kingdom terrain data © Environment Agency copyright and/or database right
  2015. All rights reserved;
* United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data
  courtesy of the U.S. Geological Survey.`;

export const ELEVATION_ROUTE_FINGERPRINT_SQL = `
  SELECT r.id AS route_id,
         md5(concat_ws('|', r.id, r.owner, r.status, COALESCE(r.name, ''),
             COALESCE(r.distance::text, ''), COALESCE(r.shape::text, ''),
             encode(ST_AsEWKB(r.path::geometry), 'hex'),
             COALESCE(r.elevation_string, ''),
             COALESCE(r.gain::text, ''),
             COALESCE(r.gain_loss::text, ''),
             COALESCE(r.elevation_source, ''),
             COALESCE(r.elevation_source_url, ''),
             COALESCE(r.elevation_attribution, ''),
             COALESCE(r.elevation_license_url, ''),
             COALESCE(r.elevation_retrieved_at::text, ''),
             COALESCE((SELECT string_agg(concat_ws(':',
               rs.ordinal::text, rs.direction, s.id,
               COALESCE(encode(ST_AsEWKB(s.path::geometry), 'hex'), ''),
               COALESCE(encode_route_elevation_profile(s.path), ''),
               COALESCE(s.gain::text, ''), COALESCE(s.gain_loss::text, ''),
               COALESCE(s.provenance::text, '')), ',' ORDER BY rs.ordinal, rs.segment_id)
               FROM route_segments rs
               JOIN segments s ON s.id = rs.segment_id
               WHERE rs.route_id = r.id), ''))
           ) AS path_fingerprint,
         CASE WHEN r.status = 'active' THEN 100 ELSE 0 END AS priority,
         r.elevation_string IS DISTINCT FROM
           encode_route_elevation_profile(r.path) AS route_profile_mismatch,
         NOT route_elevation_profile_has_real_range(r.path) AS route_range_invalid,
         r.gain IS DISTINCT FROM elevation_stats.gain
           OR r.gain_loss IS DISTINCT FROM elevation_stats.loss AS route_stats_mismatch,
         EXISTS (
           SELECT 1
           FROM route_segments rs
           JOIN segments s ON s.id = rs.segment_id
           WHERE rs.route_id = r.id
             AND (
               s.path IS NULL
               OR encode_route_elevation_profile(s.path) IS NULL
               OR s.gain IS DISTINCT FROM (
                 SELECT gain FROM route_elevation_stats(s.path)
               )
               OR s.gain_loss IS DISTINCT FROM (
                 SELECT loss FROM route_elevation_stats(s.path)
               )
             )
         ) AS segment_needs_elevation
  FROM routes r
  CROSS JOIN LATERAL route_elevation_stats(r.path) elevation_stats
  WHERE r.owner = 'peaks'
    AND r.status IN ('active', 'pending')
    AND r.path IS NOT NULL`;

export const ELEVATION_CANDIDATES_SQL = `
  SELECT *
  FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) route_fingerprint
  WHERE route_profile_mismatch
     OR route_range_invalid
     OR route_stats_mismatch
     OR segment_needs_elevation`;

function compactEvidence(
  evidence: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!evidence) return null;
  return {
    source_kind: evidence.source_kind,
    point_count: evidence.point_count,
    verification: evidence.verification,
    profile_hash: evidence.profile_hash,
  };
}

export function compactJob(job: Job | undefined): Record<string, unknown> | null {
  if (!job) return null;
  const compact: Record<string, unknown> = {
    route_id: job.route_id,
    route_name: job.route_name ?? null,
    state: job.state,
    priority: job.priority,
    attempt_count: job.attempt_count,
    source_kind: job.source_kind,
    next_attempt_at: job.next_attempt_at,
    lease_token: job.lease_token,
    lease_expires_at: job.lease_expires_at,
  };
  if (job.state === "complete") {
    compact.final_evidence = compactEvidence(job.final_evidence);
  } else if (job.state === "blocked") {
    compact.blocker = job.last_error;
  }
  return compact;
}

export function processCompletionOutput(job: Job): Record<string, unknown> {
  const evidence = compactEvidence(job.final_evidence);
  return {
    outcome: "complete",
    state: job.state,
    route_id: job.route_id,
    route_name: job.route_name ?? null,
    source_kind: evidence?.source_kind,
    point_count: evidence?.point_count,
    verification: evidence?.verification,
    profile_hash: evidence?.profile_hash,
  };
}

export function retryOutcome(state: JobState): "retry" | "blocked" {
  return state === "blocked" ? "blocked" : "retry";
}

export function statsOutput(
  rows: Array<{ state: JobState; count: number; expired_leases: number }>
): Record<string, unknown> {
  return {
    states: Object.fromEntries(rows.map((row) => [row.state, row.count])),
    total: rows.reduce((sum, row) => sum + row.count, 0),
    expired_leases: rows.reduce(
      (sum, row) => sum + row.expired_leases,
      0
    ),
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
    const result = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM (${ELEVATION_CANDIDATES_SQL}) candidates`);
    print({ mode: "dry_run", candidates: result.rows[0]?.count ?? 0 });
    return;
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const seeded = await client.query(
      `INSERT INTO route_elevation_backfill_jobs (route_id, path_fingerprint, priority, state, next_attempt_at)
       SELECT route_id, path_fingerprint, priority, 'queued', now() FROM (${ELEVATION_CANDIDATES_SQL}) candidates
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
           WHEN route_elevation_backfill_jobs.state = 'blocked' AND route_elevation_backfill_jobs.path_fingerprint <> EXCLUDED.path_fingerprint THEN 'queued'
           WHEN route_elevation_backfill_jobs.state = 'out_of_scope' THEN 'queued'
           ELSE route_elevation_backfill_jobs.state END,
         attempt_count = CASE
           WHEN route_elevation_backfill_jobs.state IN (
             'complete', 'blocked', 'out_of_scope'
           )
             AND route_elevation_backfill_jobs.path_fingerprint <> EXCLUDED.path_fingerprint
           THEN 0 ELSE route_elevation_backfill_jobs.attempt_count END,
         last_error = CASE
           WHEN route_elevation_backfill_jobs.state IN (
             'complete', 'blocked', 'out_of_scope'
           )
             AND route_elevation_backfill_jobs.path_fingerprint <> EXCLUDED.path_fingerprint
           THEN NULL ELSE route_elevation_backfill_jobs.last_error END,
         final_evidence = CASE
           WHEN route_elevation_backfill_jobs.state IN (
             'complete', 'blocked', 'out_of_scope'
           )
             AND route_elevation_backfill_jobs.path_fingerprint <> EXCLUDED.path_fingerprint
           THEN NULL ELSE route_elevation_backfill_jobs.final_evidence END,
         next_attempt_at = CASE WHEN route_elevation_backfill_jobs.state = 'working' AND route_elevation_backfill_jobs.lease_expires_at < now() THEN now()
           WHEN route_elevation_backfill_jobs.state IN ('complete', 'blocked', 'out_of_scope')
           AND route_elevation_backfill_jobs.path_fingerprint <> EXCLUDED.path_fingerprint THEN now()
           ELSE route_elevation_backfill_jobs.next_attempt_at END,
         lease_owner = CASE WHEN route_elevation_backfill_jobs.state = 'working' AND route_elevation_backfill_jobs.lease_expires_at >= now()
           THEN route_elevation_backfill_jobs.lease_owner ELSE NULL END,
         lease_token = CASE WHEN route_elevation_backfill_jobs.state = 'working' AND route_elevation_backfill_jobs.lease_expires_at >= now()
           THEN route_elevation_backfill_jobs.lease_token ELSE NULL END,
         lease_expires_at = CASE WHEN route_elevation_backfill_jobs.state = 'working' AND route_elevation_backfill_jobs.lease_expires_at >= now()
           THEN route_elevation_backfill_jobs.lease_expires_at ELSE NULL END`
    );
    const requeuedChangedComplete = await client.query(
      `UPDATE route_elevation_backfill_jobs j
       SET state = 'queued',
           path_fingerprint = current_route.path_fingerprint,
           attempt_count = 0,
           next_attempt_at = now(),
           last_error = NULL,
           final_evidence = NULL
       FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) current_route
       WHERE j.route_id = current_route.route_id
         AND j.state = 'complete'
         AND j.path_fingerprint <> current_route.path_fingerprint`
    );
    const requeuedChangedBlocked = await client.query(
      `UPDATE route_elevation_backfill_jobs j
       SET state = 'queued',
           path_fingerprint = current_route.path_fingerprint,
           attempt_count = 0,
           next_attempt_at = now(),
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = NULL,
           final_evidence = NULL
       FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) current_route
       WHERE j.route_id = current_route.route_id
         AND j.state = 'blocked'
         AND j.path_fingerprint <> current_route.path_fingerprint`
    );
    const retired = await client.query(
      `UPDATE route_elevation_backfill_jobs j SET state = 'out_of_scope', lease_owner = NULL, lease_token = NULL,
         lease_expires_at = NULL, last_error = 'route no longer Peaks-owned with a path'
       WHERE (j.state <> 'working' OR j.lease_expires_at < now())
         AND NOT EXISTS (
           SELECT 1 FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) in_scope
           WHERE in_scope.route_id = j.route_id
         )`
    );
    await client.query("COMMIT");
    print({
      mode: "apply",
      seeded: seeded.rowCount,
      requeued_changed_complete: requeuedChangedComplete.rowCount,
      requeued_changed_blocked: requeuedChangedBlocked.rowCount,
      marked_out_of_scope: retired.rowCount,
    });
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
      `SELECT j.*, r.name AS route_name
       FROM route_elevation_backfill_jobs j
       JOIN routes r ON r.id = j.route_id
       WHERE j.state IN ('queued', 'retry') AND j.next_attempt_at <= now()
       ORDER BY j.priority DESC, j.next_attempt_at, j.route_id
       FOR UPDATE OF j SKIP LOCKED LIMIT 1`
    );
    const job = next.rows[0];
    if (!job || !apply) { await client.query("ROLLBACK"); print({ mode: apply ? "apply" : "dry_run", job: compactJob(job) }); return; }
    const claimed = await client.query<Job>(
      `UPDATE route_elevation_backfill_jobs SET state = 'working', attempt_count = attempt_count + 1,
       lease_owner = $2, lease_token = $3, lease_expires_at = now() + interval '15 minutes', last_error = NULL
       WHERE route_id = $1 RETURNING *`, [job.route_id, workerId, randomUUID()]
    );
    await client.query("COMMIT");
    print({
      mode: "apply",
      job: compactJob({ ...claimed.rows[0]!, route_name: job.route_name }),
    });
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
  print({
    outcome: retryOutcome(result.rows[0].state),
    state: result.rows[0].state,
    job: compactJob(result.rows[0]),
  });
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
  const route = await client.query<{ id: string; name: string | null; owner: string; status: string; path_hash: string | null; xy_hash: string | null }>(
    `SELECT id, name, owner, status, CASE WHEN path IS NULL THEN NULL ELSE md5(encode(ST_AsEWKB(path::geometry), 'hex')) END AS path_hash,
            CASE WHEN path IS NULL THEN NULL ELSE md5(encode(ST_AsEWKB(ST_Force2D(path::geometry)), 'hex')) END AS xy_hash
     FROM routes WHERE id = $1`, [id]
  );
  const current = route.rows[0];
  return current ? { ...current, points: await pointsFor(client, "routes", id) } : null;
}

async function segmentSnapshots(client: PoolClient | typeof db, routeId: string): Promise<SegmentSnapshot[]> {
  const rows = await client.query<{
    id: string;
    path_hash: string | null;
    gain: number | null;
    gain_loss: number | null;
    computed_gain: number | null;
    computed_loss: number | null;
    user_route_reference_count: number;
  }>(
    `SELECT DISTINCT s.id,
            CASE WHEN s.path IS NULL THEN NULL
                 ELSE md5(encode(ST_AsEWKB(s.path::geometry), 'hex'))
            END AS path_hash,
            s.gain,
            s.gain_loss,
            elevation_stats.gain AS computed_gain,
            elevation_stats.loss AS computed_loss,
            (
              SELECT count(*)::int
              FROM route_segments shared_rs
              JOIN routes shared_route ON shared_route.id = shared_rs.route_id
              WHERE shared_rs.segment_id = s.id
                AND shared_route.owner <> 'peaks'
            ) AS user_route_reference_count
     FROM route_segments rs
     JOIN segments s ON s.id = rs.segment_id
     CROSS JOIN LATERAL route_elevation_stats(s.path) elevation_stats
     WHERE rs.route_id = $1
     ORDER BY s.id`,
    [routeId]
  );
  return Promise.all(rows.rows.map(async (row) => ({ ...row, points: await pointsFor(client, "segments", row.id) })));
}

async function affectedPeaksRoutes(client: PoolClient | typeof db, segmentIds: string[]): Promise<RouteSnapshot[]> {
  if (segmentIds.length === 0) return [];
  const routes = await client.query<{ id: string }>(
    `SELECT DISTINCT r.id FROM routes r JOIN route_segments rs ON rs.route_id = r.id
     WHERE r.owner = 'peaks' AND r.status IN ('active', 'pending')
       AND rs.segment_id = ANY($1::text[]) ORDER BY r.id`, [segmentIds]
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

export function segmentNeedsTerrainSampling(
  assembledRoutePoints: Point[],
  segmentPoints: Point[]
): boolean {
  return segmentNeedsTerrainSamplingAcrossRoutes(
    [assembledRoutePoints],
    segmentPoints
  );
}

export function segmentNeedsTerrainSamplingAcrossRoutes(
  assembledRoutePoints: Point[][],
  segmentPoints: Point[]
): boolean {
  const segmentProfile = existingProfile(segmentPoints);
  if (!segmentProfile) return true;
  if (routeProfileHasRealRange(segmentProfile)) return false;

  return assembledRoutePoints.some((points) => {
    const assembledProfile = existingProfile(points);
    return (
      assembledProfile === null ||
      !routeProfileHasRealRange(assembledProfile)
    );
  });
}

async function sourceAssemblyPoints(
  client: PoolClient | typeof db,
  routeId: string
): Promise<Point[]> {
  const result = await client.query<Point>(
    `WITH ordered_segments AS (
       SELECT rs.ordinal,
              row_number() OVER (
                ORDER BY rs.ordinal, rs.segment_id
              ) AS segment_sequence,
              CASE rs.direction
                WHEN 'reverse' THEN ST_Reverse(s.path::geometry)
                ELSE s.path::geometry
              END AS directed_path
       FROM route_segments rs
       JOIN segments s ON s.id = rs.segment_id
       WHERE rs.route_id = $1
         AND s.path IS NOT NULL
     ), segment_points AS (
       SELECT ordered_segments.ordinal,
              ordered_segments.segment_sequence,
              (dumped).path[1]::int AS segment_vertex,
              (dumped).geom AS geom
       FROM ordered_segments
       CROSS JOIN LATERAL
         ST_DumpPoints(ordered_segments.directed_path) dumped
       WHERE ordered_segments.segment_sequence = 1
          OR (dumped).path[1] > 1
     )
     SELECT ST_Y(geom)::float8 AS lat,
            ST_X(geom)::float8 AS lng,
            ST_Z(geom)::float8 AS elevation
     FROM segment_points
     ORDER BY ordinal, segment_vertex`,
    [routeId]
  );
  return result.rows;
}

async function sourceAssemblyMatchesRouteXY(
  client: PoolClient | typeof db,
  routeId: string
): Promise<boolean> {
  const result = await client.query<{ matches: boolean }>(
    `WITH ordered_segments AS (
       SELECT row_number() OVER (
                ORDER BY rs.ordinal, rs.segment_id
              ) AS segment_sequence,
              CASE rs.direction
                WHEN 'reverse' THEN ST_Reverse(s.path::geometry)
                ELSE s.path::geometry
              END AS directed_path
       FROM route_segments rs
       JOIN segments s ON s.id = rs.segment_id
       WHERE rs.route_id = $1
         AND s.path IS NOT NULL
     ), segment_points AS (
       SELECT ordered_segments.segment_sequence,
              (dumped).path[1]::int AS segment_vertex,
              (dumped).geom AS geom
       FROM ordered_segments
       CROSS JOIN LATERAL
         ST_DumpPoints(ordered_segments.directed_path) dumped
       WHERE ordered_segments.segment_sequence = 1
          OR (dumped).path[1] > 1
     ), assembled AS (
       SELECT ST_MakeLine(
                geom ORDER BY segment_sequence, segment_vertex
              ) AS path
       FROM segment_points
     )
     SELECT COALESCE(
              ST_AsEWKB(ST_Force2D(r.path::geometry)) =
                ST_AsEWKB(ST_Force2D(assembled.path)),
              false
            ) AS matches
     FROM routes r
     CROSS JOIN assembled
     WHERE r.id = $1`,
    [routeId]
  );
  return result.rows[0]?.matches === true;
}

async function affectedSegmentConsumers(
  client: PoolClient | typeof db,
  routeIds: string[],
  segmentIds: string[]
): Promise<Map<string, string[]>> {
  const result = await client.query<{
    segment_id: string;
    route_id: string;
  }>(
    `SELECT segment_id, route_id
     FROM route_segments
     WHERE route_id = ANY($1::text[])
       AND segment_id = ANY($2::text[])
     ORDER BY segment_id, route_id`,
    [routeIds, segmentIds]
  );
  const consumers = new Map<string, string[]>();
  for (const row of result.rows) {
    const routeIdsForSegment = consumers.get(row.segment_id) ?? [];
    routeIdsForSegment.push(row.route_id);
    consumers.set(row.segment_id, routeIdsForSegment);
  }
  return consumers;
}

async function completeProfile(
  points: Point[],
  forceTerrain = false
): Promise<{ elevations: number[]; sourceKind: string }> {
  const existing = forceTerrain ? null : existingProfile(points);
  if (existing) return { elevations: existing, sourceKind: "existing_z" };
  return {
    elevations: await sampleTerrariumProfile(points.map(({ lat, lng }) => ({ lat, lng })), {
      cacheDir: process.env.PEAKS_TERRARIUM_CACHE_DIR ?? join(tmpdir(), "peaks-route-elevation-terrarium"),
    }),
    sourceKind: "terrarium_z14",
  };
}

async function applySegmentProfile(
  client: PoolClient,
  id: string,
  elevations: number[]
): Promise<void> {
  const stats = computeRouteElevationStats(elevations);
  const result = await client.query(
    `WITH points AS (
       SELECT row_number() OVER (ORDER BY (dumped).path)::int AS n, (dumped).geom AS geom
       FROM segments, ST_DumpPoints(path::geometry) dumped WHERE id = $1
     ), rebuilt AS (
       SELECT ST_SetSRID(ST_MakeLine(array_agg(ST_SetSRID(ST_MakePoint(ST_X(geom), ST_Y(geom), $2[n]), 4326) ORDER BY n)), 4326)::geography AS path
       FROM points
     ) UPDATE segments SET path = rebuilt.path, gain = $3, gain_loss = $4
       FROM rebuilt WHERE id = $1`,
    [id, elevations, stats.gain, stats.loss]
  );
  if (result.rowCount !== 1) throw new Error("Could not update segment");
}

async function applyLegacyRouteProfile(
  client: PoolClient,
  id: string,
  elevations: number[]
): Promise<void> {
  const stats = computeRouteElevationStats(elevations);
  const result = await client.query(
    `WITH points AS (
       SELECT row_number() OVER (ORDER BY (dumped).path)::int AS n,
              (dumped).geom AS geom
       FROM routes, ST_DumpPoints(path::geometry) dumped
       WHERE id = $1
     ), rebuilt AS (
       SELECT ST_SetSRID(
                ST_MakeLine(
                  array_agg(
                    ST_SetSRID(
                      ST_MakePoint(ST_X(geom), ST_Y(geom), $2[n]),
                      4326
                    )
                    ORDER BY n
                  )
                ),
                4326
              )::geography AS path
       FROM points
     )
     UPDATE routes
     SET path = rebuilt.path,
         gain = $3,
         gain_loss = $4
     FROM rebuilt
     WHERE id = $1
       AND owner = 'peaks'
       AND status IN ('active', 'pending')
       AND NOT EXISTS (
         SELECT 1 FROM route_segments WHERE route_id = $1
       )`,
    [id, elevations, stats.gain, stats.loss]
  );
  if (result.rowCount !== 1) {
    throw new Error("Legacy route gained source segments before elevation write");
  }
}

function cloneSegmentId(
  segment: Pick<SegmentSnapshot, "id" | "path_hash">
): string {
  return `route-elevation-clone-${createHash("sha256")
    .update(`${segment.id}:${segment.path_hash ?? "missing"}`)
    .digest("hex")}`;
}

export function elevationSegmentScopeIds(
  segments: Array<Pick<SegmentSnapshot, "id" | "path_hash">>
): string[] {
  return [...new Set(
    segments.flatMap((segment) => [
      segment.id,
      cloneSegmentId(segment),
    ])
  )].sort();
}

async function cloneUserSharedSegment(
  client: PoolClient,
  segment: SegmentSnapshot
): Promise<string> {
  const cloneId = cloneSegmentId(segment);
  await client.query(
    `INSERT INTO segments (
       id, name, path, polyline6, distance, gain, gain_loss, provenance
     )
     SELECT $2, name, path, polyline6, distance, gain, gain_loss, provenance
     FROM segments
     WHERE id = $1
     ON CONFLICT (id) DO NOTHING`,
    [segment.id, cloneId]
  );
  const clone = await client.query<{ xy_hash: string | null }>(
    `SELECT CASE WHEN path IS NULL THEN NULL
                 ELSE md5(encode(ST_AsEWKB(ST_Force2D(path::geometry)), 'hex'))
            END AS xy_hash
     FROM segments WHERE id = $1 FOR UPDATE`,
    [cloneId]
  );
  const original = await client.query<{ xy_hash: string | null }>(
    `SELECT CASE WHEN path IS NULL THEN NULL
                 ELSE md5(encode(ST_AsEWKB(ST_Force2D(path::geometry)), 'hex'))
            END AS xy_hash
     FROM segments WHERE id = $1`,
    [segment.id]
  );
  if (!clone.rows[0] || clone.rows[0].xy_hash !== original.rows[0]?.xy_hash) {
    throw new Error("Deterministic segment clone collision");
  }
  await client.query(
    `UPDATE route_segments rs
     SET segment_id = $2
     FROM routes r
     WHERE r.id = rs.route_id
       AND r.owner = 'peaks'
       AND r.status IN ('active', 'pending')
       AND rs.segment_id = $1`,
    [segment.id, cloneId]
  );
  return cloneId;
}

async function rebuildPeaksRouteFromSegments(
  client: PoolClient,
  routeId: string
): Promise<void> {
  const rebuilt = await client.query(
     `WITH ordered_segments AS (
       SELECT rs.ordinal,
              row_number() OVER (ORDER BY rs.ordinal, rs.segment_id) AS segment_sequence,
              CASE rs.direction
                WHEN 'reverse' THEN ST_Reverse(s.path::geometry)
                ELSE s.path::geometry
              END AS directed_path
       FROM route_segments rs
       JOIN segments s ON s.id = rs.segment_id
       WHERE rs.route_id = $1 AND s.path IS NOT NULL
       ORDER BY rs.ordinal
     ), segment_points AS (
       SELECT ordered_segments.ordinal,
              ordered_segments.segment_sequence,
              (dumped).path[1]::int AS segment_vertex,
              (dumped).geom AS geom
       FROM ordered_segments
       CROSS JOIN LATERAL ST_DumpPoints(ordered_segments.directed_path) dumped
       WHERE ordered_segments.segment_sequence = 1 OR (dumped).path[1] > 1
     ), assembled AS (
       SELECT ST_SetSRID(
                ST_MakeLine(geom ORDER BY ordinal, segment_vertex),
                4326
              )::geography AS path
       FROM segment_points
     ), computed AS (
       SELECT assembled.path, elevation_stats.gain, elevation_stats.loss
       FROM assembled
       CROSS JOIN LATERAL route_elevation_stats(assembled.path) elevation_stats
       WHERE assembled.path IS NOT NULL
         AND ST_NPoints(assembled.path::geometry) >= 2
     )
     UPDATE routes r
     SET path = computed.path,
         gain = computed.gain,
         gain_loss = computed.loss
     FROM computed
     WHERE r.id = $1
       AND r.owner = 'peaks'
       AND r.status IN ('active', 'pending')`,
    [routeId]
  );
  if (rebuilt.rowCount !== 1) {
    throw new Error("Route has no usable ordered segment assembly");
  }
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
    `SELECT path_fingerprint FROM (${ELEVATION_ROUTE_FINGERPRINT_SQL}) candidates WHERE route_id = $1`, [routeId]
  );
  return result.rows[0]?.path_fingerprint ?? null;
}

interface PersistedRouteEvidence extends PersistedElevationLineage {
  id: string;
  status: string;
  point_count: number;
  elevation_string: string;
  profile_hash: string;
  gain: number;
  gain_loss: number;
  publish_integrity_valid: boolean;
}

export function routeElevationLineageEvidence(
  route: Pick<
    PersistedRouteEvidence,
    | "elevation_source"
    | "elevation_source_url"
    | "elevation_attribution"
    | "elevation_license_url"
    | "elevation_retrieved_at"
  >
): {
  source_kind: "terrarium_z14" | "existing_z";
  terrain_source: string;
  terrain_source_url: string | null;
  terrain_source_endpoint: string | null;
  terrain_data_license: string;
  terrain_license_url: string | null;
  terrain_attribution: string | null;
  terrain_retrieved_at: Date | string | null;
} {
  const terrarium = route.elevation_source === TERRAIN_SOURCE_NAME;
  return {
    source_kind: terrarium ? "terrarium_z14" : "existing_z",
    terrain_source:
      route.elevation_source ?? "stored PostGIS segment elevations",
    terrain_source_url: route.elevation_source_url,
    terrain_source_endpoint: terrarium ? TERRAIN_SOURCE_ENDPOINT : null,
    terrain_data_license: terrarium
      ? TERRAIN_DATA_LICENSE
      : "original segment provenance",
    terrain_license_url: route.elevation_license_url,
    terrain_attribution: route.elevation_attribution,
    terrain_retrieved_at: route.elevation_retrieved_at,
  };
}

export function publicElevationEvidenceMatches(
  route: Pick<
    PersistedRouteEvidence,
    | "point_count"
    | "elevation_string"
    | "profile_hash"
    | "gain"
    | "gain_loss"
    | "elevation_source"
    | "elevation_source_url"
    | "elevation_attribution"
    | "elevation_license_url"
    | "elevation_retrieved_at"
  >,
  body: PublicElevationLineage & {
    elevation_string?: unknown;
    profile_count?: unknown;
    profile_hash?: unknown;
    gain?: unknown;
    gain_loss?: unknown;
    publish_integrity_valid?: unknown;
  }
): boolean {
  return (
    body.profile_count === route.point_count &&
    body.elevation_string === route.elevation_string &&
    body.profile_hash === route.profile_hash &&
    body.gain === route.gain &&
    body.gain_loss === route.gain_loss &&
    publicElevationLineageMatches(route, body) &&
    body.publish_integrity_valid === true
  );
}

async function verifyPublicRoute(
  route: PersistedRouteEvidence,
  fingerprint: string
): Promise<{ kind: string }> {
  if (route.status !== "active") return { kind: "public_not_applicable: pending" };
  const base = process.env.PEAKS_PUBLIC_ROUTE_VERIFIER_BASE_URL;
  if (!base) throw new Error("Public route verifier base URL is required for active routes");
  const response = await fetch(`${base.replace(/\/$/, "")}/routes/${encodeURIComponent(route.id)}?elevation_fingerprint=${encodeURIComponent(fingerprint)}`, {
    headers: { "cache-control": "no-cache" },
  });
  if (!response.ok) throw new Error(`Public route verification failed (${response.status})`);
  const body = await response.json() as PublicElevationLineage & {
    elevation_string?: unknown;
    profile_count?: unknown;
    profile_hash?: unknown;
    gain?: unknown;
    gain_loss?: unknown;
    publish_integrity_valid?: unknown;
  };
  if (!publicElevationEvidenceMatches(route, body)) {
    throw new Error("Public route elevation evidence did not match");
  }
  return { kind: "public_profile_and_stats_verified" };
}

async function verifyPersistedRoute(
  client: PoolClient,
  routeId: string
): Promise<PersistedRouteEvidence> {
  const result = await client.query<{
    id: string;
    status: string;
    point_count: number;
    valid_z: boolean;
    elevation_string: string | null;
    encoded_profile: string | null;
    profile_hash: string | null;
    gain: number | null;
    gain_loss: number | null;
    computed_gain: number | null;
    computed_loss: number | null;
    has_real_range: boolean;
    assembly_matches: boolean;
    elevation_source: string | null;
    elevation_source_url: string | null;
    elevation_attribution: string | null;
    elevation_license_url: string | null;
    elevation_retrieved_at: Date | null;
    publish_integrity_valid: boolean;
  }>(
    `WITH ordered_segments AS (
       SELECT rs.ordinal,
              row_number() OVER (ORDER BY rs.ordinal, rs.segment_id) AS segment_sequence,
              CASE rs.direction
                WHEN 'reverse' THEN ST_Reverse(s.path::geometry)
                ELSE s.path::geometry
              END AS directed_path
       FROM route_segments rs
       JOIN segments s ON s.id = rs.segment_id
       WHERE rs.route_id = $1 AND s.path IS NOT NULL
     ), segment_points AS (
       SELECT ordered_segments.ordinal,
              ordered_segments.segment_sequence,
              (dumped).path[1]::int AS segment_vertex,
              (dumped).geom AS geom
       FROM ordered_segments
       CROSS JOIN LATERAL ST_DumpPoints(ordered_segments.directed_path) dumped
       WHERE ordered_segments.segment_sequence = 1 OR (dumped).path[1] > 1
     ), assembled AS (
       SELECT ST_SetSRID(
                ST_MakeLine(geom ORDER BY ordinal, segment_vertex),
                4326
              ) AS path
       FROM segment_points
     )
     SELECT r.id, r.status, ST_NPoints(r.path::geometry)::int AS point_count,
            (SELECT bool_and(ST_Z((dumped).geom) BETWEEN -12000 AND 12000)
             FROM ST_DumpPoints(r.path::geometry) dumped) AS valid_z,
            r.elevation_string,
            encode_route_elevation_profile(r.path) AS encoded_profile,
            md5(r.elevation_string) AS profile_hash,
            r.gain, r.gain_loss,
            elevation_stats.gain AS computed_gain,
            elevation_stats.loss AS computed_loss,
            route_elevation_profile_has_real_range(r.path) AS has_real_range,
            encode(ST_AsEWKB(r.path::geometry), 'hex')
              = encode(ST_AsEWKB(assembled.path), 'hex') AS assembly_matches,
            r.elevation_source,
            r.elevation_source_url,
            r.elevation_attribution,
            r.elevation_license_url,
            r.elevation_retrieved_at,
            CASE WHEN r.status = 'active'
              THEN peaks_route_passes_publish_integrity(r.id, NULL, 'active')
              ELSE true END AS publish_integrity_valid
     FROM routes r
     CROSS JOIN assembled
     CROSS JOIN LATERAL route_elevation_stats(r.path) elevation_stats
     WHERE r.id = $1`,
    [routeId]
  );
  const saved = result.rows[0];
  const profile = decodeElevationProfile(
    saved?.elevation_string ?? null,
    saved?.point_count
  );
  if (
    !saved ||
    !saved.valid_z ||
    !saved.assembly_matches ||
    !saved.has_real_range ||
    saved.elevation_string !== saved.encoded_profile ||
    !routeProfileHasRealRange(profile) ||
    saved.gain !== saved.computed_gain ||
    saved.gain_loss !== saved.computed_loss ||
    !saved.elevation_string ||
    !saved.profile_hash ||
    saved.gain === null ||
    saved.gain_loss === null
  ) {
    throw new Error("Affected route verification failed");
  }
  return {
    id: saved.id,
    status: saved.status,
    point_count: saved.point_count,
    elevation_string: saved.elevation_string,
    profile_hash: saved.profile_hash,
    gain: saved.gain,
    gain_loss: saved.gain_loss,
    elevation_source: saved.elevation_source,
    elevation_source_url: saved.elevation_source_url,
    elevation_attribution: saved.elevation_attribution,
    elevation_license_url: saved.elevation_license_url,
    elevation_retrieved_at: saved.elevation_retrieved_at,
    publish_integrity_valid: saved.publish_integrity_valid,
  };
}

async function verifyLegacyPersistedRoute(
  client: PoolClient,
  routeId: string,
  expectedXyHash: string
): Promise<PersistedRouteEvidence> {
  const result = await client.query<{
    id: string;
    status: string;
    point_count: number;
    valid_z: boolean;
    xy_hash: string;
    elevation_string: string | null;
    encoded_profile: string | null;
    profile_hash: string | null;
    gain: number | null;
    gain_loss: number | null;
    computed_gain: number | null;
    computed_loss: number | null;
    has_real_range: boolean;
    elevation_source: string | null;
    elevation_source_url: string | null;
    elevation_attribution: string | null;
    elevation_license_url: string | null;
    elevation_retrieved_at: Date | null;
  }>(
    `SELECT r.id,
            r.status,
            ST_NPoints(r.path::geometry)::int AS point_count,
            (SELECT bool_and(
               ST_Z((dumped).geom) BETWEEN -12000 AND 12000
             )
             FROM ST_DumpPoints(r.path::geometry) dumped) AS valid_z,
            md5(encode(
              ST_AsEWKB(ST_Force2D(r.path::geometry)),
              'hex'
            )) AS xy_hash,
            r.elevation_string,
            encode_route_elevation_profile(r.path) AS encoded_profile,
            md5(r.elevation_string) AS profile_hash,
            r.gain,
            r.gain_loss,
            elevation_stats.gain AS computed_gain,
            elevation_stats.loss AS computed_loss,
            route_elevation_profile_has_real_range(r.path) AS has_real_range,
            r.elevation_source,
            r.elevation_source_url,
            r.elevation_attribution,
            r.elevation_license_url,
            r.elevation_retrieved_at
     FROM routes r
     CROSS JOIN LATERAL route_elevation_stats(r.path) elevation_stats
     WHERE r.id = $1
       AND r.owner = 'peaks'
       AND r.status IN ('active', 'pending')
       AND NOT EXISTS (
         SELECT 1 FROM route_segments WHERE route_id = r.id
       )`,
    [routeId]
  );
  const saved = result.rows[0];
  const profile = decodeElevationProfile(
    saved?.elevation_string ?? null,
    saved?.point_count
  );
  if (
    !saved ||
    saved.xy_hash !== expectedXyHash ||
    !saved.valid_z ||
    !saved.has_real_range ||
    saved.elevation_string !== saved.encoded_profile ||
    !routeProfileHasRealRange(profile) ||
    saved.gain !== saved.computed_gain ||
    saved.gain_loss !== saved.computed_loss ||
    !saved.elevation_string ||
    !saved.profile_hash ||
    saved.gain === null ||
    saved.gain_loss === null
  ) {
    throw new Error("Legacy route elevation verification failed");
  }
  return {
    id: saved.id,
    status: saved.status,
    point_count: saved.point_count,
    elevation_string: saved.elevation_string,
    profile_hash: saved.profile_hash,
    gain: saved.gain,
    gain_loss: saved.gain_loss,
    elevation_source: saved.elevation_source,
    elevation_source_url: saved.elevation_source_url,
    elevation_attribution: saved.elevation_attribution,
    elevation_license_url: saved.elevation_license_url,
    elevation_retrieved_at: saved.elevation_retrieved_at,
    publish_integrity_valid: false,
  };
}

async function extendLease(routeId: string, token: string): Promise<void> {
  const result = await db.query(
    `UPDATE route_elevation_backfill_jobs SET lease_expires_at = now() + interval '15 minutes'
     WHERE route_id = $1 AND state = 'working' AND lease_token = $2 AND lease_expires_at >= now()`, [routeId, token]
  );
  if (result.rowCount !== 1) throw new Error("Route elevation lease expired before public verification");
}

async function failLease(
  routeId: string,
  token: string,
  error: unknown,
  routeName?: string | null
): Promise<void> {
  const result = await db.query<Job>(
    `UPDATE route_elevation_backfill_jobs SET state = CASE WHEN attempt_count >= $3 THEN 'blocked' ELSE 'retry' END,
       lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = $4,
       next_attempt_at = CASE WHEN attempt_count >= $3 THEN next_attempt_at ELSE now() + interval '2 minutes' END
     WHERE route_id = $1 AND state = 'working' AND lease_token = $2 RETURNING *`,
    [routeId, token, MAX_ATTEMPTS, safeError(error)]
  );
  if (!result.rows[0]) throw new Error("No live route elevation lease matched");
  print({
    outcome: retryOutcome(result.rows[0].state),
    state: result.rows[0].state,
    job: compactJob({ ...result.rows[0], route_name: routeName }),
  });
}

async function blockLease(
  routeId: string,
  token: string,
  fingerprint: string,
  cause: string,
  evidence: Record<string, unknown>,
  routeName?: string | null
): Promise<void> {
  const result = await db.query<Job>(
    `UPDATE route_elevation_backfill_jobs
     SET state = 'blocked',
         path_fingerprint = $3,
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         last_error = $4,
         final_evidence = $5::jsonb
     WHERE route_id = $1
       AND state = 'working'
       AND lease_token = $2
     RETURNING *`,
    [routeId, token, fingerprint, safeError(cause), JSON.stringify(evidence)]
  );
  if (!result.rows[0]) throw new Error("No live route elevation lease matched");
  print({
    outcome: "blocked",
    state: "blocked",
    route_id: routeId,
    route_name: routeName ?? null,
    blocker: result.rows[0].last_error,
    job: compactJob({ ...result.rows[0], route_name: routeName }),
  });
}

async function hasLiveLease(routeId: string, token: string): Promise<boolean> {
  const result = await db.query<{ live: boolean }>(
    `SELECT true AS live FROM route_elevation_backfill_jobs WHERE route_id = $1 AND state = 'working'
     AND lease_token = $2 AND lease_expires_at >= now()`, [routeId, token]
  );
  return result.rows[0]?.live === true;
}

async function processLegacyRoute(
  routeId: string,
  token: string,
  fingerprint: string,
  snapshot: RouteSnapshot
): Promise<void> {
  const existing = existingProfile(snapshot.points);
  const needsTerrain =
    existing === null || !routeProfileHasRealRange(existing);
  const completedProfile = await completeProfile(
    snapshot.points,
    needsTerrain
  );
  const terrainRetrievedAt =
    completedProfile.sourceKind === "terrarium_z14"
      ? new Date().toISOString()
      : null;
  const client = await db.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const job = await liveJob(client, routeId, token);
    if (!job || job.path_fingerprint !== fingerprint) {
      throw new Error("Legacy route elevation lease changed before write");
    }
    const locked = await client.query<{
      owner: string;
      status: string;
      path_hash: string | null;
    }>(
      `SELECT owner,
              status,
              CASE WHEN path IS NULL THEN NULL
                   ELSE md5(encode(ST_AsEWKB(path::geometry), 'hex'))
              END AS path_hash
       FROM routes
       WHERE id = $1
       FOR UPDATE`,
      [routeId]
    );
    const current = locked.rows[0];
    if (
      !current ||
      current.owner !== "peaks" ||
      !["active", "pending"].includes(current.status) ||
      current.path_hash !== snapshot.path_hash ||
      await currentFingerprint(client, routeId) !== fingerprint
    ) {
      throw new Error("Legacy route changed while terrain was sampled");
    }
    await client.query(
      `SELECT route_id
       FROM route_segments
       WHERE route_id = $1
       FOR UPDATE`,
      [routeId]
    );
    await applyLegacyRouteProfile(
      client,
      routeId,
      completedProfile.elevations
    );
    if (terrainRetrievedAt) {
      await client.query(
        `UPDATE routes
         SET elevation_source = $2,
             elevation_source_url = $3,
             elevation_attribution = $4,
             elevation_license_url = $5,
             elevation_retrieved_at = $6::timestamptz
         WHERE id = $1
           AND owner = 'peaks'
           AND status IN ('active', 'pending')`,
        [
          routeId,
          TERRAIN_SOURCE_NAME,
          TERRAIN_SOURCE_URL,
          TERRAIN_ATTRIBUTION,
          TERRAIN_LICENSE_URL,
          terrainRetrievedAt,
        ]
      );
    }
    const saved = await verifyLegacyPersistedRoute(
      client,
      routeId,
      snapshot.xy_hash!
    );
    const finalFingerprint = await currentFingerprint(client, routeId);
    if (!finalFingerprint) {
      throw new Error("Legacy route left elevation scope before blocking");
    }
    const cause = "missing_route_segments_requires_route_factory";
    const evidence = {
      point_count: saved.point_count,
      profile_hash: saved.profile_hash,
      ...routeElevationLineageEvidence(saved),
      verification: "elevation_written_missing_route_segments",
      cause,
    };
    const blocked = await client.query<Job>(
      `UPDATE route_elevation_backfill_jobs
       SET state = 'blocked',
           path_fingerprint = $3,
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = $4,
           final_evidence = $5::jsonb
       WHERE route_id = $1
         AND state = 'working'
         AND lease_token = $2
       RETURNING *`,
      [
        routeId,
        token,
        finalFingerprint,
        cause,
        JSON.stringify(evidence),
      ]
    );
    if (!blocked.rows[0]) {
      throw new Error("No live route elevation lease matched");
    }
    await client.query("COMMIT");
    print({
      outcome: "blocked",
      state: "blocked",
      route_id: routeId,
      route_name: snapshot.name,
      blocker: cause,
      job: compactJob({
        ...blocked.rows[0],
        route_name: snapshot.name,
      }),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function processRoute(routeId: string, token: string, apply: boolean): Promise<void> {
  if (!apply) throw new Error("process requires --apply");
  if (!await hasLiveLease(routeId, token)) throw new Error("No live route elevation lease matched");
  const beforeSampling = await db.query<Job>(
    `SELECT j.*, r.name AS route_name
     FROM route_elevation_backfill_jobs j
     JOIN routes r ON r.id = j.route_id
     WHERE j.route_id = $1 AND j.state = 'working'
       AND j.lease_token = $2 AND j.lease_expires_at >= now()`, [routeId, token]
  );
  const preflightJob = beforeSampling.rows[0];
  if (!preflightJob) throw new Error("No live route elevation lease matched");
  const preflightFingerprint = await currentFingerprint(db, routeId);
  if (preflightFingerprint !== preflightJob.path_fingerprint) {
    const state = preflightFingerprint ? "queued" : "out_of_scope";
    const requeued = await db.query<Job>(
      `UPDATE route_elevation_backfill_jobs SET state = $3, path_fingerprint = COALESCE($4, path_fingerprint),
       attempt_count = CASE WHEN $4 IS NULL THEN attempt_count ELSE 0 END,
       lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, next_attempt_at = now(),
       final_evidence = CASE WHEN $4 IS NULL THEN final_evidence ELSE NULL END,
       last_error = CASE WHEN $4 IS NULL THEN 'route is out of scope' ELSE NULL END
       WHERE route_id = $1 AND state = 'working' AND lease_token = $2 RETURNING *`,
      [routeId, token, state, preflightFingerprint]
    );
    if (!requeued.rows[0]) throw new Error("No live route elevation lease matched");
    print({
      outcome: preflightFingerprint ? "path_changed_requeued" : "out_of_scope",
      job: compactJob({
        ...requeued.rows[0]!,
        route_name: preflightJob.route_name,
      }),
    });
    return;
  }
  let processRouteName = preflightJob.route_name;
  try {
    const snapshot = await routeSnapshot(db, routeId);
    if (!snapshot) throw new Error("Route does not exist");
    processRouteName = snapshot.name;
    if (
      snapshot.owner !== "peaks" ||
      !["active", "pending"].includes(snapshot.status) ||
      !snapshot.path_hash ||
      snapshot.points.length < 2
    ) {
      throw new Error("Route is not a Peaks-owned active or pending usable path");
    }
    const segments = await segmentSnapshots(db, routeId);
    if (segments.length === 0) {
      await processLegacyRoute(
        routeId,
        token,
        preflightFingerprint!,
        snapshot
      );
      return;
    }
    const segmentScopeIds = elevationSegmentScopeIds(segments);
    const affected = await affectedPeaksRoutes(db, segmentScopeIds);
    if (!affected.some((route) => route.id === routeId)) affected.push(snapshot);
    const xyDriftRouteIds: string[] = [];
    const assemblyPointsByRoute = new Map<string, Point[]>();
    for (const route of affected) {
      if (!await sourceAssemblyMatchesRouteXY(db, route.id)) {
        xyDriftRouteIds.push(route.id);
      } else {
        assemblyPointsByRoute.set(
          route.id,
          await sourceAssemblyPoints(db, route.id)
        );
      }
    }
    if (xyDriftRouteIds.length > 0) {
      await blockLease(
        routeId,
        token,
        preflightFingerprint!,
        "segment_xy_drift_requires_route_factory",
        {
          verification: "blocked_before_write",
          cause: "segment_xy_drift_requires_route_factory",
          affected_route_ids: xyDriftRouteIds.sort(),
        },
        snapshot.name
      );
      return;
    }
    const consumersBySegment = await affectedSegmentConsumers(
      db,
      affected.map((route) => route.id),
      segmentScopeIds
    );
    const segmentProfiles = new Map<string, { elevations: number[]; sourceKind: string }>();
    for (const segment of segments) {
      const consumerRouteIds = new Set(
        [
          segment.id,
          cloneSegmentId(segment),
        ].flatMap((segmentId) =>
          consumersBySegment.get(segmentId) ?? []
        )
      );
      if (consumerRouteIds.size === 0) consumerRouteIds.add(routeId);
      const consumerAssemblies = [...consumerRouteIds].map((consumerRouteId) => {
        const points = assemblyPointsByRoute.get(consumerRouteId);
        if (!points) {
          throw new Error("Affected route assembly disappeared");
        }
        return points;
      });
      const needsTerrain = segmentNeedsTerrainSamplingAcrossRoutes(
        consumerAssemblies,
        segment.points
      );
      const storedProfile = existingProfile(segment.points);
      const needsStatsRepair =
        segment.gain !== segment.computed_gain ||
        segment.gain_loss !== segment.computed_loss;
      if (needsTerrain) {
        segmentProfiles.set(
          segment.id,
          await completeProfile(segment.points, true)
        );
      } else if (needsStatsRepair && storedProfile) {
        segmentProfiles.set(segment.id, {
          elevations: storedProfile,
          sourceKind: "existing_z",
        });
      }
    }
    const terrainRetrievedAt = [...segmentProfiles.values()].some(
      (profile) => profile.sourceKind === "terrarium_z14"
    )
      ? new Date().toISOString()
      : null;
    let written: {
      route: PersistedRouteEvidence;
      sourceKind: string;
      fingerprint: string;
      blockers: string[];
    } | null = null;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const job = await liveJob(client, routeId, token);
      if (!job) throw new Error("No live route elevation lease matched");
      const fingerprint = await currentFingerprint(client, routeId);
      if (fingerprint !== job.path_fingerprint) {
        const updated = await client.query<Job>(
          `UPDATE route_elevation_backfill_jobs SET state = 'queued', path_fingerprint = COALESCE($2, path_fingerprint),
           attempt_count = 0, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           last_error = NULL, final_evidence = NULL, next_attempt_at = now()
           WHERE route_id = $1 RETURNING *`, [routeId, fingerprint]
        );
        await client.query("COMMIT");
        print({
          outcome: "path_changed_requeued",
          job: compactJob({ ...updated.rows[0]!, route_name: snapshot.name }),
        });
        return;
      }
      const fresh = await routeSnapshot(client, routeId);
      if (
        !fresh ||
        fresh.owner !== "peaks" ||
        !["active", "pending"].includes(fresh.status) ||
        !fresh.path_hash ||
        fresh.points.length < 2
      ) {
        const updated = await client.query<Job>(
          `UPDATE route_elevation_backfill_jobs SET state = 'out_of_scope', lease_owner = NULL, lease_token = NULL,
           lease_expires_at = NULL, last_error = 'route is not a Peaks-owned usable path' WHERE route_id = $1 RETURNING *`, [routeId]
        );
        await client.query("COMMIT");
        print({
          outcome: "out_of_scope",
          job: compactJob({ ...updated.rows[0]!, route_name: snapshot.name }),
        });
        return;
      }
      if (fresh.path_hash !== snapshot.path_hash) {
        throw new Error("Route changed while terrain was sampled");
      }
      const sourceSegmentIds = [
        ...new Set(segments.map((segment) => segment.id)),
      ].sort();
      if (sourceSegmentIds.length > 0) {
        const lockedSegments = await client.query<{ id: string; path_hash: string | null }>(
          `SELECT id,
                  CASE WHEN path IS NULL THEN NULL
                       ELSE md5(encode(ST_AsEWKB(path::geometry), 'hex'))
                  END AS path_hash
           FROM segments
           WHERE id = ANY($1::text[])
           ORDER BY id
           FOR UPDATE`,
          [segmentScopeIds]
        );
        const lockedSourceSegments = lockedSegments.rows.filter((row) =>
          sourceSegmentIds.includes(row.id)
        );
        if (
          lockedSourceSegments.length !== sourceSegmentIds.length ||
          lockedSourceSegments.some((row) => {
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
          [segmentScopeIds]
        );
        const liveUserReferences = await client.query<{
          segment_id: string;
          user_route_reference_count: number;
        }>(
          `SELECT s.id AS segment_id,
                  count(rs.route_id) FILTER (
                    WHERE linked_route.owner <> 'peaks'
                  )::int AS user_route_reference_count
           FROM segments s
           LEFT JOIN route_segments rs ON rs.segment_id = s.id
           LEFT JOIN routes linked_route ON linked_route.id = rs.route_id
           WHERE s.id = ANY($1::text[])
           GROUP BY s.id
           ORDER BY s.id`,
          [sourceSegmentIds]
        );
        for (const segment of segments) {
          segment.user_route_reference_count =
            liveUserReferences.rows.find(
              (row) => row.segment_id === segment.id
            )?.user_route_reference_count ?? 0;
        }
        const currentAffected = await client.query<{ id: string }>(
          `SELECT DISTINCT r.id
           FROM route_segments rs
           JOIN routes r ON r.id = rs.route_id
           WHERE rs.segment_id = ANY($1::text[])
             AND r.owner = 'peaks'
             AND r.status IN ('active', 'pending')
           ORDER BY r.id`,
          [segmentScopeIds]
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
      const lockedXyDriftRouteIds: string[] = [];
      for (const route of affected) {
        if (!await sourceAssemblyMatchesRouteXY(client, route.id)) {
          lockedXyDriftRouteIds.push(route.id);
        }
      }
      if (lockedXyDriftRouteIds.length > 0) {
        const cause = "segment_xy_drift_requires_route_factory";
        const blocked = await client.query<Job>(
          `UPDATE route_elevation_backfill_jobs
           SET state = 'blocked',
               path_fingerprint = $3,
               lease_owner = NULL,
               lease_token = NULL,
               lease_expires_at = NULL,
               last_error = $4,
               final_evidence = $5::jsonb
           WHERE route_id = $1
             AND state = 'working'
             AND lease_token = $2
           RETURNING *`,
          [
            routeId,
            token,
            fingerprint,
            cause,
            JSON.stringify({
              verification: "blocked_before_write",
              cause,
              affected_route_ids: lockedXyDriftRouteIds.sort(),
            }),
          ]
        );
        if (!blocked.rows[0]) {
          throw new Error("No live route elevation lease matched");
        }
        await client.query("COMMIT");
        print({
          outcome: "blocked",
          state: "blocked",
          route_id: routeId,
          route_name: snapshot.name,
          blocker: cause,
          job: compactJob({
            ...blocked.rows[0],
            route_name: snapshot.name,
          }),
        });
        return;
      }
      for (const segment of segments) {
        const sampled = segmentProfiles.get(segment.id);
        if (!sampled) continue;
        const targetSegmentId = segment.user_route_reference_count > 0
          ? await cloneUserSharedSegment(client, segment)
          : segment.id;
        await applySegmentProfile(
          client,
          targetSegmentId,
          sampled.elevations
        );
      }
      for (const route of affected) {
        await rebuildPeaksRouteFromSegments(client, route.id);
      }
      if (terrainRetrievedAt) {
        await client.query(
          `UPDATE routes
           SET elevation_source = $2,
               elevation_source_url = $3,
               elevation_attribution = $4,
               elevation_license_url = $5,
               elevation_retrieved_at = $6::timestamptz
           WHERE id = ANY($1::text[])
             AND owner = 'peaks'
             AND status IN ('active', 'pending')`,
          [
            affected.map((route) => route.id),
            TERRAIN_SOURCE_NAME,
            TERRAIN_SOURCE_URL,
            TERRAIN_ATTRIBUTION,
            TERRAIN_LICENSE_URL,
            terrainRetrievedAt,
          ]
        );
      }
      const persisted = new Map<string, PersistedRouteEvidence>();
      for (const route of affected) {
        persisted.set(route.id, await verifyPersistedRoute(client, route.id));
      }
      const saved = persisted.get(routeId);
      if (!saved) throw new Error("Primary route was not rebuilt");
      const finalFingerprint = await currentFingerprint(client, routeId);
      if (!finalFingerprint) throw new Error("Route left scope before completion");
      const sourceKind =
        routeElevationLineageEvidence(saved).source_kind;
      const blockers = [...persisted.values()]
        .filter((route) => route.status === "active" && !route.publish_integrity_valid)
        .map((route) => `publish_integrity_failed:${route.id}`);
      written = {
        route: saved,
        sourceKind,
        fingerprint: finalFingerprint,
        blockers,
      };
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    if (!written) throw new Error("Route write did not finish");
    const lineageEvidence = routeElevationLineageEvidence(written.route);
    const fullEvidence = {
      point_count: written.route.point_count,
      profile_hash: written.route.profile_hash,
      segment_stats_verified: true,
      segment_repair_count: segmentProfiles.size,
      ...lineageEvidence,
    };
    if (written.blockers.length > 0) {
      await blockLease(
        routeId,
        token,
        written.fingerprint,
        written.blockers.join(","),
        {
          ...fullEvidence,
          verification: "elevation_written_publish_integrity_blocked",
          blockers: written.blockers,
        },
        snapshot.name
      );
      return;
    }
    await extendLease(routeId, token);
    const publicEvidence = await verifyPublicRoute(
      written.route,
      written.fingerprint
    );
    const completeClient = await db.connect();
    try {
      await completeClient.query("BEGIN");
      const job = await liveJob(completeClient, routeId, token);
      if (!job || await currentFingerprint(completeClient, routeId) !== written.fingerprint) {
        throw new Error("Route changed before public verification completed");
      }
      const finalRouteEvidence = await verifyPersistedRoute(
        completeClient,
        routeId
      );
      if (
        finalRouteEvidence.elevation_string !== written.route.elevation_string ||
        finalRouteEvidence.profile_hash !== written.route.profile_hash ||
        finalRouteEvidence.point_count !== written.route.point_count ||
        finalRouteEvidence.gain !== written.route.gain ||
        finalRouteEvidence.gain_loss !== written.route.gain_loss ||
        finalRouteEvidence.elevation_source !==
          written.route.elevation_source ||
        finalRouteEvidence.elevation_source_url !==
          written.route.elevation_source_url ||
        finalRouteEvidence.elevation_attribution !==
          written.route.elevation_attribution ||
        finalRouteEvidence.elevation_license_url !==
          written.route.elevation_license_url ||
        String(finalRouteEvidence.elevation_retrieved_at) !==
          String(written.route.elevation_retrieved_at) ||
        (
          finalRouteEvidence.status === "active" &&
          !finalRouteEvidence.publish_integrity_valid
        )
      ) {
        throw new Error(
          "Route elevation or publish integrity changed after public verification"
        );
      }
      const completed = await completeClient.query<Job>(
        `UPDATE route_elevation_backfill_jobs SET state = 'complete', path_fingerprint = $2, source_kind = $3,
         lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = NULL,
         final_evidence = $4::jsonb WHERE route_id = $1 RETURNING *`,
        [routeId, written.fingerprint, written.sourceKind,
         JSON.stringify({
           ...fullEvidence,
           verification: publicEvidence.kind,
         })]
      );
      await completeClient.query("COMMIT");
      print(processCompletionOutput({
        ...completed.rows[0]!,
        route_name: snapshot.name,
      }));
    } catch (error) { await completeClient.query("ROLLBACK"); throw error; } finally { completeClient.release(); }
  } catch (error) {
    await failLease(routeId, token, error, processRouteName);
  }
}

async function show(routeId: string | null, state: string | null): Promise<void> {
  if (state && !(["queued", "working", "retry", "blocked", "complete", "out_of_scope"] as string[]).includes(state)) throw new Error("Invalid state");
  const result = await db.query<Job>(
    `SELECT j.*, r.name AS route_name
     FROM route_elevation_backfill_jobs j
     JOIN routes r ON r.id = j.route_id
     WHERE ($1::text IS NULL OR j.route_id = $1)
       AND ($2::text IS NULL OR j.state = $2)
     ORDER BY j.priority DESC, j.next_attempt_at, j.route_id`, [routeId, state]
  );
  print(result.rows.map(compactJob));
}

async function stats(): Promise<void> {
  const result = await db.query<{ state: JobState; count: number; expired_leases: number }>(
    `SELECT state, count(*)::int AS count,
            count(*) FILTER (
              WHERE state = 'working' AND lease_expires_at < now()
            )::int AS expired_leases
     FROM route_elevation_backfill_jobs
     GROUP BY state
     ORDER BY state`
  );
  print(statsOutput(result.rows));
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
