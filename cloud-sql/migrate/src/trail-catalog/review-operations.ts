import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { verifyStandardRoute, DEFAULT_PEAKS_PUBLIC_WEB_URL } from "../standard-route-verification";
import { assembleSourceCheck, buildFilteredPacket, digest, object, requireHash, validateHumanResult, validateSnapshot, type CandidateSnapshot, type Json } from "./review";
import { sha256 } from "./graph";

export type Queryable = { query(text: string, values?: any[]): Promise<{ rows: any[] }> };
export type Checker = (snapshot: CandidateSnapshot) => Promise<Json>;
export type EvidenceFetcher = (snapshot: CandidateSnapshot) => Promise<Json[]>;
export type Previewer = (snapshot: CandidateSnapshot) => Promise<Json>;
const exec = promisify(execFile);
export async function mutate(client: Queryable, sql: string, values: any[], label: string): Promise<{ rows: any[] }> {
  try { return await client.query(sql, values); }
  catch (error: any) {
    const knownAbort = typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) && !error.code.startsWith("08") && !["57P01", "57P02", "57P03"].includes(error.code);
    throw Object.assign(new Error(`${label}: ${knownAbort ? "database rejected the action" : "outcome unconfirmed; inspect its durable receipt"}`), { outcomeUnconfirmed: !knownAbort, cause: error });
  }
}
export async function renderReviewMap(snapshot: CandidateSnapshot): Promise<Json> {
  const root = resolve(__dirname, "../../../.."), temporary = await mkdtemp("/private/tmp/peaks-trail-review-map-");
  const geometry = object(snapshot.route.geometry, "live map geometry"), renderer = resolve(root, "cloud-sql/migrate/src/render-osm-route-candidate.ts");
  try {
    const input = resolve(temporary, "route.geojson"), output = resolve(temporary, "map.png");
    await writeFile(input, JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", geometry, properties: {} }] }), { flag: "wx", mode: 0o600 });
    await exec(process.execPath, ["--import", pathToFileURL(resolve(root, "cloud-sql/migrate/node_modules/tsx/dist/loader.mjs")).href, renderer, "--geojson", input, "--output", output], { timeout: 120_000, maxBuffer: 10_000, cwd: root, env: { PATH: "/usr/bin:/bin", TMPDIR: "/private/tmp", PEAKS_OSM_TILE_CACHE: resolve(temporary, "tiles"), NODE_ENV: "production" } });
    const image = await readFile(output); if (image.length > 2_000_000) throw new Error("review map exceeds 2 MB");
    return { status: "rendered", checkedAt: new Date().toISOString(), geometryHash: digest(geometry), rendererHash: sha256(await readFile(renderer)), imageHash: sha256(image), imageDataUrl: `data:image/png;base64,${image.toString("base64")}`, source: "https://tile.openstreetmap.org/", attribution: "© OpenStreetMap contributors · ODbL", purpose: "Independent visual inspection; no factory verdict" };
  } catch (error) { return { status: "missing", checkedAt: new Date().toISOString(), reason: `Visual map unavailable: ${error instanceof Error ? error.message : String(error)}; map_review must fail` }; }
  finally { await rm(temporary, { recursive: true, force: true }); }
}
export function checkerEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const selected: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", TMPDIR: "/private/tmp", NODE_ENV: "production" };
  for (const key of ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASS"]) {
    if (!environment[key]) throw new Error(`source checker requires explicit ${key}; no credential or target fallback`);
    selected[key] = environment[key];
  }
  return selected;
}

export async function snapshotCandidate(client: Queryable, sourceKey: string): Promise<CandidateSnapshot> {
  const row = (await client.query("SELECT snapshot_trail_catalog_candidate($1) AS snapshot", [sourceKey])).rows[0];
  return validateSnapshot(row?.snapshot, sourceKey);
}
export async function runCurrentSourceChecker(snapshot: CandidateSnapshot): Promise<Json> {
  if (process.env.NODE_ENV === "test") throw new Error("Tests must inject a source checker; subprocesses must never inherit production database defaults");
  const root = resolve(__dirname, "../../../.."), source = snapshot.artifact.candidate.input.source.type;
  if (!["osm", "usfs-nfs-trails"].includes(source)) throw new Error("source is not approved for this pilot");
  const script = resolve(root, `.claude/skills/peaks-osm-route-approval/scripts/check_pending_${source === "osm" ? "osm" : "official"}_routes.mts`);
  let stdout = "";
  try { stdout = (await exec(process.execPath, ["--import", pathToFileURL(resolve(root, "cloud-sql/migrate/node_modules/tsx/dist/loader.mjs")).href, script, "--route-id", snapshot.routeId, "--format", "json"], { timeout: 120_000, maxBuffer: 2_000_000, cwd: root, env: checkerEnvironment(process.env) })).stdout; }
  catch (error: any) {
    // A checker returns code 2 for a complete, failed proof. Other failures remain errors.
    if (error.code !== 2 || !error.stdout) throw new Error("current source checker failed to complete");
    stdout = error.stdout;
  }
  return object(JSON.parse(stdout), "current source proof");
}

/** Use the existing pinned-address HTTPS fetcher; public pages never become instructions. */
export async function fetchReviewEvidence(snapshot: CandidateSnapshot): Promise<Json[]> {
  const root = resolve(__dirname, "../../../..");
  const nativeImport = new Function("url", "return import(url)") as (url: string) => Promise<{ fetchPublicPage(url: string): Promise<Json> }>;
  const { fetchPublicPage } = await nativeImport(pathToFileURL(resolve(root, ".agents/skills/peaks-route-factory/scripts/build_route_review_packet.mjs")).href);
  const urls = reviewEvidenceUrls(snapshot);
  return Promise.all(urls.map(async url => {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetchPublicPage(url);
      if (response.content_type && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(response.content_type)) return { url, checkedAt, untrustedContent: true, httpStatus: response.status, ok: false, textExcerpt: "", error: `unsupported review text content type: ${response.content_type}; inspect the original source separately` };
      const text = response.body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 6_000);
      return { url, checkedAt, untrustedContent: true, httpStatus: response.status, ok: response.status >= 200 && response.status < 300 && Boolean(text), textExcerpt: text, error: null };
    } catch (error) { return { url, checkedAt, untrustedContent: true, ok: false, textExcerpt: "", error: error instanceof Error ? error.message : String(error) }; }
  }));
}
export function reviewEvidenceUrls(snapshot: CandidateSnapshot): string[] {
  const input = snapshot.artifact.candidate.input, provenance = snapshot.artifact.candidate.provenance;
  const urls = [...new Set([input.identity?.sourceUrl, input.commonDestinationEvidence?.sourceUrl, input.access?.sourceUrl, ...(input.attestedStats?.map(stats => stats.sourceUrl) ?? []), ...(input.terrainReviews?.map(review => review.sourceUrl) ?? []), provenance.license_url, input.source.type === "osm" ? provenance.source_url : null].filter((url): url is string => typeof url === "string" && Boolean(url)))];
  if (urls.length > 12) throw new Error("review evidence exceeds the bounded 12-page limit");
  return urls;
}
export function validatePacketEvidence(snapshot: CandidateSnapshot, packet: Json, now = Date.now()): void {
  const recent = (time: unknown) => typeof time === "string" && Number.isFinite(Date.parse(time)) && Date.parse(time) <= now + 300_000 && Date.parse(time) >= now - 86_400_000;
  if (!recent(packet.sourceCheck?.checkedAt)) throw new Error("draft source proof is stale or future dated");
  const evidence = packet.webEvidence;
  if (!Array.isArray(evidence) || evidence.length > 12 || digest(evidence.map(item => item.url).sort()) !== digest(reviewEvidenceUrls(snapshot).sort()) || evidence.some(item => !recent(item.checkedAt) || item.untrustedContent !== true || typeof item.ok !== "boolean" || typeof item.textExcerpt !== "string" || item.textExcerpt.length > 6_000)) throw new Error("review web evidence is missing, stale, changed, or unbounded");
  const map = object(packet.mapEvidence, "map evidence");
  if (map.status === "rendered") {
    if (!recent(map.checkedAt) || map.geometryHash !== digest(snapshot.route.geometry) || typeof map.imageDataUrl !== "string" || !map.imageDataUrl.startsWith("data:image/png;base64,") || map.imageDataUrl.length > 2_700_000 || sha256(Buffer.from(map.imageDataUrl.slice(22), "base64")) !== map.imageHash) throw new Error("visual map hash, geometry or freshness differs");
  } else if (map.status !== "missing") throw new Error("map evidence has an unknown status");
}

export async function inspectCandidate(client: Queryable, snapshot: CandidateSnapshot, checker: Checker = runCurrentSourceChecker): Promise<Json> {
  const [source, machine] = await Promise.all([checker(snapshot), client.query("SELECT trail_catalog_review_machine_checks($1) AS checks", [snapshot.sourceKey])]);
  return assembleSourceCheck(snapshot, source, object(machine.rows[0]?.checks, "live machine checks"));
}

// Fetch timestamps are evidence, but never let timestamp churn invalidate an otherwise
// identical dry plan. Every apply still reruns the live source and machine checks.
export function proofIdentity(check: Json): Json {
  const strip = (value: any): any => Array.isArray(value) ? value.map(strip) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => !["checked_at", "checkedAt"].includes(key)).map(([key, item]) => [key, strip(item)])) : value;
  return strip(check);
}
export function packetPlanHash(packet: Json): string { return digest(packet); }
export async function planPacket(client: Queryable, sourceKey: string, checker: Checker = runCurrentSourceChecker, evidence: EvidenceFetcher = fetchReviewEvidence, preview: Previewer = renderReviewMap): Promise<Json> {
  const snapshot = await snapshotCandidate(client, sourceKey);
  const [proof, web, map] = await Promise.all([inspectCandidate(client, snapshot, checker), evidence(snapshot), preview(snapshot)]);
  return buildFilteredPacket(snapshot, proof, web, map);
}

export async function bindPacket(client: Queryable, sourceKey: string, draft: Json, expectedHash: string, checker: Checker = runCurrentSourceChecker, preview: Previewer = renderReviewMap): Promise<Json> {
  if (packetPlanHash(draft) !== expectedHash || draft.sourceKey !== sourceKey || draft.attestation) throw new Error("packet differs from the reviewed dry plan");
  const snapshot = await snapshotCandidate(client, sourceKey);
  if (snapshot.inputHash !== draft.inputHash || snapshot.routeId !== draft.routeId) throw new Error("candidate changed after dry review");
  validatePacketEvidence(snapshot, draft);
  if (digest(draft) !== digest(buildFilteredPacket(snapshot, object(draft.sourceCheck, "dry source check"), Array.isArray(draft.webEvidence) ? draft.webEvidence : [], draft.mapEvidence))) throw new Error("dry packet contains changed or unsupported evidence fields");
  const fresh = await inspectCandidate(client, snapshot, checker);
  if (digest(proofIdentity(fresh)) !== digest(proofIdentity(object(draft.sourceCheck, "dry source check")))) throw new Error("source or machine evidence changed; run packet dry again");
  if (draft.mapEvidence.status === "rendered") {
    const currentMap = await preview(snapshot);
    if (currentMap.status !== "rendered" || currentMap.imageHash !== draft.mapEvidence.imageHash || currentMap.geometryHash !== draft.mapEvidence.geometryHash || currentMap.rendererHash !== draft.mapEvidence.rendererHash) throw new Error("visual map changed; run packet dry again");
  }
  const claim = (await mutate(client, "SELECT claim_trail_catalog_review($1,$2) AS lease", [sourceKey, snapshot.inputHash], "claim review")).rows[0]?.lease;
  if (!claim?.leaseToken) throw new Error("review lease unavailable");
  try {
    // Rebuild only approved filtered fields. Do not let a hand-edited draft add a verdict.
    const packet = buildFilteredPacket(snapshot, fresh, Array.isArray(draft.webEvidence) ? draft.webEvidence : [], draft.mapEvidence);
    const bound = (await mutate(client, "SELECT bind_trail_catalog_review_packet($1,$2,$3::jsonb,$4::jsonb) AS packet", [sourceKey, claim.leaseToken, JSON.stringify(packet), JSON.stringify(fresh)], "bind review packet")).rows[0]?.packet;
    if (!bound?.attestation?.leaseToken || bound.attestation.leaseToken !== claim.leaseToken) throw new Error("database did not return a bound review packet");
    return bound;
  } catch (error: any) {
    if (!error.outcomeUnconfirmed) await mutate(client, "SELECT release_trail_catalog_review($1,$2)", [sourceKey, claim.leaseToken], "release review");
    throw error;
  }
}

export async function planReview(client: Queryable, sourceKey: string, packet: Json, result: Json, checker: Checker = runCurrentSourceChecker): Promise<Json> {
  validateHumanResult(packet, result);
  const snapshot = await snapshotCandidate(client, sourceKey), binding = object(packet.attestation, "packet attestation");
  if (binding.sourceKey !== sourceKey || binding.inputHash !== snapshot.inputHash || binding.routeId !== snapshot.routeId) throw new Error("review is not bound to this durable route");
  const receipt = object(snapshot.reviewReceipt, "durable reviewer lease");
  validatePacketEvidence(snapshot, packet);
  if (receipt.state !== "reviewing" || receipt.lease_token !== binding.leaseToken || Date.parse(receipt.lease_expires_at) <= Date.now() || digest(receipt.packet) !== digest(packet) || digest(receipt.source_check) !== digest(packet.sourceCheck)) throw new Error("bound review packet or fresh lease differs from the durable job");
  const fresh = await inspectCandidate(client, snapshot, checker);
  if (result.verdict === "PASS" && !fresh.passed) throw new Error(`current machine checks failed: ${fresh.errors.join("; ")}`);
  if (digest(proofIdentity(fresh)) !== digest(proofIdentity(object(packet.sourceCheck, "packet source check")))) throw new Error("source proof changed since packet binding; renew the review");
  const sourceCheck = packet.sourceCheck;
  return { sourceKey, routeId: snapshot.routeId, packet, result, sourceCheck, reviewHash: digest({ sourceKey, inputHash: snapshot.inputHash, packet, result, sourceCheck }) };
}
export async function finishReview(client: Queryable, plan: Json, expectedHash: string): Promise<Json> {
  if (plan.reviewHash !== expectedHash) throw new Error("review hash differs from the dry review plan");
  return object((await mutate(client, "SELECT finish_trail_catalog_review($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) AS receipt", [plan.sourceKey, plan.packet.attestation.leaseToken, JSON.stringify(plan.packet), JSON.stringify(plan.result), JSON.stringify(plan.sourceCheck)], "finish review")).rows[0]?.receipt, "review receipt");
}

export async function verifyPublishedCandidate(client: Queryable, snapshot: CandidateSnapshot, publicBaseUrl = DEFAULT_PEAKS_PUBLIC_WEB_URL): Promise<Json> {
  if (process.env.NODE_ENV !== "test" && publicBaseUrl !== DEFAULT_PEAKS_PUBLIC_WEB_URL) throw new Error("production verification requires the canonical public Peaks URL");
  const candidate = snapshot.artifact.candidate;
  const snapshotHash = (await client.query("SELECT trail_catalog_verification_snapshot_hash($1) AS hash", [snapshot.sourceKey])).rows[0]?.hash;
  requireHash(snapshotHash, "verification snapshot hash");
  const receiptHash = requireHash(snapshot.reviewReceipt?.receipt_hash ?? snapshot.reviewReceipt?.receiptHash, "review receipt hash");
  // Existing verification preserves all linked summit checks for non-summit kinds.
  const standard = await verifyStandardRoute(client as any, { routeId: snapshot.routeId, destinationId: candidate.objective?.id ?? candidate.trailhead.id, trailheadId: candidate.trailhead.id, publicBaseUrl });
  const searchUrl = new URL("/api/search/all", publicBaseUrl); searchUrl.searchParams.set("q", candidate.input.name); searchUrl.searchParams.set("limit", "50");
  let searchStatus = 0, rank: number | null = null, searchError: string | null = null;
  try {
    const response = await fetch(searchUrl, { signal: AbortSignal.timeout(30_000), redirect: "error" }); searchStatus = response.status;
    if (response.ok) {
      const body = await response.json() as Json;
      if (Array.isArray(body.results)) {
        const index = body.results.findIndex((row: Json) => row.id === snapshot.routeId && (row.type === "route" || row.result_type === "route"));
        if (index >= 0) rank = index + 1;
      }
    } else await response.body?.cancel();
  } catch (error) { searchError = error instanceof Error ? error.message : String(error); }
  const drain = object((await client.query("SELECT trail_catalog_rematch_drain_status() AS drain")).rows[0]?.drain, "rematch drain");
  const gates = { public_http: standard.verdict === "PASS", search: searchStatus === 200 && rank !== null, rematch_drained: drain.drained === true };
  return { routeId: snapshot.routeId, receiptHash, snapshotHash, checkedAt: new Date().toISOString(), passed: Object.values(gates).every(value => value), gates, routeVerification: standard, search: { routeId: snapshot.routeId, url: searchUrl.href, status: searchStatus, rank, error: searchError }, rematch: drain };
}
export async function recordVerification(client: Queryable, sourceKey: string, receiptHash: string, verify: typeof verifyPublishedCandidate = verifyPublishedCandidate, publicBaseUrl?: string): Promise<Json> {
  const lease = (await mutate(client, "SELECT claim_trail_catalog_verification($1,$2) AS lease", [sourceKey, receiptHash], "claim verification")).rows[0]?.lease;
  if (!lease?.leaseToken) throw new Error("verification lease unavailable");
  const snapshot = await snapshotCandidate(client, sourceKey);
  let result: Json;
  try { result = await verify(client, snapshot, publicBaseUrl); }
  catch (error) { result = { routeId: snapshot.routeId, checkedAt: new Date().toISOString(), passed: false, gates: { public_http: false, search: false, rematch_drained: false }, errors: [error instanceof Error ? error.message : String(error)] }; }
  const receipt = (await mutate(client, "SELECT finish_trail_catalog_verification($1,$2,$3,$4::jsonb) AS receipt", [sourceKey, lease.leaseToken, receiptHash, JSON.stringify(result)], "finish verification")).rows[0]?.receipt;
  return { sourceKey, result, receipt };
}
