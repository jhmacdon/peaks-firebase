/**
 * Fill every protected area's short description from facts already stored in
 * Peaks: area type, manager, states, and up to three linked peaks.
 *
 * Run through the Cloud SQL proxy:
 *   DB_HOST=127.0.0.1 DB_PORT=5433 DB_NAME=peaks DB_USER=peaks-api \
 *   DB_PASS=... npx tsx scripts/backfill-area-descriptions.ts --dry-run
 *
 * Flags:
 *   --dry-run  print a sample without writing
 *   --force    replace descriptions that already have text
 */

import db from "../src/db";
import { buildAreaDescription } from "../src/area-description";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const BATCH_SIZE = 250;

interface AreaRow {
  id: string;
  name: string;
  kind: string;
  manager: string | null;
  state_codes: string[];
  peak_names: string[];
}

async function main(): Promise<void> {
  const result = await db.query<AreaRow>(
    `SELECT a.id, a.name, a.kind::text AS kind, a.manager, a.state_codes,
            ARRAY(
              SELECT d.name
              FROM destination_areas da
              JOIN destinations d ON d.id = da.destination_id
              WHERE da.area_id = a.id AND d.name IS NOT NULL
              ORDER BY d.prominence DESC NULLS LAST,
                       d.elevation DESC NULLS LAST,
                       d.name
              LIMIT 3
            ) AS peak_names
     FROM areas a
     WHERE ($1::boolean OR NULLIF(BTRIM(a.description), '') IS NULL)
     ORDER BY a.name, a.id`,
    [FORCE]
  );

  const rows = result.rows.map((area) => ({
    id: area.id,
    description: buildAreaDescription({
      name: area.name,
      kind: area.kind,
      manager: area.manager,
      stateCodes: area.state_codes,
      peakNames: area.peak_names,
    }),
  }));

  console.log(`${rows.length} area descriptions ready${DRY_RUN ? " (dry run)" : ""}.`);
  for (const row of rows.slice(0, 20)) console.log(`${row.id}\t${row.description}`);
  if (DRY_RUN) {
    await db.end();
    return;
  }

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    await db.query(
      `UPDATE areas a
       SET description = values.description,
           updated_at = now()
       FROM jsonb_to_recordset($1::jsonb) AS values(id text, description text)
       WHERE a.id = values.id`,
      [JSON.stringify(batch)]
    );
    process.stdout.write(`\r${Math.min(index + BATCH_SIZE, rows.length)}/${rows.length} written`);
  }
  process.stdout.write("\n");
  await db.end();
}

main().catch((error) => {
  console.error("Area description backfill failed:", error);
  process.exit(1);
});
