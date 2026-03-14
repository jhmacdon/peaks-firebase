/**
 * One-time backfill: normalize all existing search_name values
 * to expand geographic abbreviations (mt → mount, etc.)
 *
 * Usage: npx tsx src/normalize-search-names.ts
 */

import db from "./db";

const ABBREVIATIONS: Record<string, string> = {
  mt: "mount",
  mtn: "mountain",
  pt: "point",
  st: "saint",
  ft: "fort",
  lk: "lake",
  pk: "peak",
  cr: "creek",
  crk: "creek",
  cyn: "canyon",
  jct: "junction",
  spgs: "springs",
  spr: "spring",
  fk: "fork",
  br: "bridge",
  brg: "bridge",
  trl: "trail",
  hwy: "highway",
  rd: "road",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
};

function normalizeSearchName(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word) => ABBREVIATIONS[word] || word)
    .join(" ")
    .trim();
}

async function main() {
  const result = await db.query(
    `SELECT id, name, search_name FROM destinations WHERE name IS NOT NULL`
  );

  let updated = 0;
  for (const row of result.rows) {
    const normalized = normalizeSearchName(row.name);
    if (normalized !== row.search_name) {
      await db.query(
        `UPDATE destinations SET search_name = $1 WHERE id = $2`,
        [normalized, row.id]
      );
      updated++;
      console.log(`  ${row.name} → ${normalized}`);
    }
  }

  console.log(`\nDone. Updated ${updated} of ${result.rows.length} destinations.`);
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
