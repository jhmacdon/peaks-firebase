#!/usr/bin/env node

import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { lookup as dnsLookup } from "node:dns/promises";
import { fileURLToPath } from "node:url";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requirePublicHostname(hostname, label) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "::1" ||
    (normalized.includes(":") &&
      (normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe80:")))
  ) {
    throw new Error(`${label} must use a public host`);
  }
  const ipv4 = normalized.split(".").map(Number);
  if (
    ipv4.length === 4 &&
    ipv4.every(
      (part) => Number.isInteger(part) && part >= 0 && part <= 255
    ) &&
    (ipv4[0] === 10 ||
      ipv4[0] === 127 ||
      (ipv4[0] === 169 && ipv4[1] === 254) ||
      (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
      (ipv4[0] === 192 && ipv4[1] === 168))
  ) {
    throw new Error(`${label} must use a public host`);
  }
}

export function isPublicAddress(address) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 4) {
    const parts = normalized.split(".").map(Number);
    return !(
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) ||
      (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19) ||
      (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
      (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
      parts[0] >= 224
    );
  }
  if (family === 6) {
    const bytes = ipv6Bytes(normalized);
    if (!bytes) return false;
    const mapped =
      bytes.slice(0, 10).every((byte) => byte === 0) &&
      bytes[10] === 0xff &&
      bytes[11] === 0xff;
    if (mapped) {
      return isPublicAddress(bytes.slice(12).join("."));
    }
    const globalUnicast = (bytes[0] & 0xe0) === 0x20;
    const special2001 =
      bytes[0] === 0x20 &&
      bytes[1] === 0x01 &&
      (bytes[2] & 0xfe) === 0;
    const documentation =
      bytes[0] === 0x20 &&
      bytes[1] === 0x01 &&
      bytes[2] === 0x0d &&
      bytes[3] === 0xb8;
    const sixToFour = bytes[0] === 0x20 && bytes[1] === 0x02;
    const documentation3fff =
      bytes[0] === 0x3f &&
      bytes[1] === 0xff &&
      bytes[2] < 0x10;
    return (
      globalUnicast &&
      !special2001 &&
      !documentation &&
      !sixToFour &&
      !documentation3fff
    );
  }
  return false;
}

function ipv6Bytes(address) {
  let value = address.split("%", 1)[0];
  const dotted = value.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const parts = dotted[1].split(".").map(Number);
    if (
      parts.length !== 4 ||
      parts.some(
        (part) => !Number.isInteger(part) || part < 0 || part > 255
      )
    ) {
      return null;
    }
    value =
      value.slice(0, -dotted[1].length) +
      `${((parts[0] << 8) | parts[1]).toString(16)}:` +
      `${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  if ((value.match(/::/g) ?? []).length > 1) return null;
  const [leftText, rightText = ""] = value.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (
    (value.includes("::") ? missing < 1 : missing !== 0) ||
    [...left, ...right].some(
      (group) => !/^[\da-f]{1,4}$/i.test(group)
    )
  ) {
    return null;
  }
  const groups = [
    ...left,
    ...Array(value.includes("::") ? missing : 0).fill("0"),
    ...right,
  ].map((group) => Number.parseInt(group, 16));
  if (groups.length !== 8) return null;
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

function httpsUrl(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  if (
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  ) {
    throw new Error(`${label} must not use credentials or a custom port`);
  }
  requirePublicHostname(parsed.hostname, label);
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

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, number) =>
      String.fromCodePoint(Number.parseInt(number, 10))
    )
    .replace(/&#x([\da-f]+);/gi, (_, number) =>
      String.fromCodePoint(Number.parseInt(number, 16))
    )
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/gi,
      (_, entity) =>
        ({
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          nbsp: " ",
        })[entity.toLowerCase()]
    );
}

function compactText(value, limit) {
  return decodeHtml(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function tagAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[3]).trim();
  }
  return attributes;
}

function pageEvidenceFromHtml(html) {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  let description = "";
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = tagAttributes(tag[0]);
    const key = (attributes.name ?? attributes.property ?? "").toLowerCase();
    if (key === "description" || key === "og:description") {
      description = compactText(attributes.content ?? "", 600);
      if (description) break;
    }
  }
  return {
    title: compactText(titleMatch?.[1] ?? "", 240),
    description,
    text_excerpt: compactText(html, 1600),
  };
}

function evidenceTargets(packet) {
  const targets = new Map();
  const addTarget = (url, role, type) => {
    const target = targets.get(url) ?? { url, roles: [], source_types: [] };
    if (!target.roles.includes(role)) target.roles.push(role);
    if (type && !target.source_types.includes(type)) {
      target.source_types.push(type);
    }
    targets.set(url, target);
  };
  for (const source of packet.candidate.identity_sources) {
    addTarget(source.url, "identity", source.type);
  }
  if (packet.candidate.access?.source_url) {
    addTarget(packet.candidate.access.source_url, "access", "access");
  }
  return [...targets.values()];
}

async function resolvePublicAddresses(hostname) {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error(`public page host did not resolve: ${hostname}`);
  }
  for (const result of addresses) {
    if (!isPublicAddress(result.address)) {
      throw new Error(`public page host resolved to a private address: ${hostname}`);
    }
  }
  return addresses;
}

function requestPinnedHttps(
  url,
  address,
  family,
  timeoutMs,
  signal,
  byteLimit = 262_144
) {
  return new Promise((resolveRequest, rejectRequest) => {
    const parsed = new URL(url);
    const request = httpsRequest(
      parsed,
      {
        servername: parsed.hostname,
        signal,
        lookup: (_hostname, options, callback) => {
          if (options?.all) {
            callback(null, [{ address, family }]);
          } else {
            callback(null, address, family);
          }
        },
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
          host: parsed.host,
          "user-agent": "PeaksRouteReviewer/1.0 (+https://peak.app)",
        },
      },
      (response) => {
        const chunks = [];
        let bytesRead = 0;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolveRequest({
            status: response.statusCode ?? 0,
            content_type: String(response.headers["content-type"] ?? ""),
            location:
              typeof response.headers.location === "string"
                ? response.headers.location
                : null,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        };
        response.on("data", (value) => {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          const remaining = byteLimit - bytesRead;
          if (remaining > 0) {
            chunks.push(chunk.subarray(0, remaining));
            bytesRead += Math.min(chunk.byteLength, remaining);
          }
          if (chunk.byteLength > remaining) {
            finish();
            response.destroy();
          }
        });
        response.on("end", finish);
        response.on("error", (error) => {
          if (!settled) rejectRequest(error);
        });
      }
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("public page request timed out"));
    });
    request.on("error", rejectRequest);
    request.end();
  });
}

async function withinDeadline(promise, deadline, onTimeout) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    onTimeout?.();
    throw new Error("public page request timed out");
  }
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => {
            onTimeout?.();
            reject(new Error("public page request timed out"));
          },
          remaining
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPublicPage(
  startUrl,
  {
    resolveHost = resolvePublicAddresses,
    requestHop = requestPinnedHttps,
    redirectLimit = 3,
    timeoutMs = 12_000,
  } = {}
) {
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  const abortForTimeout = () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error("public page request timed out"));
    }
  };
  let current = httpsUrl(startUrl, "public page").href;
  const originalPublisher = publisherKey(new URL(current).hostname);
  for (let redirects = 0; ; redirects += 1) {
    const parsed = httpsUrl(current, "public page");
    const addresses = await withinDeadline(
      resolveHost(parsed.hostname),
      deadline,
      abortForTimeout
    );
    if (
      !Array.isArray(addresses) ||
      addresses.length === 0 ||
      addresses.some((result) => !isPublicAddress(result.address))
    ) {
      throw new Error(`public page host resolved to a private address: ${parsed.hostname}`);
    }
    const selected = addresses[0];
    const requestTimeout = deadline - Date.now();
    if (requestTimeout <= 0) {
      abortForTimeout();
      throw new Error("public page request timed out");
    }
    const response = await withinDeadline(
      requestHop(
        parsed.href,
        selected.address,
        selected.family,
        requestTimeout,
        controller.signal
      ),
      deadline,
      abortForTimeout
    );
    if (
      [301, 302, 303, 307, 308].includes(response.status) &&
      response.location
    ) {
      if (redirects >= redirectLimit) {
        throw new Error("public page exceeded the redirect limit");
      }
      const next = httpsUrl(
        new URL(response.location, parsed).href,
        "public page redirect"
      );
      if (publisherKey(next.hostname) !== originalPublisher) {
        throw new Error("public page redirected to another publisher");
      }
      current = next.href;
      continue;
    }
    return response;
  }
}

function publisherKey(hostname) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

async function fetchEvidence(target, transport) {
  try {
    const response = await fetchPublicPage(target.url, transport);
    if (response.status < 200 || response.status >= 300) {
      return {
        ...target,
        ok: false,
        http_status: response.status,
        error: `HTTP ${response.status}`,
      };
    }
    if (
      response.content_type &&
      !/text\/html|application\/xhtml\+xml|text\/plain/i.test(
        response.content_type
      )
    ) {
      return {
        ...target,
        ok: false,
        http_status: response.status,
        error: `unsupported content type: ${response.content_type}`,
      };
    }
    const page = pageEvidenceFromHtml(response.body);
    return {
      ...target,
      ok: Boolean(page.title || page.description || page.text_excerpt),
      http_status: response.status,
      ...page,
      error:
        page.title || page.description || page.text_excerpt
          ? null
          : "page contained no reviewable text",
    };
  } catch (error) {
    return {
      ...target,
      ok: false,
      http_status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function addReviewWebEvidence(
  packet,
  transport
) {
  const webEvidence = await Promise.all(
    evidenceTargets(packet).map((target) => fetchEvidence(target, transport))
  );
  return { ...packet, web_evidence: webEvidence };
}

function sourceCheckKind(candidate) {
  const sourceKind = candidate?.geometry?.source_kind;
  if (sourceKind === "openstreetmap") return "osm";
  if (sourceKind === "usgs-national-map") return "usgs";
  throw new Error("candidate geometry must identify openstreetmap or usgs");
}

function sourceCheckMeasurements(sourceCheck) {
  const metrics = Array.isArray(sourceCheck.results)
    ? sourceCheck.results[0]?.metrics
    : null;
  if (!isObject(metrics)) return {};
  const measurements = {};
  for (const key of [
    "start_connector_m",
    "end_connector_m",
    "core_max_offset_m",
    "core_p95_offset_m",
    "core_coverage_pct",
  ]) {
    if (typeof metrics[key] === "number" && Number.isFinite(metrics[key])) {
      measurements[key] = metrics[key];
    }
  }
  return measurements;
}

function reviewResultTemplate(candidate, sourceCheck, routeId) {
  return {
    verdict: null,
    reviewed_at: new Date().toISOString(),
    reviewer: "peaks_route_reviewer",
    route_id: routeId,
    source_check: sourceCheckKind(candidate),
    gates: {
      route_identity: null,
      geometry_rights: null,
      access: null,
      map_review: null,
      source_geometry: null,
      pending_route: null,
      endpoints: null,
      provenance: null,
    },
    measurements: sourceCheckMeasurements(sourceCheck),
    errors: [],
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
    review_contract: {
      instruction:
        "Return only one JSON object copied from review_result_template. " +
        "Replace verdict and every null gate, keep every key and flat boolean gate name unchanged, and add no keys.",
      pass_rule:
        "PASS requires every listed gate true. Otherwise return FAIL and list each exact defect in errors.",
      evidence_rule:
        "web_evidence ok or HTTP 200 proves only that a page was fetched. " +
        "The page title, description, or excerpt must support the candidate fact used by each gate.",
    },
    review_result_template: reviewResultTemplate(
      candidate,
      sourceCheck,
      routeId
    ),
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packet = await addReviewWebEvidence(
    buildRouteReviewPacket({
      candidate: readJson(args["candidate-result"], "candidate result"),
      sourceCheck: readJson(args["source-check"], "source check"),
      destinationId: args["destination-id"],
      destinationName: args["destination-name"],
      trailheadId: args["trailhead-id"],
      trailheadName: args["trailhead-name"],
      routeId: args["route-id"],
    })
  );
  writeAtomically(args.output, packet);
  console.log(
    JSON.stringify({
      output: args.output,
      identity_source_count: packet.candidate.identity_sources.length,
      access_source_count: packet.candidate.access?.source_url ? 1 : 0,
      known_identity_conflict_count:
        packet.candidate.identity_conflicts.length,
      web_evidence_ok_count: packet.web_evidence.filter(
        (evidence) => evidence.ok
      ).length,
      web_evidence_count: packet.web_evidence.length,
    })
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
