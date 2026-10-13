#!/usr/bin/env node
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { requireRouteWorkerDatabaseRole } from "./standard-route-worker-role";
import { digest, object, requireHash, type Json } from "./trail-catalog/review";
import { bindPacket, finishReview, inspectCandidate, mutate, packetPlanHash, planPacket, planReview, recordVerification, snapshotCandidate, verifyPublishedCandidate, type Queryable } from "./trail-catalog/review-operations";

type Command = "packet" | "review" | "activate" | "verify" | "heartbeat" | "release";
export type ReviewArgs = { command: Command; sourceKeys: string[]; report: string; apply: boolean; reviewHash?: string; packet?: string; result?: string; output?: string; plan?: string; receiptHashes: string[]; batchSize: number };
export function parseReviewArgs(argv: string[]): ReviewArgs {
  const command = argv[0] as Command;
  if (!["packet", "review", "activate", "verify", "heartbeat", "release"].includes(command)) throw new Error("Choose packet, review, activate, verify, heartbeat, or release");
  const values: Json = {}, sourceKeys: string[] = [], receiptHashes: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--apply") { if (values.apply) throw new Error("repeated --apply"); values.apply = true; continue; }
    if (!["--source-key", "--receipt-hash", "--report", "--review-hash", "--packet", "--result", "--output", "--plan", "--batch-size"].includes(flag) || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`unknown or incomplete argument: ${flag}`);
    const value = argv[++i];
    if (flag === "--source-key") sourceKeys.push(value);
    else if (flag === "--receipt-hash") receiptHashes.push(requireHash(value, "receipt hash"));
    else { if (values[flag]) throw new Error(`repeated ${flag}`); values[flag] = value; }
  }
  const apply = values.apply === true, batchSize = Number(values["--batch-size"] ?? 1);
  const commandFlags: Record<Command, string[]> = { packet: ["--output", ...(apply ? ["--plan"] : [])], review: ["--packet", "--result"], activate: ["--batch-size"], verify: [], heartbeat: ["--packet"], release: ["--packet"] };
  for (const flag of Object.keys(values)) if (!["apply", "--report", "--review-hash", ...commandFlags[command]].includes(flag)) throw new Error(`argument ${flag} does not belong to ${command}`);
  if (!["activate", "verify"].includes(command) && receiptHashes.length) throw new Error("receipt hashes belong only to activation or verification");
  if (!sourceKeys.length || new Set(sourceKeys).size !== sourceKeys.length || !values["--report"]) throw new Error("nonempty unique --source-key and --report are required");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500 || sourceKeys.length > batchSize) throw new Error("batch size must be 1..500 (default 1) and cover every input");
  if (command !== "activate" && sourceKeys.length !== 1) throw new Error("this stage handles exactly one leased route");
  if (apply) requireHash(values["--review-hash"], "review hash"); else if (values["--review-hash"]) throw new Error("--review-hash requires --apply");
  if (command === "packet" && (!values["--output"] || (apply && !values["--plan"]))) throw new Error("packet requires --output; apply also requires the exact dry --plan");
  if (["review", "heartbeat", "release"].includes(command) && !values["--packet"]) throw new Error("this stage requires --packet");
  if (command === "review" && !values["--result"]) throw new Error("review requires independent --result");
  if (["activate", "verify"].includes(command) && receiptHashes.length !== sourceKeys.length) throw new Error("each source key requires its paired receipt hash");
  return { command, sourceKeys, report: values["--report"], apply, reviewHash: values["--review-hash"], packet: values["--packet"], result: values["--result"], output: values["--output"], plan: values["--plan"], receiptHashes, batchSize };
}
function readJson(path: string): Json {
  const body = readFileSync(path); if (body.length > 25_000_000) throw new Error("review input exceeds 25 MB");
  return object(JSON.parse(body.toString("utf8")), "review file");
}
function receiptHash(snapshot: Json): string {
  return requireHash(snapshot.reviewReceipt?.receiptHash ?? snapshot.reviewReceipt?.receipt_hash, "durable review receipt hash");
}
export async function planActivation(client: Queryable, sourceKeys: string[], receiptHashes: string[]): Promise<Json> {
  if (!sourceKeys.length || sourceKeys.length > 500 || sourceKeys.length !== receiptHashes.length || new Set(sourceKeys).size !== sourceKeys.length) throw new Error("activation input must contain 1..500 unique paired jobs");
  const records: Json[] = [];
  for (let i = 0; i < sourceKeys.length; i++) {
    const snapshot = await snapshotCandidate(client, sourceKeys[i]);
    if (receiptHash(snapshot) !== receiptHashes[i]) throw new Error("review receipt changed");
    const checks = await inspectCandidate(client, snapshot);
    records.push({ sourceKey: sourceKeys[i], routeId: snapshot.routeId, inputHash: snapshot.inputHash, receiptHash: receiptHashes[i], passed: checks.passed, errors: checks.errors, machineChecks: checks.machineChecks });
  }
  const drain = object((await client.query("SELECT trail_catalog_rematch_drain_status() AS drain")).rows[0]?.drain, "rematch drain");
  return { records, rematch: drain, reviewHash: digest({ records, rematch: drain }) };
}
export async function applyActivation(client: Queryable, plan: Json, expectedHash: string, publicBaseUrl?: string, progress?: (record: Json) => void, verify = verifyPublishedCandidate): Promise<Json[]> {
  if (!Array.isArray(plan.records) || !plan.records.length || plan.records.length > 500 || plan.reviewHash !== expectedHash || plan.rematch.drained !== true || !plan.records.every((record: Json) => record.passed === true)) throw new Error("activation plan changed or contains blockers");
  const records: Json[] = [];
  for (const row of plan.records) {
    let publishLease: Json | null = null;
    try {
      const lease = (await mutate(client, "SELECT claim_trail_catalog_publish($1,$2) AS lease", [row.sourceKey, row.receiptHash], "claim publication")).rows[0]?.lease;
      if (!lease?.leaseToken) throw new Error("publish lease unavailable or previous route verification incomplete");
      publishLease = lease;
      const receipt = (await mutate(client, "SELECT activate_trail_catalog_candidate($1,$2,$3) AS receipt", [row.sourceKey, lease.leaseToken, row.receiptHash], "activate route")).rows[0]?.receipt;
      if (receipt?.state !== "published") throw Object.assign(new Error("activation returned no confirmed receipt; inspect the durable job"), { outcomeUnconfirmed: true });
      const result: Json = { ...row, action: "activated", receipt, verification: null }; records.push(result); progress?.(result);
      const verification = await recordVerification(client, row.sourceKey, row.receiptHash, verify, publicBaseUrl); result.verification = verification;
      if (!verification.result.passed) throw new Error("activated route awaits rematch drain or public verification; no next route may activate");
    } catch (error: any) {
      const confirmed = records.find(record => record.sourceKey === row.sourceKey);
      if (publishLease && !confirmed && !error.outcomeUnconfirmed) await mutate(client, "SELECT release_trail_catalog_publish($1,$2)", [row.sourceKey, publishLease.leaseToken], "release publication");
      const failed = { ...row, action: confirmed ? "awaiting_verification" : "not_completed_check_receipt", outcomeUnconfirmed: error.outcomeUnconfirmed === true, error: error instanceof Error ? error.message : String(error) };
      if (confirmed) { confirmed.error = failed.error; confirmed.outcomeUnconfirmed = failed.outcomeUnconfirmed; }
      if (!records.some(record => record.sourceKey === row.sourceKey)) { records.push(failed); progress?.(failed); }
      for (const next of plan.records.slice(records.length)) { const stopped = { ...next, action: "not_attempted", error: "previous activation or verification incomplete" }; records.push(stopped); progress?.(stopped); }
      throw Object.assign(new Error(failed.error), { records, outcomeUnconfirmed: failed.outcomeUnconfirmed });
    }
  }
  return records;
}
function reviewPool(command: Command): Pool {
  if (process.env.NODE_ENV === "test") {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !decodeURIComponent(new URL(url).pathname).endsWith("_test")) throw new Error("Review tests require an isolated TEST_DATABASE_URL ending in _test");
    return new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 60_000, lock_timeout: 5_000 });
  }
  const user = ["packet", "review", "heartbeat", "release"].includes(command) ? "peaks-route-reviewer-worker" : "peaks-route-factory-worker";
  if (process.env.DB_HOST !== "127.0.0.1" || process.env.DB_PORT !== "5432" || process.env.DB_NAME !== "peaks" || process.env.DB_USER !== user || !process.env.DB_PASS) throw new Error("supervised review requires the fixed proxy target and already loaded exact lane login");
  return new Pool({ host: "127.0.0.1", port: 5432, database: "peaks", user, password: process.env.DB_PASS, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 60_000, lock_timeout: 5_000 });
}
async function main(): Promise<void> {
  const args = parseReviewArgs(process.argv.slice(2)), reportFd = openSync(args.report, "wx", 0o600);
  let pool: Pool | undefined, client: PoolClient | undefined, runId: string | undefined, failure: unknown, outputFd: number | undefined, knownWrites = 0;
  const records: Json[] = []; let summary: Json = { type: "summary", command: args.command, mode: args.apply ? "apply" : "dry-run", writes: 0 };
  try {
    if (args.output) outputFd = openSync(args.output, "wx", 0o600);
    pool = reviewPool(args.command); client = await pool.connect();
    await requireRouteWorkerDatabaseRole(client, ["packet", "review", "heartbeat", "release"].includes(args.command) ? "peaks-route-reviewer" : "peaks-route-factory");
    runId = (await client.query("SELECT begin_trail_catalog_source_run($1) AS id", [JSON.stringify({ phase: "independent-review", command: args.command, mode: summary.mode, sourceKeys: args.sourceKeys, report: args.report })])).rows[0]?.id;
    if (!runId) throw new Error("mandatory audit receipt was not created");
    summary.runId = runId;
    const sourceKey = args.sourceKeys[0];
    if (args.command === "packet") {
      const packet = args.apply ? await bindPacket(client, sourceKey, readJson(args.plan!), args.reviewHash!) : await planPacket(client, sourceKey);
      if (args.apply) knownWrites = 1;
      records.push({ sourceKey, routeId: packet.routeId, passed: packet.sourceCheck.passed, errors: packet.sourceCheck.errors, output: args.output, bound: args.apply });
      writeFileSync(outputFd!, `${JSON.stringify(packet, null, 2)}\n`);
      summary = { ...summary, output: args.output, reviewHash: packetPlanHash(packet), bound: args.apply, passed: packet.sourceCheck.passed, writes: args.apply ? 1 : 0 };
    } else if (args.command === "review") {
      const plan = await planReview(client, sourceKey, readJson(args.packet!), readJson(args.result!));
      const receipt = args.apply ? await finishReview(client, plan, args.reviewHash!) : null;
      if (args.apply) knownWrites = 1;
      records.push({ sourceKey, routeId: plan.routeId, verdict: plan.result.verdict, receipt }); summary = { ...summary, reviewHash: plan.reviewHash, writes: args.apply ? 1 : 0 };
    } else if (args.command === "activate") {
      const plan = await planActivation(client, args.sourceKeys, args.receiptHashes); summary = { ...summary, reviewHash: plan.reviewHash, blockers: plan.records.filter((row: Json) => !row.passed), rematch: plan.rematch };
      if (args.apply) { await applyActivation(client, plan, args.reviewHash!, undefined, row => { records.push(row); if (row.action === "activated") knownWrites++; }); summary.writes = knownWrites; }
      else records.push(...plan.records);
    } else if (args.command === "verify") {
      const snapshot = await snapshotCandidate(client, sourceKey); if (receiptHash(snapshot) !== args.receiptHashes[0]) throw new Error("review receipt changed");
      const snapshotHash = requireHash((await client.query("SELECT trail_catalog_verification_snapshot_hash($1) AS hash", [sourceKey])).rows[0]?.hash, "verification snapshot hash");
      const hash = digest({ sourceKey, inputHash: snapshot.inputHash, receiptHash: args.receiptHashes[0], snapshotHash }); summary.reviewHash = hash;
      if (args.apply && hash !== args.reviewHash) throw new Error("verification dry plan differs");
      records.push(args.apply ? await recordVerification(client, sourceKey, args.receiptHashes[0]) : { sourceKey, result: await verifyPublishedCandidate(client, snapshot) }); if (args.apply) knownWrites = 1; summary.writes = knownWrites;
    } else {
      const packet = readJson(args.packet!), binding = object(packet.attestation, "packet attestation");
      if (binding.sourceKey !== sourceKey || !binding.leaseToken) throw new Error("packet lacks this source's review lease");
      summary.reviewHash = digest({ command: args.command, sourceKey, binding });
      if (args.apply && summary.reviewHash !== args.reviewHash) throw new Error("lease action differs from dry plan");
      const receipt = args.apply ? (await mutate(client, `SELECT ${args.command === "heartbeat" ? "heartbeat" : "release"}_trail_catalog_review($1,$2) AS receipt`, [sourceKey, binding.leaseToken], args.command)).rows[0]?.receipt : null;
      if (args.apply) knownWrites = 1;
      records.push({ sourceKey, action: args.command, receipt }); summary.writes = args.apply ? 1 : 0;
    }
    if (records.some(row => row.passed === false || row.result?.passed === false || row.verification?.result?.passed === false) || summary.blockers?.length || summary.rematch?.drained === false) process.exitCode = 2;
  } catch (error: any) {
    failure = error;
    summary = { ...summary, error: error instanceof Error ? error.message : String(error), writes: error.outcomeUnconfirmed ? null : knownWrites, knownWrites, confirmedRouteIds: records.filter(row => row.action === "activated").map(row => row.routeId), outcomeUnconfirmed: error.outcomeUnconfirmed === true, incomplete: args.apply };
    if (records.length === 0) records.push(...args.sourceKeys.map(sourceKey => ({ sourceKey, outcome: "failed", reason: summary.error })));
  } finally {
    try { if (client && runId) await client.query("SELECT finish_trail_catalog_review_run($1,$2,$3,$4,$5,$6)", [runId, failure ? "failed" : args.apply ? (process.exitCode === 2 ? "partial" : "success") : "dry_run", args.sourceKeys.length, records.filter(row => row.passed !== false && row.result?.passed !== false && !row.error).length, summary.writes, JSON.stringify(summary)]); }
    catch (error) { failure ??= error; summary.auditError = error instanceof Error ? error.message : String(error); summary.incomplete = true; }
    try { writeFileSync(reportFd, [...records, summary].map(row => JSON.stringify(row)).join("\n") + "\n"); } finally { closeSync(reportFd); if (outputFd !== undefined) closeSync(outputFd); client?.release(); await pool?.end(); }
  }
  console.log(JSON.stringify(summary)); if (failure) throw failure;
}
if (require.main === module) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
