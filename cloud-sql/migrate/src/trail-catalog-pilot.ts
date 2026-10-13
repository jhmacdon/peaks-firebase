#!/usr/bin/env node
import { closeSync, openSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { buildOsmCandidate, CandidateRejection, sha256, stableJson } from "./trail-catalog/graph";
import { loadManifest, loadSourceSnapshots, prepareElevation } from "./trail-catalog/sources";
import { claimCandidate, enqueueCandidate, existingCatalogRoute, finishCandidate, type CandidateArtifact } from "./trail-catalog/jobs";
import { writePendingCandidate } from "./trail-catalog/pending";
import { requireRouteWorkerDatabaseRole } from "./standard-route-worker-role";
import type { CandidateReport, CatalogPlace, PilotManifest } from "./trail-catalog/types";

type Plan = { reports: CandidateReport[]; artifacts: Map<string, CandidateArtifact>; reviewHash: string };
export function parsePilotArgs(argv: string[]): { manifest: string; report: string; apply: boolean; reviewHash?: string } {
  let manifest = "", report = "", apply = false, reviewHash: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--apply") { apply = true; continue; }
    if (!["--manifest", "--report", "--review-hash"].includes(flag) || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Unknown or incomplete argument: ${flag}`);
    const value = argv[++i];
    if (flag === "--manifest") manifest = value; else if (flag === "--report") report = value; else reviewHash = value;
  }
  if (!manifest || !report || (apply && !/^[a-f0-9]{64}$/.test(reviewHash ?? "")) || (!apply && reviewHash)) throw new Error("Usage: routes:pilot --manifest FILE --report FILE.jsonl [--apply --review-hash SHA256]");
  return { manifest, report, apply, reviewHash };
}
function rejection(error: unknown): { reason: string; detail: string } {
  return { reason: error instanceof CandidateRejection ? error.reason : "candidate_validation_failed", detail: error instanceof Error ? error.message : String(error) };
}
export async function loadCatalogPlaces(client: Pick<PoolClient, "query">, manifest: PilotManifest): Promise<Map<string, CatalogPlace>> {
  const ids = [...new Set(manifest.candidates.flatMap(c => [c.trailheadId, c.objectiveId, c.endTrailheadId]).filter((id): id is string => Boolean(id)))];
  const rows = await client.query(`SELECT id,name,features,state_code AS "stateCode",country_code AS "countryCode",
    ST_Y(location::geometry) AS lat,ST_X(location::geometry) AS lng,ST_AsGeoJSON(boundary::geometry)::json AS boundary
    FROM destinations WHERE id=ANY($1::text[])`, [ids]);
  return new Map(rows.rows.map(row => [row.id, row as CatalogPlace]));
}
export async function planPilot(client: Pick<PoolClient, "query">, manifest: PilotManifest, baseDir: string): Promise<Plan> {
  const places = await loadCatalogPlaces(client, manifest), reports: CandidateReport[] = [], artifacts = new Map<string, CandidateArtifact>();
  const seenPairs = new Map<string, string>();
  for (const input of manifest.candidates) {
    const report: CandidateReport = { sourceKey: input.sourceKey, name: input.name, outcome: "rejected", reason: null };
    try {
      if (input.blockedReason) throw new CandidateRejection("research_source_gap", input.blockedReason);
      if (input.source.type !== "osm") throw new CandidateRejection("official_feature_proof_not_implemented");
      const pair = `${input.trailheadId}:${input.objectiveId}:${input.variant ?? "default"}`;
      if (seenPairs.has(pair)) throw new CandidateRejection("duplicate_trailhead_objective", seenPairs.get(pair));
      seenPairs.set(pair, input.sourceKey);
      if (input.variant && (input.source.relationId !== (input.variant === "mailbox-old" ? 7147738 : 5426108) || !/mailbox/i.test(input.name))) throw new CandidateRejection("invalid_mailbox_variant");
      const snapshots = loadSourceSnapshots(input.source.snapshots, baseDir);
      const built = buildOsmCandidate(input, snapshots.map(s => s.value), { trailhead: places.get(input.trailheadId ?? "")!, objective: places.get(input.objectiveId ?? ""), endTrailhead: places.get(input.endTrailheadId ?? "") });
      const duplicate = await existingCatalogRoute(client, { input });
      if (duplicate) throw new CandidateRejection("existing_catalog_route_requires_review", duplicate);
      Object.assign(report, { outcome: "admitted", geometryHash: built.geometryHash, sourceHashes: built.sourceHashes, distanceM: built.distanceM, mappedFraction: built.mappedFraction, usedWayIds: built.usedWayIds, requiredCutIndices: built.requiredCutIndices, pendingReady: false });
      try {
        const bound = [built.trailhead, built.objective, built.endTrailhead].filter((p): p is CatalogPlace => Boolean(p));
        if (!bound.some(p => p.stateCode) || !bound.some(p => p.countryCode)) throw new CandidateRejection("route_region_missing_or_ambiguous");
        const candidate = prepareElevation(built, baseDir);
        artifacts.set(input.sourceKey, { candidate, snapshots: snapshots.map((snapshot, i) => ({ sha256: input.source.snapshots[i].sha256, body: snapshot.body })) });
        report.pendingReady = true; report.gainM = candidate.gainM;
      } catch (error) { report.pendingBlocker = rejection(error).reason; report.detail = rejection(error).detail; }
    } catch (error) { Object.assign(report, rejection(error)); }
    reports.push(report);
  }
  // Includes source bytes, exact catalog bindings, DEM samples and all rejected inputs.
  const reviewHash = sha256(stableJson({ manifest, reports, artifacts: [...artifacts.entries()] }));
  return { reports, artifacts, reviewHash };
}

export async function applyPilot(client: PoolClient, manifest: PilotManifest, plan: Plan, reviewHash: string, progress?: (reports: CandidateReport[]) => void): Promise<CandidateReport[]> {
  if (reviewHash !== plan.reviewHash) throw new Error("Review hash differs from the current candidate plan; run dry again and review its report");
  await requireRouteWorkerDatabaseRole(client, "peaks-route-factory");
  const reports: CandidateReport[] = [];
  const record = (report: CandidateReport) => { reports.push(report); progress?.([...reports]); };
  for (const report of plan.reports) {
    const artifact = plan.artifacts.get(report.sourceKey);
    if (!artifact) {
      const rejectedArtifact = { input: manifest.candidates.find(c => c.sourceKey === report.sourceKey), report };
      const inputHash = sha256(stableJson(rejectedArtifact));
      const result = await client.query(`INSERT INTO trail_catalog_candidate_jobs(source_key,batch_key,input_hash,review_hash,artifact,state,rejection_reason,result,proposed_route_id)
        VALUES($1,$2,$3,$4,$5::jsonb,'rejected',$6,$7::jsonb,$8) ON CONFLICT(source_key) DO UPDATE SET updated_at=trail_catalog_candidate_jobs.updated_at RETURNING input_hash`,
      [report.sourceKey, manifest.batchKey, inputHash, reviewHash, JSON.stringify(rejectedArtifact), report.reason ?? report.pendingBlocker, JSON.stringify(report), `trail-${randomUUID()}`]);
      record(result.rows[0]?.input_hash === inputHash ? report : { ...report, outcome: "rejected", reason: "source_key_input_changed_requires_review" });
      continue;
    }
    let lease: Awaited<ReturnType<typeof claimCandidate>> = null;
    try {
      const queued = await enqueueCandidate(client, manifest.batchKey, reviewHash, artifact);
      if (queued.state === "pending") {
        const binding = await client.query("SELECT trail_catalog_pending_binding_valid($1) AS valid", [queued.routeId]);
        if (!binding.rows[0]?.valid) throw new CandidateRejection("pending_receipt_drift_requires_review");
        record({ ...report, routeId: queued.routeId!, writeAction: "existing" }); continue;
      }
      lease = await claimCandidate(client, report.sourceKey, sha256(stableJson(artifact)), `${hostname()}:${process.pid}`);
      if (!lease) throw new CandidateRejection(queued.state === "rejected" ? "candidate_previously_rejected" : "candidate_leased_elsewhere");
      record(await writePendingCandidate(client, lease));
    } catch (error) {
      const failed = { ...report, outcome: "rejected" as const, ...rejection(error) };
      record(failed);
      if (lease) await finishCandidate(client, lease, null, failed, failed.reason);
    }
  }
  return reports;
}

function pilotPool(): Pool {
  if (process.env.NODE_ENV === "test") {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !decodeURIComponent(new URL(url).pathname).endsWith("_test")) throw new Error("Pilot tests require TEST_DATABASE_URL naming an isolated _test database");
    return new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 60_000, lock_timeout: 5000 });
  }
  return new Pool({ host: process.env.DB_HOST || "localhost", port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || "peaks", user: process.env.DB_USER || "peaks-api", password: process.env.DB_PASS, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 60_000, lock_timeout: 5000 });
}
async function main(): Promise<void> {
  const args = parsePilotArgs(process.argv.slice(2));
  // Reserve a fresh report before any database writes; never replace prior evidence.
  const reportFd = openSync(args.report, "wx");
  let pool: Pool | undefined;
  let client: PoolClient | undefined, runId: string | undefined, guardedAudit = false;
  let reports: CandidateReport[] = [], summary: Record<string, unknown> = { type: "summary", mode: args.apply ? "apply-pending" : "dry-run" };
  let failure: unknown;
  try {
    pool = pilotPool();
    client = await pool.connect();
    guardedAudit = (await client.query("SELECT to_regprocedure('begin_trail_catalog_source_run(text)') IS NOT NULL AS exists")).rows[0]?.exists === true;
    if (args.apply && !guardedAudit) throw new Error("Pilot apply requires the candidate worker-guard migration");
    const notes = JSON.stringify({ state: "started", manifestPath: args.manifest, reportPath: args.report });
    const receipt = guardedAudit ? await client.query("SELECT begin_trail_catalog_source_run($1) AS id", [notes]) : await client.query(`INSERT INTO data_source_runs(source,run_kind,status,started_at,notes)
      VALUES('trail-catalog-pilot','import','failed',now(),$1) RETURNING id`, [notes]);
    runId = receipt.rows[0]?.id;
    if (!runId) throw new Error("Mandatory run receipt was not created");
    const { manifest, baseDir } = loadManifest(args.manifest);
    const plan = await planPilot(client, manifest, baseDir);
    reports = plan.reports;
    summary = { ...summary, batchKey: manifest.batchKey, reviewHash: plan.reviewHash };
    if (args.apply) reports = await applyPilot(client, manifest, plan, args.reviewHash!, completed => { reports = [...completed, ...plan.reports.slice(completed.length)]; });
    const blockers = reports.reduce<Record<string, number>>((counts, report) => { const key = report.reason ?? report.pendingBlocker; if (key) counts[key] = (counts[key] ?? 0) + 1; return counts; }, {});
    summary = { ...summary, candidates: reports.length, admitted: reports.filter(r => r.outcome === "admitted").length, pendingReady: reports.filter(r => r.pendingReady && r.outcome === "admitted").length, written: reports.filter(r => r.writeAction === "created").length, existing: reports.filter(r => r.writeAction === "existing").length, blockers };
    if (Object.keys(blockers).length) process.exitCode = 2;
    console.log(JSON.stringify(summary));
  } catch (error) { failure = error; summary = { ...summary, error: rejection(error) }; }
  finally {
    try {
      if (client && runId) await client.query(guardedAudit ? "SELECT finish_trail_catalog_source_run($1,$2,$3,$4,$5,$6)" : `UPDATE data_source_runs SET status=$2,finished_at=now(),rows_in=$3,rows_matched=$4,rows_written=$5,notes=$6 WHERE id=$1`,
        [runId, failure ? "failed" : args.apply ? (reports.every(r => r.outcome === "admitted" && r.pendingReady) ? "success" : "partial") : "dry_run", reports.length, reports.filter(r => r.outcome === "admitted").length, args.apply ? reports.filter(r => r.writeAction === "created").length : 0, JSON.stringify(summary)]);
    } catch (error) { failure ??= error; summary = { ...summary, auditError: rejection(error) }; }
    try { writeFileSync(reportFd, [...reports, summary].map(row => JSON.stringify(row)).join("\n") + "\n"); }
    finally { closeSync(reportFd); client?.release(); await pool?.end(); }
  }
  if (failure) throw failure;
}
if (require.main === module) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
