import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { computeRouteElevationStats, profileIsUsable, routeProfileHasRealRange } from "../route-elevation-profile";
import { osmRouteHaversineMeters } from "../osm-route-geometry";
import { hasRequiredTerrariumAttribution } from "../lib/terrarium-attribution";
import { CandidateRejection, sha256 } from "./graph";
import type { BuiltCandidate, PilotManifest, ReadyCandidate, SourceSnapshot } from "./types";

export function readHashedJson(path: string, expectedHash: string, baseDir: string): { value: unknown; body: string } {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new CandidateRejection("invalid_snapshot_hash");
  const bytes = readFileSync(resolve(baseDir, path));
  if (bytes.length > 25_000_000) throw new CandidateRejection("snapshot_too_large");
  if (sha256(bytes) !== expectedHash) throw new CandidateRejection("snapshot_hash_mismatch", path);
  return { value: JSON.parse(bytes.toString("utf8")), body: bytes.toString("utf8") };
}
export function loadSourceSnapshots(snapshots: SourceSnapshot[], baseDir: string): { value: unknown; body: string }[] {
  if (!Array.isArray(snapshots) || !snapshots.length || snapshots.length > 20) throw new CandidateRejection("invalid_snapshot_count");
  return snapshots.map(snapshot => {
    const url = new URL(snapshot.url);
    if (url.protocol !== "https:" || !["api.openstreetmap.org", "www.openstreetmap.org"].includes(url.hostname) || url.username || url.password || !/^\/api\/0\.6\/(relation|way|node)\/\d+(\/full)?\.json$/.test(url.pathname)) throw new CandidateRejection("unapproved_snapshot_url");
    const time = Date.parse(snapshot.retrievedAt);
    if (!Number.isFinite(time) || time > Date.now() + 300_000) throw new CandidateRejection("invalid_source_retrieval_time");
    return readHashedJson(snapshot.path, snapshot.sha256, baseDir);
  });
}
export function loadManifest(path: string): { manifest: PilotManifest; baseDir: string } {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as PilotManifest;
  if (manifest.version !== 1 || !/^[a-z0-9][a-z0-9:_-]{0,119}$/.test(manifest.batchKey) || !Array.isArray(manifest.candidates) || manifest.candidates.length < 1 || manifest.candidates.length > 500) throw new Error("Invalid pilot manifest; expected version1 and1–500 candidates");
  const keys = new Set<string>();
  for (const input of manifest.candidates) {
    if (!input || typeof input.sourceKey !== "string" || !/^[a-z0-9][a-z0-9:_-]{0,199}$/.test(input.sourceKey) || keys.has(input.sourceKey)) throw new Error("Candidate source keys must be unique and stable");
    if (!["summit", "destination", "loop", "traverse"].includes(input.kind) || typeof input.name !== "string" || !input.name.trim() || !input.source) throw new Error(`Invalid candidate ${input.sourceKey}`);
    keys.add(input.sourceKey);
  }
  return { manifest, baseDir: dirname(resolve(path)) };
}
export function prepareElevation(candidate: BuiltCandidate, baseDir: string): ReadyCandidate {
  if (!candidate.input.elevation) throw new CandidateRejection("elevation_missing");
  const raw = readHashedJson(candidate.input.elevation.path, candidate.input.elevation.sha256, baseDir).value as Pick<ReadyCandidate, "elevationLineage"> & { points: { lat: number; lng: number; ele: number }[]; lineage: ReadyCandidate["elevationLineage"] };
  const lineage = raw.lineage;
  if (lineage?.source !== "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)" || lineage.sourceUrl !== "https://registry.opendata.aws/terrain-tiles/" || lineage.licenseUrl !== "https://github.com/tilezen/joerd/blob/master/docs/attribution.md" || lineage.profile !== "terrain" || !hasRequiredTerrariumAttribution(lineage.attribution) || !Number.isFinite(Date.parse(lineage.retrievedAt))) throw new CandidateRejection("invalid_elevation_lineage");
  if (!Array.isArray(raw.points) || raw.points.length !== candidate.points.length || raw.points.some((p, i) => p.lat !== candidate.points[i].lat || p.lng !== candidate.points[i].lng || !Number.isFinite(p.ele) || Math.abs(p.ele) > 12000)) throw new CandidateRejection("elevation_source_vertex_mismatch");
  const elevations = raw.points.map(p => p.ele);
  if (!profileIsUsable(elevations) || !routeProfileHasRealRange(elevations)) throw new CandidateRejection("invalid_elevation_profile");
  if (candidate.shape === "loop" && raw.points[0].ele !== raw.points[raw.points.length - 1].ele) throw new CandidateRejection("loop_endpoint_elevation_mismatch");
  let distance = 0;
  const elevatedPoints = raw.points.map((point, i) => { if (i) distance += osmRouteHaversineMeters(raw.points[i - 1], point); return { ...point, dist: distance }; });
  const stats = computeRouteElevationStats(elevations);
  if (!candidate.attestation.startsWith("osm-relation:") && stats.gain > 2000) throw new CandidateRejection("objective_above_2000m_gain");
  for (const attested of candidate.input.attestedStats ?? []) {
    const statsUrl = new URL(attested.sourceUrl);
    if (statsUrl.protocol !== "https:" || !["fs.usda.gov", "nps.gov", "usgs.gov"].some(host => statsUrl.hostname === host || statsUrl.hostname.endsWith(`.${host}`))) throw new CandidateRejection("attested_stats_source_not_allowed", attested.sourceUrl);
    const comparisonDistance = attested.distanceBasis === "round_trip" && candidate.shape === "out_and_back" ? distance * 2 : distance;
    if (attested.gainM !== undefined && (!attested.gainBasis || attested.gainBasis === "unspecified")) throw new CandidateRejection("attested_gain_basis_unspecified", attested.sourceUrl);
    const comparisonGain = attested.gainBasis === "net_change" ? elevations[elevations.length - 1] - elevations[0] : attested.gainBasis === "full_trip" && candidate.shape === "out_and_back" ? stats.gain + stats.loss : stats.gain;
    if (attested.distanceM !== undefined && (!(attested.distanceM > 0) || Math.abs(comparisonDistance - attested.distanceM) / attested.distanceM > 0.15)) throw new CandidateRejection("attested_distance_mismatch", attested.sourceUrl);
    if (attested.gainM !== undefined && (!Number.isFinite(attested.gainM) || Math.abs(comparisonGain - attested.gainM) > Math.abs(attested.gainM) * 0.15)) throw new CandidateRejection("attested_gain_mismatch", attested.sourceUrl);
  }
  const sourceUrl = candidate.input.source.relationId ? `https://www.openstreetmap.org/relation/${candidate.input.source.relationId}` : `https://www.openstreetmap.org/way/${candidate.usedWayIds[0]}`;
  const provenance = { source_kind: "openstreetmap", source_url: sourceUrl, license_name: "Open Data Commons Open Database License (ODbL) 1.0", license_url: "https://opendatacommons.org/licenses/odbl/1-0/", attribution: "© OpenStreetMap contributors", retrieved_at: candidate.input.source.snapshots.map(s => s.retrievedAt).sort()[0], osm_way_ids: candidate.usedWayIds, osm_way_urls: candidate.usedWayIds.map(id => `https://www.openstreetmap.org/way/${id}`), contains_osm_geometry: true, elevation_source: lineage.source, elevation_profile: lineage.profile };
  return { ...candidate, elevatedPoints, elevationLineage: lineage, provenance, gainM: stats.gain, lossM: stats.loss };
}

/** Bind each segment envelope to its actual positive-length source edges. */
export function segmentProvenance(candidate: ReadyCandidate, start: number, end: number): Record<string, unknown> {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end >= candidate.points.length || end <= start) throw new CandidateRejection("invalid_segment_source_interval");
  const ids = [...new Set(candidate.edges.slice(start, end).map(edge => edge.wayId))].sort((a, b) => a - b);
  if (!ids.length) throw new CandidateRejection("empty_segment_source_interval");
  return { ...candidate.provenance, osm_way_ids: ids, osm_way_urls: ids.map(id => `https://www.openstreetmap.org/way/${id}`) };
}
