#!/usr/bin/env node

import process from "node:process";
import db from "./db";

export type RepairState = "queued" | "covered" | "retired" | "needs_human";
type RepairRow = { route_id: string; destination_id: string; state: RepairState; created_at: string };

export function validRepairState(value: string): value is RepairState {
  return ["queued", "covered", "retired", "needs_human"].includes(value);
}

function idValue(value: string | undefined, flag: string): string {
  if (!value || value.startsWith("--") || !/^[A-Za-z0-9_.:@/-]+$/.test(value)) {
    throw new Error(`${flag} requires an ID with supported characters`);
  }
  return value;
}

function limitValue(value: string | undefined): number {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("--limit must be an integer from 1 through 200");
  }
  return limit;
}

export type RepairArgs =
  | { command: "seed"; apply: boolean }
  | { command: "show"; routeId: string | null; destinationId: string | null; state: RepairState | null; limit: number }
  | { command: "stats" };

export function parseRepairArgs(argv: string[]): RepairArgs {
  const [command, ...rest] = argv;
  if (command === "seed") {
    if (rest.some((arg) => arg !== "--apply")) throw new Error("Unknown flag for seed");
    if (rest.filter((arg) => arg === "--apply").length > 1) throw new Error("Duplicate --apply");
    return { command, apply: rest.includes("--apply") };
  }
  if (command === "stats") {
    if (rest.length > 0) throw new Error("Unknown flag for stats");
    return { command };
  }
  if (command !== "show") throw new Error("Unknown command");
  let routeId: string | null = null;
  let destinationId: string | null = null;
  let state: RepairState | null = null;
  let limit = 20;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[++index];
    if (flag === "--route-id") routeId = idValue(value, flag);
    else if (flag === "--destination-id") destinationId = idValue(value, flag);
    else if (flag === "--state") {
      if (!value || !validRepairState(value)) throw new Error("--state must be queued, covered, retired, or needs_human");
      state = value;
    } else if (flag === "--limit") limit = limitValue(value);
    else throw new Error(`Unknown flag ${flag}`);
  }
  return { command, routeId, destinationId, state, limit };
}

export function selectQueuedRepair(rows: RepairRow[]): string | null {
  return rows
    .filter((row) => row.state === "queued")
    .sort((first, second) => first.created_at.localeCompare(second.created_at) || first.route_id.localeCompare(second.route_id))[0]
    ?.route_id ?? null;
}

const repairsSql = `
WITH bad_routes AS (
  SELECT r.id AS route_id
  FROM routes r
  WHERE r.owner = 'peaks' AND r.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM route_destinations rd
      JOIN destinations summit ON summit.id = rd.destination_id
      WHERE rd.route_id = r.id
        AND 'summit'::destination_feature = ANY(summit.features)
        AND (r.path IS NULL OR summit.location IS NULL OR NOT ST_DWithin(r.path, summit.location, 5))
    )
), bad_links AS (
  SELECT r.id AS route_id,
         summit.id AS destination_id,
         CASE
           WHEN r.path IS NULL THEN 'route_path_missing'
           WHEN summit.location IS NULL THEN 'destination_location_missing'
           WHEN ST_DWithin(r.path, summit.location, 5) THEN 'shared_route_integrity_failure'
           ELSE 'summit_path_gap'
         END AS reason,
         CASE WHEN r.path IS NOT NULL AND summit.location IS NOT NULL
           THEN ST_Distance(r.path, summit.location) END AS summit_gap_meters
  FROM bad_routes bad
  JOIN routes r ON r.id = bad.route_id
  JOIN route_destinations rd ON rd.route_id = r.id
  JOIN destinations summit ON summit.id = rd.destination_id
  WHERE 'summit'::destination_feature = ANY(summit.features)
), coverage AS (
  SELECT bl.route_id, bl.destination_id,
         candidate.id AS replacement_route_id
  FROM bad_links bl
  LEFT JOIN LATERAL (
    SELECT r2.id
    FROM routes r2
    JOIN route_destinations rd2
      ON rd2.route_id = r2.id AND rd2.destination_id = bl.destination_id
    JOIN destinations summit ON summit.id = rd2.destination_id
    WHERE r2.id <> bl.route_id
      AND r2.owner = 'peaks' AND r2.status = 'active'
      AND r2.path IS NOT NULL AND summit.location IS NOT NULL
      AND ST_DWithin(r2.path, summit.location, 5)
      AND NOT EXISTS (
        SELECT 1
        FROM route_destinations all_rd
        JOIN destinations all_summit ON all_summit.id = all_rd.destination_id
        WHERE all_rd.route_id = r2.id
          AND 'summit'::destination_feature = ANY(all_summit.features)
          AND (all_summit.location IS NULL OR NOT ST_DWithin(r2.path, all_summit.location, 5))
      )
      AND r2.elevation_string IS NOT NULL
      AND r2.elevation_string = encode_route_elevation_profile(r2.path)
      AND is_valid_route_provenance(r2.provenance)
      AND EXISTS (
        SELECT 1 FROM route_segments rs
        JOIN segments s ON s.id = rs.segment_id
        WHERE rs.route_id = r2.id AND s.path IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM route_segments rs
        JOIN segments s ON s.id = rs.segment_id
        WHERE rs.route_id = r2.id
          AND s.provenance IS DISTINCT FROM r2.provenance
      )
      AND (SELECT count(*) = count(DISTINCT ordinal)
             AND min(ordinal) = 0
             AND max(ordinal) = count(*) - 1
           FROM route_segments ordered_segment
           WHERE ordered_segment.route_id = r2.id)
      AND (SELECT count(*) = count(DISTINCT ordinal)
             AND min(ordinal) = 0
             AND max(ordinal) = count(*) - 1
           FROM route_destinations ordered
           WHERE ordered.route_id = r2.id)
      AND NOT (
        rd2.ordinal = (SELECT max(last_rd.ordinal) FROM route_destinations last_rd WHERE last_rd.route_id = r2.id)
        AND r2.shape IN ('out_and_back', 'point_to_point')
        AND NOT ST_DWithin(ST_EndPoint(r2.path::geometry)::geography, summit.location, 5)
      )
    ORDER BY r2.created_at, r2.id
    LIMIT 1
  ) candidate ON true
)
`;

function compact(row: Record<string, unknown>): Record<string, unknown> {
  return {
    route_id: row.route_id,
    destination_id: row.destination_id,
    state: row.state,
    reason: row.reason,
    summit_gap_meters: row.summit_gap_meters,
    replacement_route_id: row.replacement_route_id,
    covered_at: row.covered_at,
    evidence: row.evidence,
    last_error: row.last_error,
    updated_at: row.updated_at,
  };
}

async function seed(apply: boolean): Promise<void> {
  if (!apply) {
    const preview = await db.query<{ total: number; covered: number }>(
      `${repairsSql} SELECT count(*)::int AS total, count(*) FILTER (WHERE replacement_route_id IS NOT NULL)::int AS covered FROM coverage`
    );
    console.log(JSON.stringify({ mode: "dry_run", inserted: 0, updated: 0, covered: preview.rows[0]?.covered ?? 0, retired: 0, candidates: preview.rows[0]?.total ?? 0 }));
    return;
  }
  const retired = await db.query<{ count: number }>(
    `WITH retired AS (
       UPDATE route_integrity_repairs repair
       SET state = 'retired', replacement_route_id = NULL, covered_at = NULL,
           evidence = '{}'::jsonb, last_error = NULL
       FROM routes r
       WHERE r.id = repair.route_id
         AND repair.state <> 'covered'
         AND (r.owner <> 'peaks' OR r.status <> 'active')
       RETURNING 1
     ) SELECT count(*)::int AS count FROM retired`
  );
  const result = await db.query<{ inserted: boolean; state: RepairState }>(
    `${repairsSql}, upserted AS (
       INSERT INTO route_integrity_repairs (
         route_id, destination_id, state, reason, summit_gap_meters,
         replacement_route_id, covered_at, evidence, last_error
       )
       SELECT coverage.route_id, coverage.destination_id,
              CASE WHEN coverage.replacement_route_id IS NULL THEN 'queued' ELSE 'covered' END,
              bad_links.reason, bad_links.summit_gap_meters,
              coverage.replacement_route_id,
              CASE WHEN coverage.replacement_route_id IS NULL THEN NULL ELSE now() END,
              CASE WHEN coverage.replacement_route_id IS NULL THEN '{}'::jsonb
                   ELSE jsonb_build_object('validation', 'active_peaks_route_passed_integrity_gates', 'replacement_route_id', coverage.replacement_route_id) END,
              NULL
       FROM coverage JOIN bad_links USING (route_id, destination_id)
       ON CONFLICT (route_id, destination_id) DO UPDATE SET
         state = CASE WHEN EXCLUDED.replacement_route_id IS NOT NULL THEN 'covered' ELSE 'queued' END,
         reason = EXCLUDED.reason,
         summit_gap_meters = EXCLUDED.summit_gap_meters,
         replacement_route_id = EXCLUDED.replacement_route_id,
         covered_at = CASE WHEN EXCLUDED.replacement_route_id IS NULL THEN NULL ELSE now() END,
         evidence = EXCLUDED.evidence,
         last_error = NULL
       RETURNING (xmax = 0) AS inserted, state
     ) SELECT inserted, state FROM upserted`
  );
  const inserted = result.rows.filter((row) => row.inserted).length;
  console.log(JSON.stringify({
    mode: "apply", inserted, updated: result.rows.length - inserted,
    covered: result.rows.filter((row) => row.state === "covered").length,
    retired: retired.rows[0]?.count ?? 0,
  }));
}

async function show(args: Extract<RepairArgs, { command: "show" }>): Promise<void> {
  const result = await db.query<Record<string, unknown>>(
    `SELECT route_id, destination_id, state, reason, summit_gap_meters,
            replacement_route_id, covered_at, evidence, last_error, updated_at
     FROM route_integrity_repairs
     WHERE ($1::text IS NULL OR route_id = $1)
       AND ($2::text IS NULL OR destination_id = $2)
       AND ($3::text IS NULL OR state = $3)
     ORDER BY created_at, route_id, destination_id LIMIT $4`,
    [args.routeId, args.destinationId, args.state, args.limit]
  );
  console.log(JSON.stringify(result.rows.map(compact)));
}

async function stats(): Promise<void> {
  const result = await db.query<{ state: RepairState; count: number }>(
    `SELECT state, count(*)::int AS count FROM route_integrity_repairs GROUP BY state ORDER BY state`
  );
  const extras = await db.query<{ bad_active_routes: number; queued_destination_links: number }>(
    `${repairsSql}
     SELECT count(DISTINCT route_id)::int AS bad_active_routes,
            count(*) FILTER (WHERE replacement_route_id IS NULL)::int AS queued_destination_links
     FROM coverage`
  );
  console.log(JSON.stringify({
    states: Object.fromEntries(result.rows.map((row) => [row.state, row.count])),
    total: result.rows.reduce((sum, row) => sum + row.count, 0),
    bad_active_routes: extras.rows[0]?.bad_active_routes ?? 0,
    queued_destination_links: extras.rows[0]?.queued_destination_links ?? 0,
  }));
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseRepairArgs(argv);
  if (args.command === "seed") return seed(args.apply);
  if (args.command === "show") return show(args);
  return stats();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }).finally(() => db.end());
}
