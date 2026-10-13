import { readFileSync, openSync, writeFileSync, closeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { parseDestinationPhotoManifest, deterministicPhotoCandidateId, type DestinationPhotoManifest } from "./destination-photo-candidates";
import { verifyDestinations, upsertCandidates } from "./import-destination-photo-candidates";
import { sha256, stableJson } from "./trail-catalog/graph";

type Target = { id: string; name: string; lat: number; lng: number };
type Proposal = { destinationId: string; sourcePageUrl: string; metadataFile: string; metadataSha256: string; candidateSha256: string };
type Review = { targets: Target[]; proposals: Proposal[] };
type LivePlace = Target & { hero: Record<string, unknown> };
type QueueRow = { id: string; destination_id: string; source_page_url: string; status: string; image_url: string; source_kind: string; photographer: string; license_name: string; license_url: string; image_width: number; image_height: number; focal_x: number; focal_y: number };
export type PhotoQueueRecord = { type: "candidate"; destinationId: string; destinationName: string; sourcePageUrl: string; outcome: "eligible" | "rejected"; reason: string | null; candidateId?: string; queueStatus?: string; queueAction?: "new" | "already_queued" | "reframe" };
export type PhotoQueueArgs = { manifest: string; review: string; catalog: string; report: string; apply: boolean; manifestSha256?: string; reviewHash?: string };
export type PhotoQueueInputs = { manifest: DestinationPhotoManifest; review: Review; catalog: Target[]; manifestSha256: string; reviewSha256: string; catalogSha256: string; metadataHashes: string[] };
export class PhotoQueueTransactionFailure extends Error {
  constructor(message: string, public readonly outcome: "rolled_back" | "apply_outcome_unconfirmed", public readonly records: PhotoQueueRecord[], public readonly plannedChanges: number) { super(message); }
}
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function parsePhotoQueueArgs(argv: string[]): PhotoQueueArgs {
  const result: PhotoQueueArgs = { manifest: "", review: "", catalog: "", report: "", apply: false };
  const flags: Record<string, keyof PhotoQueueArgs> = { "--manifest": "manifest", "--review": "review", "--catalog": "catalog", "--report": "report", "--manifest-sha256": "manifestSha256", "--review-hash": "reviewHash" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply" && !result.apply) { result.apply = true; continue; }
    const key = flags[argv[i]];
    if (!key || !argv[i + 1] || argv[i + 1].startsWith("--") || result[key]) throw new Error("Unknown, repeated, or incomplete photo queue argument");
    (result as unknown as Record<string, unknown>)[key] = argv[++i];
  }
  if (!result.manifest || !result.review || !result.catalog || !result.report
    || (result.apply ? !digest(result.manifestSha256) || !digest(result.reviewHash) : Boolean(result.manifestSha256 || result.reviewHash))) {
    throw new Error("Usage: --manifest FILE --review FILE --catalog FILE --report NEW.jsonl [--apply --manifest-sha256 SHA --review-hash SHA]");
  }
  if ([result.manifest, result.review, result.catalog].some(path => resolve(path) === resolve(result.report))) throw new Error("Report must be a new file distinct from every input");
  return result;
}

function targets(value: unknown, label: string): Target[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`${label} must contain targets`);
  if (value.some(place => !place || typeof place.id !== "string" || !place.id.trim() || typeof place.name !== "string" || !place.name.trim() || !Number.isFinite(place.lat) || !Number.isFinite(place.lng) || Math.abs(place.lat) > 90 || Math.abs(place.lng) > 180)) throw new Error(`${label} has an invalid catalog binding`);
  if (new Set(value.map(place => place.id)).size !== value.length) throw new Error(`${label} repeats a destination ID`);
  return value;
}
export function readPhotoQueueInputs(args: PhotoQueueArgs): PhotoQueueInputs {
  const manifestBytes = readFileSync(args.manifest), reviewBytes = readFileSync(args.review), catalogBytes = readFileSync(args.catalog);
  const manifest = parseDestinationPhotoManifest(JSON.parse(manifestBytes.toString("utf8")));
  const review = JSON.parse(reviewBytes.toString("utf8")) as Review, rawCatalog = JSON.parse(catalogBytes.toString("utf8"));
  review.targets = targets(review.targets, "photo review");
  const catalog = targets(Array.isArray(rawCatalog) ? rawCatalog : rawCatalog.places, "catalog snapshot");
  if (!Array.isArray(review.proposals) || !review.proposals.length) throw new Error("Photo review must contain source proposals");
  const metadataHashes = review.proposals.map(proposal => {
    if (!proposal || typeof proposal.destinationId !== "string" || typeof proposal.sourcePageUrl !== "string" || typeof proposal.metadataFile !== "string" || !digest(proposal.metadataSha256) || !digest(proposal.candidateSha256)) throw new Error("Invalid source proposal binding");
    const bytes = readFileSync(resolve(dirname(resolve(args.review)), proposal.metadataFile));
    if (sha256(bytes) !== proposal.metadataSha256) throw new Error(`Source metadata checksum changed for ${proposal.destinationId}`);
    return proposal.metadataSha256;
  });
  const inputs = { manifest, review, catalog, manifestSha256: sha256(manifestBytes), reviewSha256: sha256(reviewBytes), catalogSha256: sha256(catalogBytes), metadataHashes };
  if (args.apply && inputs.manifestSha256 !== args.manifestSha256) throw new Error("Manifest checksum differs from the reviewed dry run");
  return inputs;
}

const sameTarget = (a: Target, b: Target) => a.id === b.id && a.name === b.name && Math.abs(a.lat - b.lat) <= 1e-9 && Math.abs(a.lng - b.lng) <= 1e-9;
const credited = (hero: Record<string, unknown>) => ["hero_image", "hero_image_attribution", "hero_image_attribution_url"].every(key => typeof hero[key] === "string" && (hero[key] as string).trim());
export function planPhotoQueue(inputs: PhotoQueueInputs, live: LivePlace[], queue: QueueRow[]): { records: PhotoQueueRecord[]; manifest: DestinationPhotoManifest; reviewHash: string } {
  const records: PhotoQueueRecord[] = [], eligible: DestinationPhotoManifest["candidates"] = [];
  for (const candidate of inputs.manifest.candidates) {
    const actual = live.find(place => place.id === candidate.destinationId), bound = inputs.catalog.find(place => place.id === candidate.destinationId), reviewed = inputs.review.targets.find(place => place.id === candidate.destinationId);
    const proposals = inputs.review.proposals.filter(proposal => proposal.destinationId === candidate.destinationId && proposal.sourcePageUrl === candidate.sourcePageUrl);
    const prior = queue.find(row => row.destination_id === candidate.destinationId && row.source_page_url === candidate.sourcePageUrl);
    let reason: string | null = !bound || !reviewed || !sameTarget(bound, reviewed) ? "photo_catalog_snapshot_binding_missing_or_changed"
      : candidate.destinationName !== bound.name ? "photo_manifest_name_changed"
      : !actual ? "photo_destination_missing"
      : !sameTarget(bound, actual) ? "photo_live_catalog_binding_changed"
      : proposals.length !== 1 ? "photo_source_proposal_missing_or_ambiguous"
      : proposals[0].candidateSha256 !== sha256(stableJson(candidate)) ? "photo_source_proposal_candidate_changed"
      : credited(actual.hero) ? "destination_already_has_credited_hero"
      : prior && prior.status !== "pending" ? "photo_candidate_already_reviewed" : null;
    if (!reason && prior) {
      const expected = [candidate.imageUrl, candidate.sourceKind, candidate.photographer, candidate.licenseName, candidate.licenseUrl, candidate.imageWidth, candidate.imageHeight];
      const stored = [prior.image_url, prior.source_kind, prior.photographer, prior.license_name, prior.license_url, prior.image_width, prior.image_height];
      if (stableJson(expected) !== stableJson(stored)) reason = "photo_existing_queue_metadata_changed";
    }
    records.push({ type: "candidate", destinationId: candidate.destinationId, destinationName: candidate.destinationName, sourcePageUrl: candidate.sourcePageUrl, outcome: reason ? "rejected" : "eligible", reason,
      candidateId: prior?.id ?? deterministicPhotoCandidateId(candidate.destinationId, candidate.sourcePageUrl), ...(prior ? { queueStatus: prior.status } : {}),
      ...(!reason ? { queueAction: prior ? prior.focal_x === candidate.focalX && prior.focal_y === candidate.focalY ? "already_queued" as const : "reframe" as const : "new" as const } : {}) });
    if (!reason) eligible.push(candidate);
  }
  const reviewHash = sha256(stableJson({ manifestSha256: inputs.manifestSha256, reviewSha256: inputs.reviewSha256, catalogSha256: inputs.catalogSha256, metadataHashes: inputs.metadataHashes, live, queue, records }));
  return { records, manifest: { ...inputs.manifest, candidates: eligible }, reviewHash };
}

async function livePlaces(client: PoolClient, ids: string[], lock: boolean): Promise<LivePlace[]> {
  const result = await client.query(`SELECT d.id,d.name,ST_Y(d.location::geometry) lat,ST_X(d.location::geometry) lng,
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(d)) fields(key,value) WHERE key LIKE 'hero_image%') hero
    FROM destinations d WHERE d.id=ANY($1::text[]) ORDER BY d.id ${lock ? "FOR UPDATE OF d" : ""}`, [ids]);
  return result.rows;
}
export async function executePhotoQueueTransaction(client: PoolClient, inputs: PhotoQueueInputs, args: Pick<PhotoQueueArgs, "apply" | "reviewHash">, onPlan?: (records: PhotoQueueRecord[]) => void): Promise<{ records: PhotoQueueRecord[]; reviewHash: string; changed: number; eligible: number; heroesUnchanged: boolean }> {
  await client.query("BEGIN");
  let commitAttempted = false, plannedChanges = 0, plannedRecords: PhotoQueueRecord[] = [];
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='60s'");
    const ids = [...new Set(inputs.manifest.candidates.map(candidate => candidate.destinationId))].sort();
    const queueSql = `SELECT id,destination_id,source_page_url,status,image_url,source_kind,photographer,license_name,license_url,image_width,image_height,focal_x,focal_y
      FROM destination_photo_candidates WHERE destination_id=ANY($1::text[]) ORDER BY destination_id,source_page_url FOR UPDATE`;
    // Match human approval's queue-before-destination lock order. Re-read the
    // queue after locking destinations to catch inserts that just finished.
    await client.query(queueSql, [ids]);
    const live = await livePlaces(client, ids, true);
    const queue = await client.query(queueSql, [ids]);
    const plan = planPhotoQueue(inputs, live, queue.rows);
    plannedRecords = plan.records;
    onPlan?.(plan.records);
    if (args.apply && plan.reviewHash !== args.reviewHash) throw new Error("Photo queue review hash changed; rerun dry and review the new report");
    let changed = 0;
    if (plan.manifest.candidates.length) {
      await verifyDestinations(client, plan.manifest.candidates);
      changed = await upsertCandidates(client, plan.manifest);
      plannedChanges = changed;
    }
    const after = await livePlaces(client, ids, false);
    if (stableJson(live) !== stableJson(after)) throw new Error("Photo queue import changed destination identity or hero fields; transaction rolled back");
    commitAttempted = args.apply;
    await client.query(args.apply ? "COMMIT" : "ROLLBACK");
    return { records: plan.records, reviewHash: plan.reviewHash, changed, eligible: plan.manifest.candidates.length, heroesUnchanged: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw new PhotoQueueTransactionFailure(error instanceof Error ? error.message : String(error), commitAttempted ? "apply_outcome_unconfirmed" : "rolled_back", plannedRecords, plannedChanges);
  }
}

export async function runPhotoQueueImport(argv: string[], database?: Pool): Promise<void> {
  const args = parsePhotoQueueArgs(argv), report = openSync(args.report, "wx");
  let pool: Pool | undefined, client: PoolClient | undefined, runId: string | undefined, failure: unknown;
  let records: PhotoQueueRecord[] = [], inputCount = 0, eligible = 0, changed = 0;
  let writtenCount: number | null = 0;
  let inputs: PhotoQueueInputs | undefined;
  let summary: Record<string, unknown> = { type: "summary", mode: args.apply ? "photo-queue-apply" : "photo-queue-dry-run", complete: false, routesActivated: 0, photosApproved: 0 };
  try {
    if (database) pool = database;
    else if (process.env.NODE_ENV === "test") {
      const url = process.env.PHOTO_CANDIDATE_TEST_DATABASE_URL;
      if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("Photo queue tests require an isolated PHOTO_CANDIDATE_TEST_DATABASE_URL ending _test");
      pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 60_000 });
    } else pool = new Pool({ host: process.env.DB_HOST ?? "localhost", port: Number(process.env.DB_PORT ?? 5432), database: process.env.DB_NAME ?? "peaks", user: process.env.DB_USER ?? "peaks-api", password: process.env.DB_PASS, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 60_000 });
    client = await pool.connect();
    const started = await client.query(`INSERT INTO data_source_runs(source,run_kind,status,started_at,notes)
      VALUES('trail-catalog-photo-queue','import','failed',clock_timestamp(),$1) RETURNING id`, [JSON.stringify(summary)]);
    runId = started.rows[0]?.id;
    if (!runId) throw new Error("Mandatory photo queue run receipt was not created");
    summary = { ...summary, runId };
    inputs = readPhotoQueueInputs(args); inputCount = inputs.manifest.candidates.length;
    summary = { ...summary, manifestSha256: inputs.manifestSha256, reviewSha256: inputs.reviewSha256, catalogSha256: inputs.catalogSha256, candidates: inputCount };
    const result = await executePhotoQueueTransaction(client, inputs, args, plan => { records = plan; });
    records = result.records; eligible = result.eligible; changed = result.changed;
    writtenCount = args.apply ? changed : 0;
    summary = { ...summary, complete: true, runId, manifestSha256: inputs.manifestSha256, reviewSha256: inputs.reviewSha256, catalogSha256: inputs.catalogSha256, reviewHash: result.reviewHash,
      candidates: inputCount, eligible, rejected: records.length - eligible, queueRowsChanged: writtenCount, plannedQueueChanges: changed, heroesUnchanged: result.heroesUnchanged, applyOutcome: args.apply ? "confirmed" : "dry_run_rolled_back" };
    if (!eligible) { summary.error = "photo_queue_has_no_eligible_candidates"; process.exitCode = 2; }
  } catch (error) {
    failure = error; summary = { ...summary, error: error instanceof Error ? error.message : String(error) };
    const unconfirmed = error instanceof PhotoQueueTransactionFailure && error.outcome === "apply_outcome_unconfirmed";
    if (unconfirmed) { writtenCount = null; records = error.records; eligible = records.filter(record => record.outcome === "eligible").length; summary = { ...summary, candidates: inputCount, eligible, applyOutcome: "apply_outcome_unconfirmed", queueRowsChanged: null, plannedQueueChanges: error.plannedChanges, nextAction: "Inspect queue rows and rerun dry before any retry" }; }
    if (inputs && !records.length) records = inputs.manifest.candidates.map(candidate => ({ type: "candidate", destinationId: candidate.destinationId, destinationName: candidate.destinationName, sourcePageUrl: candidate.sourcePageUrl, outcome: "rejected", reason: "photo_queue_transaction_failed" }));
    else records = records.map(record => record.outcome === "eligible" ? { ...record, outcome: "rejected", reason: unconfirmed ? "apply_outcome_unconfirmed" : "photo_queue_transaction_failed" } : record);
  }
  finally {
    if (client && runId) {
      try {
        const finished = await client.query(`UPDATE data_source_runs SET status=$2,finished_at=clock_timestamp(),rows_in=$3,rows_matched=$4,rows_written=$5,notes=$6
          WHERE id=$1 AND source='trail-catalog-photo-queue' AND finished_at IS NULL RETURNING id`,
        [runId, writtenCount === null ? "partial" : failure || !eligible ? "failed" : args.apply ? records.some(row => row.outcome === "rejected") ? "partial" : "success" : "dry_run", inputCount, eligible, writtenCount, JSON.stringify(summary)]);
        if (finished.rows.length !== 1) throw new Error("Mandatory photo queue finish receipt was not saved");
      } catch (error) { failure ??= error; summary = { ...summary, complete: false, auditError: error instanceof Error ? error.message : String(error) }; }
    }
    try { writeFileSync(report, [...records, summary].map(row => JSON.stringify(row)).join("\n") + "\n"); }
    finally { closeSync(report); client?.release(); await pool?.end(); }
  }
  console.log(JSON.stringify(summary));
  if (failure) throw failure;
}
