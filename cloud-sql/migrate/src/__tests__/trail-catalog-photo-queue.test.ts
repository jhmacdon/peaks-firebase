import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import { executePhotoQueueTransaction, parsePhotoQueueArgs, planPhotoQueue, readPhotoQueueInputs, runPhotoQueueImport, PhotoQueueTransactionFailure, type PhotoQueueInputs } from "../trail-catalog-photo-queue";
import { sha256, stableJson } from "../trail-catalog/graph";

const place = { id: "head", name: "Example Trailhead", lat: 47, lng: -121 };
const photo = { destinationId: place.id, destinationName: place.name, imageUrl: "https://upload.wikimedia.org/example.jpg", sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg", sourceKind: "wikimedia_commons", photographer: "Example author", licenseName: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", imageWidth: 2000, imageHeight: 1400, focalX: 50, focalY: 50 };
const inputs: PhotoQueueInputs = { manifest: { collection: "WA trail catalog", researchedAt: "2026-10-13", candidates: [photo] }, catalog: [place],
  review: { targets: [place], proposals: [{ destinationId: place.id, sourcePageUrl: photo.sourcePageUrl, metadataFile: "metadata.json", metadataSha256: "a".repeat(64), candidateSha256: sha256(stableJson(photo)) }] },
  manifestSha256: "a".repeat(64), reviewSha256: "b".repeat(64), catalogSha256: "c".repeat(64), metadataHashes: ["a".repeat(64)] };
const live = { ...place, hero: { hero_image: null, hero_image_attribution: null, hero_image_attribution_url: null, hero_image_focal_x: 50, hero_image_focal_y: 50 } };
const queued = { id: "existing-review-id", destination_id: place.id, source_page_url: photo.sourcePageUrl, status: "pending", image_url: photo.imageUrl, source_kind: photo.sourceKind, photographer: photo.photographer, license_name: photo.licenseName, license_url: photo.licenseUrl, image_width: photo.imageWidth, image_height: photo.imageHeight, focal_x: photo.focalX, focal_y: photo.focalY };

test("photo queue apply requires both reviewed checksums and rejects unknown or duplicate flags", () => {
  const flags = ["--manifest", "m", "--review", "v", "--catalog", "c", "--report", "r"];
  assert.equal(parsePhotoQueueArgs(flags).apply, false);
  assert.throws(() => parsePhotoQueueArgs([...flags, "--apply"]), /Usage/);
  assert.throws(() => parsePhotoQueueArgs([...flags, "--apply", "--manifest-sha256", "a".repeat(64)]), /Usage/);
  assert.throws(() => parsePhotoQueueArgs([...flags, "--approve"]), /argument/);
  assert.throws(() => parsePhotoQueueArgs([...flags, "--manifest", "other"]), /argument/);
  assert.equal(parsePhotoQueueArgs([...flags, "--apply", "--manifest-sha256", "a".repeat(64), "--review-hash", "b".repeat(64)]).apply, true);
});
test("photo manifest, exact proposal metadata, and catalog snapshot are checksum-bound", () => {
  const dir = mkdtempSync(join(tmpdir(), "trail-photo-queue-"));
  const args = { manifest: join(dir, "manifest.json"), review: join(dir, "review.json"), catalog: join(dir, "catalog.json"), report: join(dir, "report.jsonl"), apply: false };
  try {
    const metadata = "{}";
    writeFileSync(join(dir, "metadata.json"), metadata);
    writeFileSync(args.manifest, JSON.stringify(inputs.manifest));
    writeFileSync(args.catalog, JSON.stringify({ places: inputs.catalog }));
    writeFileSync(args.review, JSON.stringify({ ...inputs.review, proposals: [{ ...inputs.review.proposals[0], metadataSha256: sha256(metadata) }] }));
    const loaded = readPhotoQueueInputs(args);
    assert.equal(loaded.catalog[0].id, place.id);
    assert.throws(() => readPhotoQueueInputs({ ...args, apply: true, manifestSha256: "d".repeat(64) }), /Manifest checksum/);
    writeFileSync(join(dir, "metadata.json"), '{"changed":true}');
    assert.throws(() => readPhotoQueueInputs(args), /metadata checksum changed/);
    writeFileSync(args.manifest, JSON.stringify({ ...inputs.manifest, candidates: [] }));
    assert.throws(() => readPhotoQueueInputs(args), /non-empty array/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("photo plans reject wrong live bindings, missing proposal, and credited heroes", () => {
  const plan = (binding: typeof live, data = inputs) => planPhotoQueue(data, [binding], []).records[0];
  assert.equal(plan(live).outcome, "eligible");
  assert.equal(plan({ ...live, lng: -120 }).reason, "photo_live_catalog_binding_changed");
  assert.equal(plan({ ...live, name: "Renamed" }).reason, "photo_live_catalog_binding_changed");
  assert.equal(plan(live, { ...inputs, review: { ...inputs.review, proposals: [] } }).reason, "photo_source_proposal_missing_or_ambiguous");
  assert.equal(plan(live, { ...inputs, manifest: { ...inputs.manifest, candidates: [{ ...photo, imageUrl: "https://example.org/swapped.jpg" }] } }).reason, "photo_source_proposal_candidate_changed");
  assert.equal(plan({ ...live, hero: { ...live.hero, hero_image: "image", hero_image_attribution: "credit", hero_image_attribution_url: "url" } } as never).reason, "destination_already_has_credited_hero");
});
test("photo retries preserve existing queue IDs and never replace reviewed rows or stale source metadata", () => {
  const prior = planPhotoQueue(inputs, [live], [queued]);
  assert.equal(prior.records[0].candidateId, queued.id);
  assert.equal(prior.records[0].queueAction, "already_queued");
  assert.equal(planPhotoQueue(inputs, [live], [{ ...queued, status: "approved" }]).records[0].reason, "photo_candidate_already_reviewed");
  assert.equal(planPhotoQueue(inputs, [live], [{ ...queued, image_url: "https://example.org/other.jpg" }]).records[0].reason, "photo_existing_queue_metadata_changed");
  assert.notEqual(prior.reviewHash, planPhotoQueue(inputs, [live], []).reviewHash);
});
function transactionClient(options: { heroChanged?: boolean; creditedHero?: boolean; commitResponseLost?: boolean } = {}) {
  const calls: string[] = []; let reads = 0;
  const client = { query: async (sql: string) => {
    calls.push(sql);
    if (sql === "COMMIT" && options.commitResponseLost) throw new Error("Connection lost while awaiting COMMIT response");
    if (sql.includes("jsonb_object_agg")) {
      reads++;
      const changed = options.heroChanged && reads > 1;
      return { rows: [{ ...live, hero: changed ? { ...live.hero, hero_image_focal_x: 70 } : options.creditedHero ? { hero_image: "image", hero_image_attribution: "credit", hero_image_attribution_url: "url" } : live.hero }] };
    }
    if (sql.includes("FROM destination_photo_candidates")) return { rows: [] };
    if (sql.includes("SELECT id, name FROM destinations")) return { rows: [place] };
    return { rows: [], rowCount: sql.startsWith("INSERT INTO destination_photo_candidates") ? 1 : 0 };
  } } as unknown as PoolClient;
  return { client, calls };
}
test("dry run calls the existing importer under destination locks then rolls back with hero proof", async () => {
  const { client, calls } = transactionClient();
  const result = await executePhotoQueueTransaction(client, inputs, { apply: false });
  assert.equal(result.changed, 1); assert.equal(result.heroesUnchanged, true);
  assert.match(calls.find(sql => sql.includes("jsonb_object_agg"))!, /ORDER BY d.id FOR UPDATE OF d/);
  assert.ok(calls.findIndex(sql => sql.includes("FROM destination_photo_candidates")) < calls.findIndex(sql => sql.includes("jsonb_object_agg")), "match the human approval lock order");
  assert.equal(calls.filter(sql => sql.includes("FROM destination_photo_candidates")).length, 2, "recheck concurrent inserts after destination locks");
  assert.match(calls.find(sql => sql.startsWith("INSERT INTO destination_photo_candidates"))!, /WHERE destination_photo_candidates.status = 'pending'/);
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.ok(!calls.some(sql => /UPDATE destinations|status\s*=\s*'approved'/.test(sql)));
});
test("apply aborts before queue writes when the dry hash is stale and rolls back hero changes", async () => {
  const stale = transactionClient();
  await assert.rejects(() => executePhotoQueueTransaction(stale.client, inputs, { apply: true, reviewHash: "d".repeat(64) }), /review hash changed/);
  assert.ok(!stale.calls.some(sql => sql.startsWith("INSERT INTO destination_photo_candidates")));
  assert.equal(stale.calls.at(-1), "ROLLBACK");
  const changed = transactionClient({ heroChanged: true });
  await assert.rejects(() => executePhotoQueueTransaction(changed.client, inputs, { apply: false }), /hero fields/);
  assert.equal(changed.calls.at(-1), "ROLLBACK");
});
test("apply commits only the exact reviewed plan and skips already credited targets", async () => {
  const dry = await executePhotoQueueTransaction(transactionClient().client, inputs, { apply: false });
  const apply = transactionClient();
  assert.equal((await executePhotoQueueTransaction(apply.client, inputs, { apply: true, reviewHash: dry.reviewHash })).changed, 1);
  assert.equal(apply.calls.at(-1), "COMMIT");
  const covered = transactionClient({ creditedHero: true });
  const result = await executePhotoQueueTransaction(covered.client, inputs, { apply: false });
  assert.equal(result.records[0].reason, "destination_already_has_credited_hero");
  assert.equal(result.changed, 0); assert.ok(!covered.calls.some(sql => sql.startsWith("INSERT INTO destination_photo_candidates")));
});
test("a lost COMMIT response reports an unconfirmed apply with every planned row, never a known rollback", async () => {
  const dry = await executePhotoQueueTransaction(transactionClient().client, inputs, { apply: false });
  const failed = transactionClient({ commitResponseLost: true });
  await assert.rejects(() => executePhotoQueueTransaction(failed.client, inputs, { apply: true, reviewHash: dry.reviewHash }), error => {
    assert.ok(error instanceof PhotoQueueTransactionFailure);
    assert.equal(error.outcome, "apply_outcome_unconfirmed");
    assert.equal(error.plannedChanges, 1);
    assert.equal(error.records.length, 1); assert.equal(error.records[0].candidateId, dry.records[0].candidateId);
    return true;
  });
  assert.equal(failed.calls.at(-2), "COMMIT"); assert.equal(failed.calls.at(-1), "ROLLBACK");
});
test("runner failure reports retain run/input bindings, unknown writes, and confirmed writes after audit failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trail-photo-runner-"));
  const args = { manifest: join(dir, "manifest.json"), review: join(dir, "review.json"), catalog: join(dir, "catalog.json"), report: join(dir, "unused.jsonl"), apply: false };
  try {
    writeFileSync(join(dir, "metadata.json"), "{}");
    writeFileSync(args.manifest, JSON.stringify(inputs.manifest)); writeFileSync(args.catalog, JSON.stringify(inputs.catalog));
    writeFileSync(args.review, JSON.stringify({ ...inputs.review, proposals: [{ ...inputs.review.proposals[0], metadataSha256: sha256("{}") }] }));
    const loaded = readPhotoQueueInputs(args), dry = planPhotoQueue(loaded, [live], []);
    const base = ["--manifest", args.manifest, "--review", args.review, "--catalog", args.catalog, "--apply", "--manifest-sha256", loaded.manifestSha256];
    for (const scenario of ["stale", "unknown_commit", "audit_finish"] as const) {
      const report = join(dir, `${scenario}.jsonl`), auditParams: unknown[][] = [];
      const transaction = transactionClient({ commitResponseLost: scenario === "unknown_commit" });
      const query = transaction.client.query.bind(transaction.client);
      const client = { ...transaction.client, release: () => undefined, query: async (sql: string, params?: unknown[]) => {
        if (sql.startsWith("INSERT INTO data_source_runs")) return { rows: [{ id: "audit-89" }] };
        if (sql.startsWith("UPDATE data_source_runs")) {
          auditParams.push(params!);
          if (scenario === "audit_finish") throw new Error("Audit finish connection failed");
          return { rows: [{ id: "audit-89" }] };
        }
        return query(sql, params);
      } } as unknown as PoolClient;
      const pool = { connect: async () => client, end: async () => undefined } as unknown as Pool;
      await assert.rejects(() => runPhotoQueueImport([...base, "--report", report, "--review-hash", scenario === "stale" ? "d".repeat(64) : dry.reviewHash], pool));
      const rows = readFileSync(report, "utf8").trim().split("\n").map(line => JSON.parse(line)), summary = rows.at(-1);
      assert.equal(summary.runId, "audit-89"); assert.equal(summary.manifestSha256, loaded.manifestSha256);
      assert.equal(summary.reviewSha256, loaded.reviewSha256); assert.equal(summary.catalogSha256, loaded.catalogSha256); assert.equal(summary.complete, false);
      assert.equal(rows.length, 2);
      if (scenario === "unknown_commit") {
        assert.equal(summary.applyOutcome, "apply_outcome_unconfirmed"); assert.equal(summary.queueRowsChanged, null);
        assert.equal(summary.plannedQueueChanges, 1); assert.equal(rows[0].reason, "apply_outcome_unconfirmed");
        assert.equal(auditParams[0][1], "partial"); assert.equal(auditParams[0][4], null);
      } else if (scenario === "audit_finish") {
        assert.equal(summary.applyOutcome, "confirmed"); assert.equal(summary.queueRowsChanged, 1);
        assert.equal(rows[0].outcome, "eligible"); assert.match(summary.auditError, /Audit finish/);
        assert.equal(auditParams[0][4], 1);
      } else { assert.equal(rows[0].reason, "photo_queue_transaction_failed"); assert.equal(auditParams[0][4], 0); }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
