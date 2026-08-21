/**
 * Adds a reviewed photo manifest to the admin review queue.
 *
 * Dry-run is the default. Examples:
 *   npm run import:destination-photos -- --input=data/cascade-volcano-photo-candidates.json
 *   npm run import:destination-photos -- --input=data/cascade-volcano-photo-candidates.json --apply
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import db from "./db";
import {
  deterministicPhotoCandidateId,
  parseDestinationPhotoManifest,
  type DestinationPhotoManifest,
  type DestinationPhotoManifestCandidate,
} from "./destination-photo-candidates";

interface ImportArgs {
  input: string;
  apply: boolean;
}

function parseArgs(argv: string[]): ImportArgs {
  const inputArg = argv.find((arg) => arg.startsWith("--input="));
  if (!inputArg) throw new Error("--input=/path/to/photo-manifest.json is required");
  const unknown = argv.filter((arg) => arg !== "--apply" && !arg.startsWith("--input="));
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);
  return { input: inputArg.slice("--input=".length), apply: argv.includes("--apply") };
}

async function verifyDestinations(
  client: PoolClient,
  candidates: DestinationPhotoManifestCandidate[]
): Promise<void> {
  const ids = candidates.map((candidate) => candidate.destinationId);
  const result = await client.query<{ id: string; name: string | null }>(
    `SELECT id, name FROM destinations WHERE id = ANY($1::text[])`,
    [ids]
  );
  const actual = new Map(result.rows.map((row) => [row.id, row.name]));
  for (const candidate of candidates) {
    const name = actual.get(candidate.destinationId);
    if (name == null) {
      throw new Error(`Destination not found: ${candidate.destinationName} (${candidate.destinationId})`);
    }
    if (name !== candidate.destinationName) {
      throw new Error(
        `Destination name mismatch for ${candidate.destinationId}: manifest=${candidate.destinationName}, database=${name}`
      );
    }
  }
}

async function upsertCandidates(
  client: PoolClient,
  manifest: DestinationPhotoManifest
): Promise<number> {
  let changed = 0;
  for (const candidate of manifest.candidates) {
    const id = deterministicPhotoCandidateId(candidate.destinationId, candidate.sourcePageUrl);
    const result = await client.query(
      `INSERT INTO destination_photo_candidates (
         id, destination_id, image_url, source_page_url, source_kind,
         photographer, license_name, license_url,
         image_width, image_height, focal_x, focal_y, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (destination_id, source_page_url) DO UPDATE
         SET focal_x = EXCLUDED.focal_x,
             focal_y = EXCLUDED.focal_y,
             updated_at = now()
       WHERE destination_photo_candidates.status = 'pending'
         AND (destination_photo_candidates.focal_x, destination_photo_candidates.focal_y)
             IS DISTINCT FROM (EXCLUDED.focal_x, EXCLUDED.focal_y)`,
      [
        id,
        candidate.destinationId,
        candidate.imageUrl,
        candidate.sourcePageUrl,
        candidate.sourceKind,
        candidate.photographer,
        candidate.licenseName,
        candidate.licenseUrl,
        candidate.imageWidth,
        candidate.imageHeight,
        candidate.focalX,
        candidate.focalY,
        candidate.notes || null,
      ]
    );
    changed += result.rowCount || 0;
  }
  return changed;
}

async function run(args: ImportArgs): Promise<void> {
  const inputPath = path.resolve(process.cwd(), args.input);
  const raw = JSON.parse(await fs.readFile(inputPath, "utf8")) as unknown;
  const manifest = parseDestinationPhotoManifest(raw);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await verifyDestinations(client, manifest.candidates);
    const changed = await upsertCandidates(client, manifest);
    if (args.apply) {
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    console.log(
      `${args.apply ? "Applied" : "Dry run"}: ${changed} added or reframed of ` +
      `${manifest.candidates.length} ${manifest.collection} candidate(s)`
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  let args: ImportArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
  run(args)
    .catch((error) => {
      console.error("Destination photo import failed:", error);
      process.exitCode = 1;
    })
    .finally(() => db.end());
}
