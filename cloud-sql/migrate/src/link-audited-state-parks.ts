/**
 * Links only the destination/park pairs in a reviewed state-park audit report.
 * Dry run is the default. Apply rechecks identity, type, and geometry inside
 * one transaction before it writes.
 */

import fs from "node:fs/promises";
import db from "./db";
import { AREA_LINK_TOLERANCE_M } from "./import-padus-areas";
import type { StateParkAuditReport } from "./audit-state-parks";

export interface LinkAuditedStateParksArgs {
  report: string;
  apply: boolean;
}

export interface AuditedStateParkPair {
  destinationId: string;
  areaId: string;
}

interface LinkPreflightRow {
  pair_count: string | number;
  missing_destinations: string | number;
  missing_areas: string | number;
  wrong_area_kind: string | number;
  outside_tolerance: string | number;
  existing_links: string | number;
  insertable_links: string | number;
}

export const STATE_PARK_LINK_PREFLIGHT_SQL = `WITH expected AS (
    SELECT destination_id, area_id
    FROM JSONB_TO_RECORDSET($1::jsonb) AS input (
      destination_id TEXT,
      area_id TEXT
    )
  ),
  checked AS (
    SELECT expected.destination_id,
           expected.area_id,
           d.id IS NOT NULL AS destination_exists,
           a.id IS NOT NULL AS area_exists,
           a.kind::text = 'state_park' AS correct_kind,
           d.id IS NOT NULL
             AND a.id IS NOT NULL
             AND (
               ST_Covers(a.boundary, d.location::geometry)
               OR ST_DWithin(a.boundary::geography, d.location, $2)
             ) AS spatial_match,
           EXISTS (
             SELECT 1
             FROM destination_areas da
             WHERE da.destination_id = expected.destination_id
               AND da.area_id = expected.area_id
           ) AS already_linked
    FROM expected
    LEFT JOIN destinations d ON d.id = expected.destination_id
    LEFT JOIN areas a ON a.id = expected.area_id
  )
  SELECT COUNT(*) AS pair_count,
         COUNT(*) FILTER (WHERE NOT destination_exists) AS missing_destinations,
         COUNT(*) FILTER (WHERE NOT area_exists) AS missing_areas,
         COUNT(*) FILTER (WHERE area_exists AND NOT correct_kind) AS wrong_area_kind,
         COUNT(*) FILTER (
           WHERE destination_exists AND area_exists AND NOT spatial_match
         ) AS outside_tolerance,
         COUNT(*) FILTER (WHERE already_linked) AS existing_links,
         COUNT(*) FILTER (WHERE spatial_match AND correct_kind AND NOT already_linked)
           AS insertable_links
  FROM checked`;

export const STATE_PARK_LINK_INSERT_SQL = `WITH expected AS (
    SELECT destination_id, area_id
    FROM JSONB_TO_RECORDSET($1::jsonb) AS input (
      destination_id TEXT,
      area_id TEXT
    )
  )
  INSERT INTO destination_areas (destination_id, area_id, relation, source)
  SELECT expected.destination_id, expected.area_id, 'contained_by', 'postgis'
  FROM expected
  JOIN destinations d ON d.id = expected.destination_id
  JOIN areas a ON a.id = expected.area_id
  WHERE a.kind::text = 'state_park'
    AND 'summit'::destination_feature = ANY(d.features)
    AND d.location IS NOT NULL
    AND (
      ST_Covers(a.boundary, d.location::geometry)
      OR ST_DWithin(a.boundary::geography, d.location, $2)
    )
  ON CONFLICT (destination_id, area_id) DO NOTHING`;

export function parseLinkAuditedStateParksArgs(
  argv = process.argv.slice(2)
): LinkAuditedStateParksArgs {
  const reportArg = argv.find((arg) => arg.startsWith("--report="));
  const unknown = argv.find(
    (arg) => arg !== "--apply" && !arg.startsWith("--report=")
  );
  if (unknown) throw new Error(`Unknown argument: ${unknown}`);
  const report = reportArg?.slice("--report=".length).trim();
  if (!report) throw new Error("--report=/path/to/state-park-audit.json is required");
  return { report, apply: argv.includes("--apply") };
}

export function auditedStateParkPairs(
  report: StateParkAuditReport
): AuditedStateParkPair[] {
  if (
    report.source?.name !== "USGS PAD-US" ||
    report.source?.version !== "4.1" ||
    report.source?.designation !== "SP" ||
    report.source?.toleranceM !== AREA_LINK_TOLERANCE_M
  ) {
    throw new Error("Audit report source, version, designation, or tolerance is not approved");
  }
  if (!Array.isArray(report.parks) || !Array.isArray(report.destinations)) {
    throw new Error("Audit report is missing parks or destinations");
  }

  const parkIds = new Set(report.parks.map((park) => park.areaId));
  const unique = new Map<string, AuditedStateParkPair>();
  for (const destination of report.destinations) {
    if (!destination.id?.trim() || !Array.isArray(destination.parks)) {
      throw new Error("Audit report has an invalid destination");
    }
    for (const park of destination.parks) {
      if (!park.areaId?.trim() || !parkIds.has(park.areaId)) {
        throw new Error(`Audit report has an unknown park for ${destination.id}`);
      }
      const pair = { destinationId: destination.id, areaId: park.areaId };
      unique.set(`${pair.destinationId}\n${pair.areaId}`, pair);
    }
  }
  const pairs = Array.from(unique.values()).sort((left, right) =>
    left.destinationId.localeCompare(right.destinationId) ||
    left.areaId.localeCompare(right.areaId)
  );
  if (pairs.length === 0) throw new Error("Audit report has no destination/park pairs");
  return pairs;
}

function count(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("Invalid link preflight count");
  return parsed;
}

export async function linkAuditedStateParks(
  args: LinkAuditedStateParksArgs
): Promise<void> {
  const report = JSON.parse(await fs.readFile(args.report, "utf8")) as StateParkAuditReport;
  const pairs = auditedStateParkPairs(report);
  const input = pairs.map((pair) => ({
    destination_id: pair.destinationId,
    area_id: pair.areaId,
  }));
  const client = await db.connect();
  let transactionActive = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionActive = true;
    const preflight = await client.query<LinkPreflightRow>(
      STATE_PARK_LINK_PREFLIGHT_SQL,
      [JSON.stringify(input), AREA_LINK_TOLERANCE_M]
    );
    const row = preflight.rows[0];
    if (!row || count(row.pair_count) !== pairs.length) {
      throw new Error("State-park link preflight did not preserve the reviewed pair count");
    }
    const failures = {
      missingDestinations: count(row.missing_destinations),
      missingAreas: count(row.missing_areas),
      wrongAreaKind: count(row.wrong_area_kind),
      outsideTolerance: count(row.outside_tolerance),
    };
    if (Object.values(failures).some((value) => value > 0)) {
      throw new Error(`State-park link preflight failed: ${JSON.stringify(failures)}`);
    }

    const existing = count(row.existing_links);
    const insertable = count(row.insertable_links);
    if (existing + insertable !== pairs.length) {
      throw new Error("State-park link preflight left an unexplained pair");
    }

    if (!args.apply) {
      await client.query("ROLLBACK");
      transactionActive = false;
      console.log(
        `Dry run: ${pairs.length} reviewed pair(s), ${existing} existing, ${insertable} insertable`
      );
      return;
    }

    const inserted = await client.query(STATE_PARK_LINK_INSERT_SQL, [
      JSON.stringify(input),
      AREA_LINK_TOLERANCE_M,
    ]);
    if ((inserted.rowCount ?? 0) !== insertable) {
      throw new Error(
        `Expected to insert ${insertable} state-park link(s), inserted ${inserted.rowCount ?? 0}`
      );
    }
    await client.query("COMMIT");
    transactionActive = false;
    console.log(
      `Applied: ${pairs.length} reviewed pair(s), ${existing} existing, ${insertable} inserted`
    );
  } catch (error) {
    if (transactionActive) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

if (require.main === module) {
  let args: LinkAuditedStateParksArgs;
  try {
    args = parseLinkAuditedStateParksArgs();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
  linkAuditedStateParks(args).catch((error) => {
    console.error("Audited state-park linking failed:", error);
    process.exitCode = 1;
  });
}
