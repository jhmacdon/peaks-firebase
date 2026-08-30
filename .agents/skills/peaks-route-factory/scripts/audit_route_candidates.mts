#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import officialRouteGeometryImport from "../../../../cloud-sql/migrate/src/official-route-geometry";
import officialTrailSourcesImport from "../../../../cloud-sql/migrate/src/official-trail-sources";
import usgsTrailsSourceImport from "../../../../cloud-sql/migrate/src/usgs-trails-source";

const { parseOfficialFeatureIdsFromSourceUrl } = officialRouteGeometryImport;
const { getPublishableArcgisTrailSource } = officialTrailSourcesImport;
const {
  buildUsgsTrailAttribution,
  parseUsgsTrailsQueryUrl,
  USGS_TRAILS_LICENSE_NAME,
  USGS_TRAILS_LICENSE_URL,
} = usgsTrailsSourceImport;

type Position = [number, number] | [number, number, number];

interface Candidate {
  type?: string;
  peaks_destination_id?: string;
  peaks_trailhead_id?: string;
  peaks_source_kind?: string;
  peaks_source?: string;
  peaks_retrieval_source?: string;
  peaks_license_name?: string;
  peaks_license?: string;
  peaks_attribution?: string;
  peaks_retrieved_at?: string;
  features?: Array<{
    type?: string;
    properties?: Record<string, unknown>;
    geometry?: { type?: string; coordinates?: Position[] };
  }>;
}

function validUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function audit(file: string, candidate: Candidate): string[] {
  const errors: string[] = [];
  const filename = path.basename(file);
  if (/(?:draft|alt|-v\d+)\.geojson$/i.test(filename)) {
    errors.push("draft, alternate, and versioned files are research only");
  }
  const requiredStrings: Array<keyof Candidate> = [
    "peaks_destination_id",
    "peaks_trailhead_id",
    "peaks_source",
    "peaks_retrieval_source",
    "peaks_license_name",
    "peaks_license",
    "peaks_attribution",
    "peaks_retrieved_at",
  ];
  for (const key of requiredStrings) {
    if (typeof candidate[key] !== "string" || candidate[key] === "") {
      errors.push(`${key} is required`);
    }
  }
  if (candidate.peaks_trailhead_id === "draft-trailhead") {
    errors.push("placeholder trailhead IDs are research only");
  }
  if (!validUrl(candidate.peaks_retrieval_source)) {
    errors.push("peaks_retrieval_source must be an HTTPS URL");
  }
  if (!validUrl(candidate.peaks_source)) {
    errors.push("peaks_source must be an HTTPS URL");
  }
  if (!validUrl(candidate.peaks_license)) {
    errors.push("peaks_license must be an HTTPS URL");
  }
  if (
    typeof candidate.peaks_retrieved_at !== "string" ||
    !/^20\d\d-\d\d-\d\d/.test(candidate.peaks_retrieved_at)
  ) {
    errors.push("peaks_retrieved_at must start with an ISO date");
  }
  if (candidate.type !== "FeatureCollection" || candidate.features?.length !== 1) {
    errors.push("candidate must be a one-feature FeatureCollection");
    return errors;
  }
  const feature = candidate.features[0];
  if (feature.type !== "Feature" || feature.geometry?.type !== "LineString") {
    errors.push("feature geometry must be a LineString");
    return errors;
  }
  const coordinates = feature.geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 5) {
    errors.push("route must contain at least five coordinates");
  } else if (coordinates.length > 5000) {
    errors.push("route must contain at most 5,000 coordinates");
  } else {
    for (const [index, coordinate] of coordinates.entries()) {
      if (
        !Array.isArray(coordinate) ||
        coordinate.length < 2 ||
        !Number.isFinite(coordinate[0]) ||
        !Number.isFinite(coordinate[1]) ||
        coordinate[0] < -180 ||
        coordinate[0] > 180 ||
        coordinate[1] < -90 ||
        coordinate[1] > 90
      ) {
        errors.push(`coordinate ${index} is not a valid longitude/latitude`);
        break;
      }
    }
  }
  const properties = feature.properties ?? {};
  const sourceKind = candidate.peaks_source_kind ?? "openstreetmap";
  for (const key of [
    "name",
    "trailhead_name",
    "destination_name",
    "distance_m",
    "trailhead_snap_m",
    "summit_snap_m",
  ]) {
    if (!(key in properties)) errors.push(`feature property ${key} is required`);
  }
  const wayIds = properties.osm_way_ids;
  const wayUrls = properties.osm_way_urls;
  if (sourceKind === "openstreetmap") {
    if (!Array.isArray(wayIds) || wayIds.length === 0) {
      errors.push("OSM candidates require osm_way_ids");
    }
    if (!Array.isArray(wayUrls) || wayUrls.length !== wayIds?.length) {
      errors.push("osm_way_urls must align with osm_way_ids");
    } else if (
      wayUrls.some(
        (url, index) =>
          url !== `https://www.openstreetmap.org/way/${String(wayIds[index])}`
      )
    ) {
      errors.push("every OSM way URL must exactly match its way ID");
    }
    if (!/ODbL/i.test(candidate.peaks_license_name ?? "")) {
      errors.push("OSM candidates must name the ODbL license");
    }
  } else if (sourceKind === "usgs-national-map") {
    try {
      const sourceObjectIds = parseUsgsTrailsQueryUrl(
        candidate.peaks_source ?? ""
      );
      const candidateObjectIds = properties.usgs_object_ids;
      if (
        !Array.isArray(candidateObjectIds) ||
        candidateObjectIds.length !== sourceObjectIds.length ||
        candidateObjectIds.some(
          (value, index) => value !== sourceObjectIds[index]
        )
      ) {
        errors.push("USGS object IDs must match the canonical source URL");
      }
      const originators = properties.usgs_originators;
      if (
        !Array.isArray(originators) ||
        candidate.peaks_attribution !== buildUsgsTrailAttribution(originators)
      ) {
        errors.push("USGS attribution must match its source originators");
      }
    } catch (error) {
      errors.push(
        `USGS source validation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    if (
      candidate.peaks_license_name !== USGS_TRAILS_LICENSE_NAME ||
      candidate.peaks_license !== USGS_TRAILS_LICENSE_URL
    ) {
      errors.push("USGS candidates must use the exact public-domain terms");
    }
    if (Array.isArray(wayIds) && wayIds.length > 0) {
      errors.push("USGS candidates cannot cite OSM way IDs");
    }
  } else {
    try {
      const source = getPublishableArcgisTrailSource(sourceKind);
      if (!source) {
        errors.push(`unsupported peaks_source_kind: ${sourceKind}`);
      } else {
        if (
          candidate.peaks_license_name !== source.license.name ||
          candidate.peaks_license !== source.license.url ||
          candidate.peaks_attribution !== source.license.attribution
        ) {
          errors.push("official license metadata must match the source registry");
        }
        const featureIds = parseOfficialFeatureIdsFromSourceUrl(
          source.service,
          candidate.peaks_source ?? ""
        );
        const rawFeatureIds = properties.official_feature_ids;
        const validFeatureIds =
          Array.isArray(rawFeatureIds) &&
          rawFeatureIds.length > 0 &&
          rawFeatureIds.every(
            (value) => typeof value === "string" && value.trim().length > 0
          );
        const candidateFeatureIds = validFeatureIds
          ? (rawFeatureIds as string[]).map((value) => value.trim()).sort()
          : [];
        if (
          !validFeatureIds ||
          properties.official_source_id !== source.id ||
          candidateFeatureIds.length !== featureIds.length ||
          featureIds.some(
            (featureId, index) => candidateFeatureIds[index] !== featureId
          )
        ) {
          errors.push(
            "official source ID and feature IDs must match the canonical source URL"
          );
        }
        if (Array.isArray(wayIds) && wayIds.length > 0) {
          errors.push("official candidates cannot cite OSM way IDs");
        }
      }
    } catch (error) {
      errors.push(
        `official source validation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return errors;
}

const argv = process.argv.slice(2);
let fileArg: string | null = null;
let directoryArg: string | null = null;
let format: "json" | "summary" = "json";
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === "--file" || arg === "--directory" || arg === "--format") {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    if (arg === "--file") fileArg = value;
    if (arg === "--directory") directoryArg = value;
    if (arg === "--format") {
      if (value !== "json" && value !== "summary") {
        throw new Error("--format must be json or summary");
      }
      format = value;
    }
    index += 1;
  } else if (arg === "--help" || arg === "-h") {
    console.log(
      "Usage: audit_route_candidates.mts " +
        "(--file FILE | --directory DIR) [--format json|summary]"
    );
    process.exit(0);
  } else {
    throw new Error(`Unknown argument: ${arg}`);
  }
}
if ((fileArg && directoryArg) || (!fileArg && !directoryArg)) {
  console.error("Use exactly one of --file FILE or --directory DIRECTORY");
  process.exit(2);
}

const inputs = fileArg
  ? [path.resolve(fileArg)]
  : (await fs.readdir(path.resolve(directoryArg!)))
      .filter((name) => name.endsWith(".geojson"))
      .sort()
      .map((name) => path.join(path.resolve(directoryArg!), name));

const reports = [];
const destinationFiles = new Map<string, string[]>();
for (const file of inputs) {
  try {
    const candidate = JSON.parse(await fs.readFile(file, "utf8")) as Candidate;
    const errors = audit(file, candidate);
    if (candidate.peaks_destination_id) {
      const files = destinationFiles.get(candidate.peaks_destination_id) ?? [];
      files.push(file);
      destinationFiles.set(candidate.peaks_destination_id, files);
    }
    reports.push({
      file,
      verdict: errors.length === 0 ? "PASS" : "FAIL",
      errors,
    });
  } catch (error) {
    reports.push({
      file,
      verdict: "FAIL",
      errors: [error instanceof Error ? error.message : String(error)],
    });
  }
}
for (const [destinationId, files] of destinationFiles) {
  if (files.length < 2) continue;
  for (const report of reports) {
    if (files.includes(report.file)) {
      report.verdict = "FAIL";
      report.errors.push(
        `destination ${destinationId} has ${files.length} top-level candidates`
      );
    }
  }
}
const failed = reports.filter((report) => report.verdict === "FAIL").length;
const summary = {
  files: reports.length,
  passed: reports.length - failed,
  failed,
};
console.log(
  JSON.stringify(
    format === "summary"
      ? {
          ...summary,
          ...(failed > 0
            ? { reports: reports.filter((report) => report.verdict === "FAIL") }
            : {}),
        }
      : { ...summary, reports },
    null,
    2
  )
);
if (failed > 0) process.exitCode = 1;
