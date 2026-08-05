#!/usr/bin/env node

import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function httpsUrl(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  return parsed;
}

function sourceRank(type) {
  const normalized =
    typeof type === "string"
      ? type.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_")
      : "";
  const official = new Set([
    "official",
    "land_manager",
    "trail_authority",
    "park_service",
    "forest_service",
    "national_park",
    "state_park",
    "nps",
    "usfs",
    "blm",
  ]);
  const routeGuides = new Set([
    "route_guide",
    "trail_guide",
    "mountaineers",
    "wta",
    "14ers_org",
  ]);
  const communityGuides = new Set(["peakbagger", "summitpost", "alltrails"]);
  if (official.has(normalized)) return 0;
  if (routeGuides.has(normalized)) return 1;
  if (communityGuides.has(normalized)) return 2;
  return 3;
}

function candidateSources(candidate) {
  if (!Array.isArray(candidate.identity_sources)) {
    throw new Error("candidate.identity_sources must be an array");
  }
  const sources = candidate.identity_sources.map((source, index) => {
    if (!isObject(source)) {
      throw new Error(`candidate.identity_sources[${index}] must be an object`);
    }
    const parsed = httpsUrl(
      source.url,
      `candidate.identity_sources[${index}].url`
    );
    return {
      type: typeof source.type === "string" ? source.type : "other",
      url: parsed.href,
      hostname: parsed.hostname,
      index,
    };
  });
  if (sources.length === 0) {
    throw new Error("candidate.identity_sources must not be empty");
  }
  return sources;
}

function candidateConflicts(candidate, sourceUrls) {
  if (candidate.identity_conflicts === undefined) return [];
  if (!Array.isArray(candidate.identity_conflicts)) {
    throw new Error("candidate.identity_conflicts must be an array");
  }
  const conflicts = candidate.identity_conflicts.map((conflict, index) => {
    if (!isObject(conflict)) {
      throw new Error(`candidate.identity_conflicts[${index}] must be an object`);
    }
    const url = httpsUrl(
      conflict.url,
      `candidate.identity_conflicts[${index}].url`
    ).href;
    if (!sourceUrls.has(url)) {
      throw new Error("each identity conflict URL must name an identity source");
    }
    if (
      typeof conflict.note !== "string" ||
      conflict.note.trim().length === 0
    ) {
      throw new Error("each identity conflict requires a compact note");
    }
    return { url, note: conflict.note.trim() };
  });
  if (
    new Set(
      conflicts.map((conflict) => new URL(conflict.url).hostname)
    ).size > 2
  ) {
    throw new Error(
      "more than two conflicting identity publishers needs human review"
    );
  }
  return conflicts;
}

function selectIdentitySources(sources, conflicts) {
  const selected = [];
  const conflictUrls = new Set(conflicts.map((conflict) => conflict.url));
  for (const source of sources) {
    if (
      conflictUrls.has(source.url) &&
      !selected.some((kept) => kept.hostname === source.hostname)
    ) {
      selected.push(source);
    }
  }
  const ranked = sources
    .filter((source) => !conflictUrls.has(source.url))
    .sort(
      (left, right) =>
        sourceRank(left.type) - sourceRank(right.type) ||
        left.index - right.index
    );
  while (selected.length < 2 && ranked.length > 0) {
    const differentPublisher = ranked.findIndex(
      (source) =>
        selected.length === 0 ||
        !selected.some((kept) => kept.hostname === source.hostname)
    );
    selected.push(
      ranked.splice(differentPublisher >= 0 ? differentPublisher : 0, 1)[0]
    );
  }
  return selected.slice(0, 2).map(({ type, url }) => ({ type, url }));
}

function filteredConflicts(conflicts, selectedSources) {
  return selectedSources.flatMap((source) => {
    const hostname = new URL(source.url).hostname;
    const publisherConflicts = conflicts.filter(
      (conflict) => new URL(conflict.url).hostname === hostname
    );
    if (publisherConflicts.length === 0) return [];
    return [
      {
        url: source.url,
        note: publisherConflicts
          .map((conflict) => conflict.note)
          .filter((note, index, notes) => notes.indexOf(note) === index)
          .join(" "),
      },
    ];
  });
}

function filteredGeometry(candidate) {
  if (!isObject(candidate.geometry)) {
    throw new Error("candidate.geometry must be an object");
  }
  return {
    source_kind: candidate.geometry.source_kind,
    source_url: httpsUrl(
      candidate.geometry.source_url,
      "candidate.geometry.source_url"
    ).href,
    license: candidate.geometry.license,
  };
}

function filteredAccess(candidate) {
  if (!isObject(candidate.access)) return null;
  const access = {
    status:
      typeof candidate.access.status === "string"
        ? candidate.access.status
        : "unknown",
  };
  if (candidate.access.source_url !== undefined) {
    access.source_url = httpsUrl(
      candidate.access.source_url,
      "candidate.access.source_url"
    ).href;
  }
  return access;
}

function filteredComparison(candidate) {
  if (!isObject(candidate.comparison)) return null;
  const comparison = {
    private_reference_used: candidate.comparison.private_reference_used === true,
  };
  if (
    typeof candidate.comparison.max_offset_m === "number" &&
    Number.isFinite(candidate.comparison.max_offset_m)
  ) {
    comparison.max_offset_m = candidate.comparison.max_offset_m;
  }
  return comparison;
}

function filteredMapReview(candidate) {
  if (!isObject(candidate.map_review)) {
    throw new Error("candidate.map_review must be an object");
  }
  return {
    passed: candidate.map_review.passed === true,
    notes:
      typeof candidate.map_review.notes === "string"
        ? candidate.map_review.notes
        : "",
  };
}

export function buildRouteReviewPacket({
  candidate,
  sourceCheck,
  destinationId,
  destinationName,
  trailheadId,
  trailheadName,
  routeId,
}) {
  if (!isObject(candidate) || !isObject(sourceCheck)) {
    throw new Error("candidate and source check must be JSON objects");
  }
  const sources = candidateSources(candidate);
  const conflicts = candidateConflicts(
    candidate,
    new Set(sources.map((source) => source.url))
  );
  const identitySources = selectIdentitySources(sources, conflicts);
  return {
    schema_version: 1,
    destination: { id: destinationId, name: destinationName },
    trailhead: { id: trailheadId, name: trailheadName },
    route_id: routeId,
    candidate: {
      route_name: candidate.route_name,
      route_shape: candidate.route_shape,
      identity_sources: identitySources,
      identity_conflicts: filteredConflicts(conflicts, identitySources),
      geometry: filteredGeometry(candidate),
      access: filteredAccess(candidate),
      comparison: filteredComparison(candidate),
      map_review: filteredMapReview(candidate),
    },
    source_check: sourceCheck,
  };
}

function parseArgs(argv) {
  const values = {};
  const allowed = new Set([
    "candidate-result",
    "source-check",
    "destination-id",
    "destination-name",
    "trailhead-id",
    "trailhead-name",
    "route-id",
    "output",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error("every review-packet flag requires one value");
    }
    const key = flag.slice(2);
    if (!allowed.has(key) || values[key] !== undefined) {
      throw new Error(`unsupported or repeated flag: ${flag}`);
    }
    values[key] = value;
  }
  for (const key of allowed) {
    if (!values[key]) throw new Error(`missing --${key}`);
  }
  return values;
}

function readJson(path, label) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (!isObject(value)) throw new Error(`${label} must contain one JSON object`);
  return value;
}

function writeAtomically(output, packet) {
  mkdirSync(dirname(output), { recursive: true });
  try {
    const existing = lstatSync(output);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error("review packet output must be a regular file");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = `${output}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(packet, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporary, output);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {}
    throw error;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packet = buildRouteReviewPacket({
    candidate: readJson(args["candidate-result"], "candidate result"),
    sourceCheck: readJson(args["source-check"], "source check"),
    destinationId: args["destination-id"],
    destinationName: args["destination-name"],
    trailheadId: args["trailhead-id"],
    trailheadName: args["trailhead-name"],
    routeId: args["route-id"],
  });
  writeAtomically(args.output, packet);
  console.log(
    JSON.stringify({
      output: args.output,
      identity_source_count: packet.candidate.identity_sources.length,
      access_source_count: packet.candidate.access?.source_url ? 1 : 0,
      known_identity_conflict_count:
        packet.candidate.identity_conflicts.length,
    })
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
