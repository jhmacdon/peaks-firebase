import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { CandidateRejection, sha256, stableJson } from "./graph";
import type { ReadyCandidate } from "./types";

export interface CandidateArtifact { candidate: ReadyCandidate; snapshots: { sha256: string; body: string }[] }
export interface CandidateLease { sourceKey: string; token: string; inputHash: string; proposedRouteId: string; artifact: CandidateArtifact }

/** Source identity is stable across retries; changed reviewed input requires a new review. */
export async function enqueueCandidate(client: PoolClient, batchKey: string, reviewHash: string, artifact: CandidateArtifact): Promise<{ state: string; routeId: string | null }> {
  const inputHash = sha256(stableJson(artifact));
  const result = await client.query(`INSERT INTO trail_catalog_candidate_jobs(source_key,batch_key,input_hash,review_hash,artifact,proposed_route_id)
    VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(source_key) DO UPDATE SET updated_at=trail_catalog_candidate_jobs.updated_at
    RETURNING state,route_id,input_hash`, [artifact.candidate.input.sourceKey, batchKey, inputHash, reviewHash, JSON.stringify(artifact), `trail-${randomUUID()}`]);
  if (result.rows[0].input_hash !== inputHash) throw new CandidateRejection("source_key_input_changed_requires_review");
  return { state: result.rows[0].state, routeId: result.rows[0].route_id };
}

export async function claimCandidate(client: PoolClient, sourceKey: string, inputHash: string, owner: string): Promise<CandidateLease | null> {
  const token = randomUUID();
  const result = await client.query(`WITH available AS (
    SELECT source_key FROM trail_catalog_candidate_jobs WHERE source_key=$1 AND input_hash=$2
      AND (state='queued' OR (state='leased' AND lease_expires_at<now())) FOR UPDATE SKIP LOCKED
  ) UPDATE trail_catalog_candidate_jobs j SET state='leased',lease_owner=$3,lease_token=$4,
      lease_expires_at=now()+interval '15 minutes',attempt_count=attempt_count+1,updated_at=now()
    FROM available WHERE j.source_key=available.source_key RETURNING j.artifact,j.proposed_route_id`, [sourceKey, inputHash, owner, token]);
  return result.rows.length ? { sourceKey, token, inputHash, proposedRouteId: result.rows[0].proposed_route_id, artifact: result.rows[0].artifact } : null;
}

export async function lockCandidateLease(client: PoolClient, lease: CandidateLease): Promise<void> {
  const result = await client.query(`SELECT source_key,artifact,proposed_route_id FROM trail_catalog_candidate_jobs WHERE source_key=$1 AND input_hash=$2
    AND state='leased' AND lease_token=$3 AND lease_expires_at>now() FOR UPDATE`, [lease.sourceKey, lease.inputHash, lease.token]);
  if (result.rows.length !== 1) throw new CandidateRejection("candidate_lease_lost");
  if (sha256(stableJson(result.rows[0].artifact)) !== lease.inputHash || stableJson(result.rows[0].artifact) !== stableJson(lease.artifact) || result.rows[0].proposed_route_id !== lease.proposedRouteId) throw new CandidateRejection("durable_artifact_hash_mismatch");
}

export async function finishCandidate(client: PoolClient, lease: CandidateLease, routeId: string | null, result: unknown, reason: string | null): Promise<void> {
  const saved = await client.query(`UPDATE trail_catalog_candidate_jobs SET state=$4,route_id=$5,result=$6::jsonb,rejection_reason=$7,
    lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
    WHERE source_key=$1 AND input_hash=$2 AND state='leased' AND lease_token=$3 AND lease_expires_at>now() RETURNING source_key`,
  [lease.sourceKey, lease.inputHash, lease.token, routeId ? "pending" : "rejected", routeId, JSON.stringify(result), reason]);
  if (saved.rows.length !== 1) throw new CandidateRejection("candidate_lease_lost");
}

export async function existingCatalogRoute(client: Pick<PoolClient, "query">, candidate: ReadyCandidate | { input: ReadyCandidate["input"] }): Promise<string | null> {
  const input = candidate.input;
  const tables = await client.query("SELECT to_regclass('public.trail_catalog_candidate_jobs') IS NOT NULL AS exists");
  const receipt = tables.rows[0]?.exists ? await client.query("SELECT route_id FROM trail_catalog_candidate_jobs WHERE source_key=$1 AND state='pending'", [input.sourceKey]) : { rows: [] };
  // Legacy rows may predate denormalized objective/trailhead pointers.
  const rows = await client.query(`SELECT r.id,r.name,r.provenance FROM routes r
    WHERE r.owner='peaks' AND r.status IN ('active','pending')
      AND (r.trailhead_destination_id=$1 OR EXISTS (SELECT 1 FROM route_destinations rd WHERE rd.route_id=r.id AND rd.ordinal=0 AND rd.destination_id=$1))
      AND (CASE WHEN $2::text IS NULL THEN r.kind='loop' ELSE r.objective_destination_id=$2 OR EXISTS (
        SELECT 1 FROM route_destinations rd WHERE rd.route_id=r.id AND rd.destination_id=$2 AND rd.ordinal>0) END)
      AND ($3::text IS NULL OR r.id<>$3)
    ORDER BY r.id`, [input.trailheadId, input.objectiveId, receipt.rows[0]?.route_id ?? null]);
  if (!rows.rows.length) return null;
  if (input.variant) {
    const expected = input.variant === "mailbox-old" ? 7147738 : 5426108;
    if (input.source.relationId !== expected || !/mailbox/i.test(input.name)) throw new CandidateRejection("invalid_mailbox_variant");
    // The explicit pair exception permits only the other attested Mailbox variant.
    const other = input.variant === "mailbox-old" ? 5426108 : 7147738;
    return rows.rows.find(row => row.provenance?.source_url !== `https://www.openstreetmap.org/relation/${other}`)?.id ?? null;
  }
  return rows.rows[0].id;
}
