#!/usr/bin/env node

import { createHash, randomInt } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import dbImport from "../../../../cloud-sql/migrate/src/db";
import routeConflictHelpers from "../../../../cloud-sql/migrate/src/standard-route-import-conflicts";

const db =
  typeof (dbImport as { query?: unknown }).query === "function"
    ? dbImport
    : (dbImport as unknown as { default: typeof dbImport }).default;
const {
  findConflictingLiveRoute,
  lockAndFindConflictingLiveRoute,
} = routeConflictHelpers;
const requireFromMigrate = createRequire(
  new URL("../../../../cloud-sql/migrate/package.json", import.meta.url)
);
const sharp = requireFromMigrate("sharp");

const OSM_LICENSE_NAME =
  "Open Data Commons Open Database License (ODbL) 1.0";
const OSM_LICENSE_URL =
  "https://opendatacommons.org/licenses/odbl/1-0/";
const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
const USGS_LICENSE_NAME = "Public domain";
const USGS_LICENSE_URL =
  "https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map";
const USGS_3DEP_SAMPLES_URL =
  "https://elevation.nationalmap.gov/arcgis/rest/services/" +
  "3DEPElevation/ImageServer/getSamples";
const OPEN_TOPO_DATA_NED_URL =
  "https://api.opentopodata.org/v1/ned10m";
const TERRAIN_TILE_ZOOM = 14;
const TERRAIN_TILE_SIZE = 256;

type ElevationPoint = { lat: number; lng: number };

type SourceLink = { type: string; id: string };
type RouteShape = "out_and_back" | "loop" | "lollipop";

type TrackPoint = {
  lat: number;
  lng: number;
  ele: number;
  dist: number;
};

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const radiusM = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * radiusM * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function encodeValue(value: number): string {
  let remaining = value < 0 ? ~(value << 1) : value << 1;
  let encoded = "";
  while (remaining >= 0x20) {
    encoded += String.fromCharCode((0x20 | (remaining & 0x1f)) + 63);
    remaining >>= 5;
  }
  return encoded + String.fromCharCode(remaining + 63);
}

function encodePolyline6(points: TrackPoint[]): string {
  let encoded = "";
  let previousLat = 0;
  let previousLng = 0;
  for (const point of points) {
    const lat = Math.round(point.lat * 1e6);
    const lng = Math.round(point.lng * 1e6);
    encoded += encodeValue(lat - previousLat);
    encoded += encodeValue(lng - previousLng);
    previousLat = lat;
    previousLng = lng;
  }
  return encoded;
}

function pointsToLineStringZ(points: TrackPoint[]): string {
  return `LINESTRING Z(${points
    .map((point) => `${point.lng} ${point.lat} ${point.ele}`)
    .join(", ")})`;
}

function generateId(): string {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 20 },
    () => characters[randomInt(characters.length)]
  ).join("");
}

type Args = {
  candidatePath: string;
  destinationId: string;
  trailheadId: string;
  name: string;
  sourceLinks: SourceLink[];
  routeShape: RouteShape;
  elevationProfile: "terrain" | "monotonic_ascent";
  replacePendingRouteIds: string[];
  replaceActiveRouteId: string;
  upgradeActiveRouteId: string;
  resultPath: string;
  apply: boolean;
  acknowledgeOsmOdbl: boolean;
  acknowledgeMapReview: boolean;
};

type Candidate = {
  sourceKind: string;
  sourceUrl: string;
  licenseName: string;
  licenseUrl: string;
  attribution: string;
  retrievedAt: string;
  wayIds: number[];
  wayUrls: string[];
  containsOsmGeometry: boolean;
  coordinates: Array<[number, number]>;
  trailheadSnapM: number;
  summitSnapM: number;
};

type Place = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  elevation: number | null;
  list_names: string[];
  prominence: number | null;
  session_count: number;
};

function smoothElevations(elevations: number[], alpha = 0.3): number[] {
  if (elevations.length <= 2) return [...elevations];
  const forward = new Array<number>(elevations.length);
  forward[0] = elevations[0];
  for (let index = 1; index < elevations.length; index += 1) {
    forward[index] =
      alpha * elevations[index] + (1 - alpha) * forward[index - 1];
  }
  const backward = new Array<number>(elevations.length);
  backward[backward.length - 1] = forward[forward.length - 1];
  for (let index = elevations.length - 2; index >= 0; index -= 1) {
    backward[index] =
      alpha * forward[index] + (1 - alpha) * backward[index + 1];
  }
  backward[0] = elevations[0];
  backward[backward.length - 1] = elevations[elevations.length - 1];
  return backward;
}

function computeElevationStats(elevations: number[]): {
  gain: number;
  loss: number;
  min: number;
  max: number;
} {
  if (elevations.length === 0) {
    return { gain: 0, loss: 0, min: 0, max: 0 };
  }
  const profile = smoothElevations(elevations);
  let gain = 0;
  let loss = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let pending = 0;
  for (let index = 0; index < profile.length; index += 1) {
    const elevation = profile[index];
    min = Math.min(min, elevation);
    max = Math.max(max, elevation);
    if (index === 0) continue;
    const difference = elevation - profile[index - 1];
    if (
      (pending >= 0 && difference >= 0) ||
      (pending <= 0 && difference <= 0)
    ) {
      pending += difference;
    } else {
      if (pending > 4) gain += pending;
      if (pending < -4) loss += Math.abs(pending);
      pending = difference;
    }
  }
  if (pending > 4) gain += pending;
  if (pending < -4) loss += Math.abs(pending);
  return {
    gain: Math.round(gain * 10) / 10,
    loss: Math.round(loss * 10) / 10,
    min: Math.round(min * 10) / 10,
    max: Math.round(max * 10) / 10,
  };
}

function fitMonotonicAscentProfile(elevations: number[]): number[] {
  if (elevations.length < 2) return [...elevations];
  const start = elevations[0];
  const finish = elevations[elevations.length - 1];
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start) {
    throw new Error(
      "monotonic_ascent requires a summit elevation above the trailhead"
    );
  }

  type Block = {
    startIndex: number;
    endIndex: number;
    sum: number;
    count: number;
  };
  const blocks: Block[] = [];
  elevations.forEach((elevation, index) => {
    const clamped = Math.min(finish, Math.max(start, elevation));
    blocks.push({
      startIndex: index,
      endIndex: index,
      sum: clamped,
      count: 1,
    });
    while (blocks.length >= 2) {
      const right = blocks[blocks.length - 1];
      const left = blocks[blocks.length - 2];
      if (left.sum / left.count <= right.sum / right.count) break;
      blocks.splice(blocks.length - 2, 2, {
        startIndex: left.startIndex,
        endIndex: right.endIndex,
        sum: left.sum + right.sum,
        count: left.count + right.count,
      });
    }
  });

  const fitted = new Array<number>(elevations.length);
  for (const block of blocks) {
    const elevation = Math.round((block.sum / block.count) * 10) / 10;
    for (
      let index = block.startIndex;
      index <= block.endIndex;
      index += 1
    ) {
      fitted[index] = elevation;
    }
  }
  fitted[0] = start;
  fitted[fitted.length - 1] = finish;
  return fitted;
}

const HELP = `Usage:
  tsx import_standard_route_from_osm_candidate.mts \\
    --candidate /path/to/candidate.geojson \\
    --destination-id ID \\
    --trailhead-id ID \\
    --name "Peak via Standard Route" \\
    --source-url type=https://direct/route/page \\
    [--route-shape out_and_back|loop|lollipop] \\
    [--elevation-profile terrain|monotonic_ascent] \\
    [--replace-pending-route ID ...] \\
    [--replace-active-route ID] \\
    [--upgrade-active-route ID] \\
    [--result-file /path/to/result.json] \\
    [--apply --acknowledge-geometry-license --acknowledge-map-review]

Dry-run is the default. Apply creates a Peaks-owned pending route and segment.
--replace-active-route permits a reviewed pending replacement to coexist with
one named active route until publication. It never activates a new route.
--upgrade-active-route repairs one existing active Peaks route in place after
independent review. OSM and USGS National Map candidates are supported.
`;

function valuesAfter(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
    } else if (arg === flag && argv[index + 1]) {
      values.push(argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function valueAfter(argv: string[], flag: string): string {
  return valuesAfter(argv, flag)[0] ?? "";
}

function parseSourceLink(value: string): SourceLink {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(
      `Invalid --source-url "${value}"; expected type=https://direct/page`
    );
  }
  const type = value.slice(0, separator).trim();
  const id = value.slice(separator + 1).trim();
  if (!/^[a-z0-9_-]+$/i.test(type)) {
    throw new Error(`Unsupported source type: ${type}`);
  }
  const url = new URL(id);
  if (url.protocol !== "https:") {
    throw new Error(`Source URL must use HTTPS: ${id}`);
  }
  return { type, id: url.toString() };
}

function parseArgs(argv: string[]): Args {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }

  const args: Args = {
    candidatePath: valueAfter(argv, "--candidate"),
    destinationId: valueAfter(argv, "--destination-id"),
    trailheadId: valueAfter(argv, "--trailhead-id"),
    name: valueAfter(argv, "--name"),
    sourceLinks: valuesAfter(argv, "--source-url").map(parseSourceLink),
    routeShape:
      (valueAfter(argv, "--route-shape") || "out_and_back") as RouteShape,
    elevationProfile:
      (valueAfter(argv, "--elevation-profile") || "terrain") as
        Args["elevationProfile"],
    replacePendingRouteIds: valuesAfter(argv, "--replace-pending-route"),
    replaceActiveRouteId: valueAfter(argv, "--replace-active-route"),
    upgradeActiveRouteId: valueAfter(argv, "--upgrade-active-route"),
    resultPath: valueAfter(argv, "--result-file"),
    apply: argv.includes("--apply"),
    acknowledgeOsmOdbl:
      argv.includes("--acknowledge-geometry-license") ||
      argv.includes("--acknowledge-osm-odbl"),
    acknowledgeMapReview: argv.includes("--acknowledge-map-review"),
  };

  if (
    !args.candidatePath ||
    !args.destinationId ||
    !args.trailheadId ||
    !args.name
  ) {
    throw new Error(`Missing required argument.\n\n${HELP}`);
  }
  if (args.sourceLinks.length === 0) {
    throw new Error("At least one direct --source-url is required");
  }
  if (!["out_and_back", "loop", "lollipop"].includes(args.routeShape)) {
    throw new Error(
      "--route-shape must be out_and_back, loop, or lollipop"
    );
  }
  if (!["terrain", "monotonic_ascent"].includes(args.elevationProfile)) {
    throw new Error(
      "--elevation-profile must be terrain or monotonic_ascent"
    );
  }
  if (
    args.elevationProfile === "monotonic_ascent" &&
    args.routeShape !== "out_and_back"
  ) {
    throw new Error(
      "--elevation-profile monotonic_ascent requires out_and_back geometry"
    );
  }
  if (
    args.replacePendingRouteIds.some(
      (routeId) => !/^[A-Za-z0-9_-]+$/.test(routeId)
    )
  ) {
    throw new Error("--replace-pending-route contains an invalid route id");
  }
  if (
    new Set(args.replacePendingRouteIds).size !==
    args.replacePendingRouteIds.length
  ) {
    throw new Error("--replace-pending-route ids must be unique");
  }
  if (
    args.replaceActiveRouteId &&
    !/^[A-Za-z0-9_-]+$/.test(args.replaceActiveRouteId)
  ) {
    throw new Error("--replace-active-route contains an invalid route id");
  }
  if (
    args.upgradeActiveRouteId &&
    !/^[A-Za-z0-9_-]+$/.test(args.upgradeActiveRouteId)
  ) {
    throw new Error("--upgrade-active-route contains an invalid route id");
  }
  if (
    args.replaceActiveRouteId &&
    args.upgradeActiveRouteId
  ) {
    throw new Error(
      "--replace-active-route cannot be combined with --upgrade-active-route"
    );
  }
  if (
    args.upgradeActiveRouteId &&
    args.replacePendingRouteIds.length > 0
  ) {
    throw new Error(
      "--upgrade-active-route cannot be combined with --replace-pending-route"
    );
  }
  if (args.apply && !args.acknowledgeOsmOdbl) {
    throw new Error("--apply requires --acknowledge-geometry-license");
  }
  if (args.apply && !args.acknowledgeMapReview) {
    throw new Error("--apply requires --acknowledge-map-review");
  }
  return args;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return value.map((item) => String(item).trim());
}

function positiveIntegerArray(
  value: unknown,
  label: string,
  allowEmpty = false
): number[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some(
      (item) =>
        typeof item !== "number" ||
        !Number.isSafeInteger(item) ||
        item <= 0
    )
  ) {
    throw new Error(`${label} must contain positive safe integers`);
  }
  return value;
}

async function loadCandidate(path: string, args: Args): Promise<Candidate> {
  const raw = objectValue(
    JSON.parse(await readFile(path, "utf8")) as unknown,
    "candidate"
  );
  if (raw.type !== "FeatureCollection") {
    throw new Error("Candidate must be a GeoJSON FeatureCollection");
  }
  if (raw.peaks_destination_id !== args.destinationId) {
    throw new Error("Candidate destination id does not match --destination-id");
  }
  if (raw.peaks_trailhead_id !== args.trailheadId) {
    throw new Error("Candidate trailhead id does not match --trailhead-id");
  }

  const sourceKind =
    typeof raw.peaks_source_kind === "string"
      ? raw.peaks_source_kind.trim()
      : "openstreetmap";
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(sourceKind)) {
    throw new Error("peaks_source_kind is invalid");
  }
  const sourceUrl = stringValue(raw.peaks_source, "peaks_source");
  const source = new URL(sourceUrl);
  if (source.protocol !== "https:") {
    throw new Error("peaks_source must be an HTTPS URL");
  }
  const licenseName = stringValue(
    raw.peaks_license_name,
    "peaks_license_name"
  );
  const licenseUrl = stringValue(raw.peaks_license, "peaks_license");
  const attribution = stringValue(
    raw.peaks_attribution,
    "peaks_attribution"
  );
  if (sourceKind === "openstreetmap") {
    if (!source.hostname.endsWith("openstreetmap.org")) {
      throw new Error("OpenStreetMap source must use openstreetmap.org");
    }
    if (
      licenseName !== OSM_LICENSE_NAME ||
      licenseUrl !== OSM_LICENSE_URL ||
      attribution !== OSM_ATTRIBUTION
    ) {
      throw new Error("OpenStreetMap license metadata is invalid");
    }
  } else if (sourceKind === "usgs-national-map") {
    if (source.hostname !== "partnerships.nationalmap.gov") {
      throw new Error(
        "USGS National Map source must use partnerships.nationalmap.gov"
      );
    }
    if (
      licenseName !== USGS_LICENSE_NAME ||
      licenseUrl !== USGS_LICENSE_URL
    ) {
      throw new Error("USGS National Map license metadata is invalid");
    }
  } else {
    throw new Error(`Unsupported peaks_source_kind: ${sourceKind}`);
  }
  const parsedLicenseUrl = new URL(licenseUrl);
  if (parsedLicenseUrl.protocol !== "https:") {
    throw new Error("peaks_license must be an HTTPS URL");
  }
  const retrievedAt = new Date(
    stringValue(raw.peaks_retrieved_at, "peaks_retrieved_at")
  );
  if (Number.isNaN(retrievedAt.getTime())) {
    throw new Error("peaks_retrieved_at must be a valid timestamp");
  }

  if (!Array.isArray(raw.features) || raw.features.length !== 1) {
    throw new Error("Candidate must contain exactly one feature");
  }
  const feature = objectValue(raw.features[0], "feature");
  const properties = objectValue(feature.properties, "feature.properties");
  const geometry = objectValue(feature.geometry, "feature.geometry");
  if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    throw new Error("Candidate feature must have a LineString geometry");
  }
  const coordinates = geometry.coordinates.map((value, index) => {
    if (!Array.isArray(value) || value.length < 2) {
      throw new Error(`Coordinate ${index} must be [longitude, latitude]`);
    }
    const lng = numberValue(value[0], `coordinate ${index} longitude`);
    const lat = numberValue(value[1], `coordinate ${index} latitude`);
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      throw new Error(`Coordinate ${index} is outside WGS84 bounds`);
    }
    return [lng, lat] as [number, number];
  });
  if (coordinates.length < 5 || coordinates.length > 5000) {
    throw new Error("Candidate must have from 5 to 5,000 points");
  }

  const wayIds = positiveIntegerArray(
    properties.osm_way_ids,
    "osm_way_ids",
    sourceKind !== "openstreetmap"
  );
  const wayUrls = stringArray(properties.osm_way_urls, "osm_way_urls");
  const expectedUrls = wayIds.map(
    (id) => `https://www.openstreetmap.org/way/${id}`
  );
  if (
    wayUrls.length !== expectedUrls.length ||
    expectedUrls.some((url, index) => wayUrls[index] !== url)
  ) {
    throw new Error("osm_way_urls must match osm_way_ids in order");
  }
  if (sourceKind === "openstreetmap" && wayIds.length === 0) {
    throw new Error("OpenStreetMap candidate must name at least one way");
  }
  if (sourceKind !== "openstreetmap" && wayIds.length > 0) {
    throw new Error("Non-OSM candidate cannot claim OpenStreetMap ways");
  }

  const trailheadSnapM = numberValue(
    properties.trailhead_snap_m,
    "trailhead_snap_m"
  );
  const summitSnapM = numberValue(
    properties.summit_snap_m,
    "summit_snap_m"
  );
  if (trailheadSnapM > 300 || summitSnapM > 250) {
    throw new Error(
      `OSM endpoint snaps are too large: ${trailheadSnapM.toFixed(1)} m / ` +
        `${summitSnapM.toFixed(1)} m`
    );
  }

  return {
    sourceKind,
    sourceUrl: source.toString(),
    licenseName,
    licenseUrl,
    attribution,
    retrievedAt: retrievedAt.toISOString(),
    wayIds,
    wayUrls,
    containsOsmGeometry: sourceKind === "openstreetmap",
    coordinates,
    trailheadSnapM,
    summitSnapM,
  };
}

async function loadPlaces(args: Args): Promise<{
  destination: Place;
  trailhead: Place;
}> {
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            d.prominence,
            d.session_count_offset + (
              SELECT COUNT(*)
              FROM session_destinations sd
              WHERE sd.destination_id = d.id
            ) AS session_count,
            ARRAY(
              SELECT l.name
              FROM list_destinations ld
              JOIN lists l ON l.id = ld.list_id
              WHERE ld.destination_id = d.id AND l.owner = 'peaks'
              ORDER BY l.name
            ) AS list_names
     FROM destinations d
     WHERE d.id = ANY($1::text[])`,
    [[args.destinationId, args.trailheadId]]
  );
  const places = new Map<string, Place>(
    result.rows.map((row) => [
      String(row.id),
      {
        id: String(row.id),
        name: String(row.name),
        lat: Number(row.lat),
        lng: Number(row.lng),
        elevation:
          row.elevation === null ? null : Number(row.elevation),
        list_names: Array.isArray(row.list_names) ? row.list_names : [],
        prominence:
          row.prominence === null ? null : Number(row.prominence),
        session_count: Number(row.session_count),
      },
    ])
  );
  const destination = places.get(args.destinationId);
  const trailhead = places.get(args.trailheadId);
  if (!destination) throw new Error("Destination was not found");
  if (!trailhead) throw new Error("Trailhead was not found");
  if (
    destination.list_names.length === 0 &&
    (destination.prominence ?? 0) < 1500 &&
    destination.session_count < 25
  ) {
    throw new Error(
      "Destination is outside the standard-route goal target set"
    );
  }
  return { destination, trailhead };
}

async function buildTrack(
  args: Args,
  candidate: Candidate,
  destination: Place,
  trailhead: Place
): Promise<TrackPoint[]> {
  const first = candidate.coordinates[0];
  const last = candidate.coordinates[candidate.coordinates.length - 1];
  const startOffset = haversineDistance(
    first[1],
    first[0],
    trailhead.lat,
    trailhead.lng
  );
  const returnsToTrailhead =
    args.routeShape === "loop" || args.routeShape === "lollipop";
  const expectedEnd = returnsToTrailhead ? trailhead : destination;
  const endOffset = haversineDistance(
    last[1],
    last[0],
    expectedEnd.lat,
    expectedEnd.lng
  );
  let summitIndex = 0;
  let summitOffset = Number.POSITIVE_INFINITY;
  candidate.coordinates.forEach(([lng, lat], index) => {
    const offset = haversineDistance(
      lat,
      lng,
      destination.lat,
      destination.lng
    );
    if (offset < summitOffset) {
      summitOffset = offset;
      summitIndex = index;
    }
  });
  if (startOffset > 20 || endOffset > 20 || summitOffset > 20) {
    throw new Error(
      `Candidate does not match catalog places: start ` +
        `${startOffset.toFixed(1)} m / summit ${summitOffset.toFixed(1)} m / ` +
        `end ${endOffset.toFixed(1)} m`
    );
  }

  const elevationPoints = candidate.coordinates.map(([lng, lat]) => ({
    lat,
    lng,
  }));
  const elevationSource = process.env.PEAKS_ELEVATION_SOURCE;
  const elevations = elevationSource === "terrain-cache"
    ? await fetchCachedTerrainElevations(elevationPoints)
    : elevationSource === "usgs-3dep"
      ? await fetchUsgs3depElevations(elevationPoints)
      : (() => {
        throw new Error(
          "Set PEAKS_ELEVATION_SOURCE=terrain-cache or usgs-3dep"
        );
      })();
  if (Number.isFinite(trailhead.elevation)) {
    elevations[0] = trailhead.elevation as number;
  }
  if (Number.isFinite(destination.elevation)) {
    elevations[summitIndex] = destination.elevation as number;
  }
  if (
    returnsToTrailhead &&
    Number.isFinite(trailhead.elevation)
  ) {
    elevations[elevations.length - 1] = trailhead.elevation as number;
  }
  const fittedElevations =
    args.elevationProfile === "monotonic_ascent"
      ? fitMonotonicAscentProfile(elevations)
      : elevations;
  let distance = 0;
  return candidate.coordinates.map(([lng, lat], index) => {
    if (index > 0) {
      const prior = candidate.coordinates[index - 1];
      distance += haversineDistance(prior[1], prior[0], lat, lng);
    }
    return {
      lat,
      lng,
      ele: fittedElevations[index],
      dist: Math.round(distance * 10) / 10,
    };
  });
}

function terrainTilePixel(point: ElevationPoint): {
  x: number;
  y: number;
  pixelX: number;
  pixelY: number;
} {
  const n = 2 ** TERRAIN_TILE_ZOOM;
  const latitude = Math.max(
    -85.05112878,
    Math.min(85.05112878, point.lat)
  );
  const latitudeRadians = latitude * Math.PI / 180;
  const xFloat = ((point.lng + 180) / 360) * n;
  const yFloat =
    (1 -
      Math.log(
        Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)
      ) /
        Math.PI) /
    2 *
    n;
  const x = Math.floor(xFloat);
  const y = Math.floor(yFloat);
  return {
    x,
    y,
    pixelX: Math.floor((xFloat - x) * TERRAIN_TILE_SIZE),
    pixelY: Math.floor((yFloat - y) * TERRAIN_TILE_SIZE),
  };
}

async function fetchCachedTerrainElevations(
  points: ElevationPoint[]
): Promise<number[]> {
  const cacheDir = process.env.PEAKS_TERRAIN_TILE_CACHE;
  if (!cacheDir) {
    throw new Error(
      "PEAKS_TERRAIN_TILE_CACHE is required for terrain-cache elevations"
    );
  }
  const groups = new Map<
    string,
    {
      x: number;
      y: number;
      points: Array<{ index: number; pixelX: number; pixelY: number }>;
    }
  >();
  points.forEach((point, index) => {
    const tile = terrainTilePixel(point);
    const key = `${tile.x}/${tile.y}`;
    const group = groups.get(key) ?? {
      x: tile.x,
      y: tile.y,
      points: [],
    };
    group.points.push({
      index,
      pixelX: tile.pixelX,
      pixelY: tile.pixelY,
    });
    groups.set(key, group);
  });

  const elevations = new Array<number>(points.length);
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const tilePath = path.join(
        cacheDir,
        String(TERRAIN_TILE_ZOOM),
        String(group.x),
        `${group.y}.png`
      );
      let image: Buffer;
      try {
        image = await readFile(tilePath);
      } catch {
        throw new Error(
          `Missing terrain tile ${TERRAIN_TILE_ZOOM}/${group.x}/${group.y}; ` +
            "prefetch the candidate bounding box before importing"
        );
      }
      const { data, info } = await sharp(image)
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (const point of group.points) {
        const pixelX = Math.min(point.pixelX, info.width - 1);
        const pixelY = Math.min(point.pixelY, info.height - 1);
        const decodeElevation = (x: number, y: number): number => {
          const offset = (y * info.width + x) * info.channels;
          return (
            data[offset] * 256 +
            data[offset + 1] +
            data[offset + 2] / 256 -
            32768
          );
        };
        const validElevation = (elevation: number): boolean =>
          Number.isFinite(elevation) && elevation >= -500 && elevation <= 9_000;
        let elevation = decodeElevation(pixelX, pixelY);
        if (!validElevation(elevation)) {
          // Terrarium tiles can contain isolated invalid pixels even when the
          // surrounding terrain is sound. Use the median of the first nearby
          // ring with valid samples instead of failing a whole route.
          for (let radius = 1; radius <= 4; radius += 1) {
            const nearby: number[] = [];
            for (let dy = -radius; dy <= radius; dy += 1) {
              for (let dx = -radius; dx <= radius; dx += 1) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
                const x = pixelX + dx;
                const y = pixelY + dy;
                if (x < 0 || x >= info.width || y < 0 || y >= info.height) {
                  continue;
                }
                const sample = decodeElevation(x, y);
                if (validElevation(sample)) nearby.push(sample);
              }
            }
            if (nearby.length > 0) {
              nearby.sort((left, right) => left - right);
              const middle = Math.floor(nearby.length / 2);
              elevation =
                nearby.length % 2 === 0
                  ? (nearby[middle - 1] + nearby[middle]) / 2
                  : nearby[middle];
              break;
            }
          }
        }
        if (!Number.isFinite(elevation) || elevation < -500 || elevation > 9_000) {
          throw new Error(
            `Terrain tile returned an invalid elevation at point ${point.index}`
          );
        }
        elevations[point.index] = Math.round(elevation * 10) / 10;
      }
    })
  );
  return elevations;
}

async function fetchUsgs3depElevations(
  points: ElevationPoint[]
): Promise<number[]> {
  if (points.length === 0) return [];

  const cacheDir = process.env.PEAKS_ELEVATION_CACHE_DIR;
  const cacheKey = createHash("sha256")
    .update(JSON.stringify(points))
    .digest("hex");
  const cachePath = cacheDir
    ? path.join(cacheDir, `usgs-3dep-${cacheKey}.json`)
    : "";
  if (cachePath) {
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8")) as unknown;
      if (
        Array.isArray(cached) &&
        cached.length === points.length &&
        cached.every(Number.isFinite)
      ) {
        return cached;
      }
    } catch {
      // A cache miss or invalid cache entry falls through to the public API.
    }
  }

  const sampleCount = Math.min(points.length, 300);
  const sampleIndices = Array.from({ length: sampleCount }, (_, index) =>
    Math.round((index * (points.length - 1)) / (sampleCount - 1 || 1))
  ).filter((value, index, values) => index === 0 || value !== values[index - 1]);
  const samplePoints = sampleIndices.map((index) => points[index]);
  const sampledElevations: number[] = [];
  for (let start = 0; start < samplePoints.length; start += 100) {
    sampledElevations.push(
      ...(await fetchUsgs3depSampleBatch(samplePoints.slice(start, start + 100)))
    );
  }

  const cumulativeDistance = new Array<number>(points.length).fill(0);
  for (let index = 1; index < points.length; index += 1) {
    cumulativeDistance[index] =
      cumulativeDistance[index - 1] +
      haversineDistance(
        points[index - 1].lat,
        points[index - 1].lng,
        points[index].lat,
        points[index].lng
      );
  }
  const elevations = new Array<number>(points.length);
  let sampleIndex = 0;
  for (let index = 0; index < points.length; index += 1) {
    while (
      sampleIndex + 1 < sampleIndices.length &&
      sampleIndices[sampleIndex + 1] < index
    ) {
      sampleIndex += 1;
    }
    const leftIndex = sampleIndices[sampleIndex];
    const rightSampleIndex = Math.min(
      sampleIndex + 1,
      sampleIndices.length - 1
    );
    const rightIndex = sampleIndices[rightSampleIndex];
    const span =
      cumulativeDistance[rightIndex] - cumulativeDistance[leftIndex];
    const fraction =
      span > 0
        ? (cumulativeDistance[index] - cumulativeDistance[leftIndex]) / span
        : 0;
    elevations[index] =
      Math.round(
        (sampledElevations[sampleIndex] +
          (sampledElevations[rightSampleIndex] -
            sampledElevations[sampleIndex]) *
            fraction) *
          10
      ) / 10;
  }
  if (cachePath) {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(elevations));
  }
  return elevations;
}

async function fetchUsgs3depSampleBatch(
  points: ElevationPoint[]
): Promise<number[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(USGS_3DEP_SAMPLES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent":
          "Peaks route research/1.0 " +
          "(https://github.com/jhmacdon/peaks-firebase)",
      },
      body: new URLSearchParams({
        geometry: JSON.stringify({
          points: points.map((point) => [point.lng, point.lat]),
          spatialReference: { wkid: 4326 },
        }),
        geometryType: "esriGeometryMultipoint",
        returnFirstValueOnly: "true",
        interpolation: "RSP_BilinearInterpolation",
        f: "json",
      }),
      signal: controller.signal,
    });
  } catch {
    return fetchOpenTopoDataNed(points);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    if (response.status >= 500) return fetchOpenTopoDataNed(points);
    throw new Error(`USGS 3DEP returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    error?: { message?: string };
    samples?: Array<{ locationId?: number; value?: string | number }>;
  };
  if (payload.error) {
    throw new Error(
      `USGS 3DEP failed: ${payload.error.message ?? "unknown error"}`
    );
  }
  if (
    !Array.isArray(payload.samples) ||
    payload.samples.length !== points.length
  ) {
    throw new Error(
      `USGS 3DEP returned ${payload.samples?.length ?? 0}/` +
        `${points.length} samples`
    );
  }

  const elevations = new Array<number>(points.length);
  payload.samples.forEach((sample, index) => {
    const target = Number.isInteger(sample.locationId)
      ? Number(sample.locationId)
      : index;
    const elevation = Number(sample.value);
    if (
      target < 0 ||
      target >= points.length ||
      !Number.isFinite(elevation) ||
      elevation < -500 ||
      elevation > 9_000
    ) {
      throw new Error(`USGS 3DEP returned an invalid sample at ${index}`);
    }
    elevations[target] = Math.round(elevation * 10) / 10;
  });
  if (elevations.some((elevation) => !Number.isFinite(elevation))) {
    throw new Error("USGS 3DEP response omitted one or more samples");
  }
  return elevations;
}

async function fetchOpenTopoDataNed(
  points: ElevationPoint[]
): Promise<number[]> {
  const url = new URL(OPEN_TOPO_DATA_NED_URL);
  url.searchParams.set(
    "locations",
    points.map((point) => `${point.lat},${point.lng}`).join("|")
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`OpenTopoData NED returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    status?: string;
    results?: Array<{ elevation?: number | null }>;
  };
  if (
    payload.status !== "OK" ||
    !Array.isArray(payload.results) ||
    payload.results.length !== points.length
  ) {
    throw new Error(
      `OpenTopoData NED returned ${payload.results?.length ?? 0}/` +
        `${points.length} samples`
    );
  }
  return payload.results.map((result, index) => {
    const elevation = Number(result.elevation);
    if (!Number.isFinite(elevation) || elevation < -500 || elevation > 9_000) {
      throw new Error(
        `OpenTopoData NED returned an invalid sample at ${index}`
      );
    }
    return Math.round(elevation * 10) / 10;
  });
}

async function assertNoConflict(
  destinationId: string,
  name: string,
  replacePendingRouteIds: string[],
  replaceActiveRouteId: string,
  upgradeActiveRouteId: string,
  exactExistingRouteId: string
): Promise<void> {
  const routes = await db.query<{
    id: string;
    name: string;
    status: string;
  }>(
    `SELECT r.id, r.name, r.status
     FROM route_destinations rd
     JOIN routes r ON r.id = rd.route_id
     WHERE rd.destination_id = $1
       AND r.owner = 'peaks'
       AND r.status IN ('active', 'pending')`,
    [destinationId]
  );
  const conflict = findConflictingLiveRoute(routes.rows, name, [
    ...replacePendingRouteIds,
    replaceActiveRouteId,
    upgradeActiveRouteId,
    exactExistingRouteId,
  ]);
  if (conflict) {
    throw new Error(
      `A conflicting Peaks route exists: ${conflict.name} ` +
        `(${conflict.status}, ${conflict.id})`
    );
  }
}

async function findExactExistingRoute(
  args: Args,
  candidate: Candidate,
  points: TrackPoint[]
): Promise<{ id: string; status: "pending" | "active" } | null> {
  if (args.upgradeActiveRouteId) return null;
  const result = await db.query<{ id: string; status: "pending" | "active" }>(
    `SELECT r.id, r.status
     FROM routes r
     WHERE r.owner = 'peaks'
       AND r.status IN ('pending', 'active')
       AND lower(r.name) = lower($1)
       AND r.shape = $2::route_shape
       AND r.provenance = $3::jsonb
       AND ST_Equals(r.path::geometry, ST_GeomFromText($4, 4326))
       AND r.external_links = $7::jsonb
       AND EXISTS (
         SELECT 1
         FROM route_destinations rd
         WHERE rd.route_id = r.id
           AND rd.destination_id = $5
           AND rd.ordinal = 0
       )
       AND EXISTS (
         SELECT 1
         FROM route_destinations rd
         WHERE rd.route_id = r.id
           AND rd.destination_id = $6
           AND rd.ordinal = 1
       )
       AND EXISTS (
         SELECT 1
         FROM route_segments rs
         JOIN segments s ON s.id = rs.segment_id
         WHERE rs.route_id = r.id
           AND s.provenance = r.provenance
           AND ST_Equals(s.path::geometry, r.path::geometry)
       )
       AND (SELECT COUNT(*) FROM route_segments rs WHERE rs.route_id = r.id) = 1
     ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.id
     LIMIT 1`,
    [
      args.name,
      args.routeShape,
      JSON.stringify(provenance(candidate, args)),
      pointsToLineStringZ(points),
      args.trailheadId,
      args.destinationId,
      JSON.stringify(args.sourceLinks),
    ]
  );
  return result.rows[0] ?? null;
}

async function assertUpgradeableActiveRoute(
  destinationId: string,
  routeId: string
): Promise<void> {
  if (!routeId) return;
  const result = await db.query<{ id: string }>(
    `SELECT DISTINCT r.id
     FROM routes r
     JOIN route_destinations rd ON rd.route_id = r.id
     WHERE r.id = $1
       AND r.owner = 'peaks'
       AND r.status = 'active'
       AND rd.destination_id = $2`,
    [routeId, destinationId]
  );
  if (result.rows.length !== 1) {
    throw new Error(
      `Active upgrade route is not eligible: ${routeId}`
    );
  }
}

async function assertReplaceableActiveRoute(
  destinationId: string,
  routeId: string
): Promise<void> {
  if (!routeId) return;
  const result = await db.query<{ id: string }>(
    `SELECT DISTINCT r.id
     FROM routes r
     JOIN route_destinations rd ON rd.route_id = r.id
     WHERE r.id = $1
       AND r.owner = 'peaks'
       AND r.status = 'active'
       AND rd.destination_id = $2`,
    [routeId, destinationId]
  );
  if (result.rows.length !== 1) {
    throw new Error(
      `Active replacement route is not eligible: ${routeId}`
    );
  }
}

async function assertReplaceablePendingRoutes(
  destinationId: string,
  routeIds: string[]
): Promise<void> {
  if (routeIds.length === 0) return;
  const result = await db.query<{ id: string }>(
    `SELECT DISTINCT r.id
     FROM routes r
     JOIN route_destinations rd ON rd.route_id = r.id
     WHERE r.id = ANY($1::text[])
       AND r.owner = 'peaks'
       AND r.status = 'pending'
       AND rd.destination_id = $2`,
    [routeIds, destinationId]
  );
  const found = new Set(result.rows.map((row) => row.id));
  const invalid = routeIds.filter((routeId) => !found.has(routeId));
  if (invalid.length > 0) {
    throw new Error(
      `Pending replacement routes are not eligible: ${invalid.join(", ")}`
    );
  }
}

function provenance(candidate: Candidate, args: Args) {
  return {
    source_kind: candidate.sourceKind,
    source_url: candidate.sourceUrl,
    license_name: candidate.licenseName,
    license_url: candidate.licenseUrl,
    attribution: candidate.attribution,
    retrieved_at: candidate.retrievedAt,
    osm_way_ids: candidate.wayIds,
    osm_way_urls: candidate.wayUrls,
    contains_osm_geometry: candidate.containsOsmGeometry,
    elevation_source:
      process.env.PEAKS_ELEVATION_SOURCE === "terrain-cache"
        ? "AWS Open Data Terrain Tiles"
        : process.env.PEAKS_ELEVATION_SOURCE ?? "unknown",
    elevation_profile: args.elevationProfile,
  };
}

async function createPendingRoute(
  args: Args,
  candidate: Candidate,
  points: TrackPoint[],
  stats: ReturnType<typeof computeElevationStats>
): Promise<string> {
  const routeId = generateId();
  const segmentId = generateId();
  const wkt = pointsToLineStringZ(points);
  const polyline6 = encodePolyline6(points);
  const routeProvenance = provenance(candidate, args);
  const distance = Math.round(points[points.length - 1].dist);
  const client = await db.connect();

  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      `SELECT id FROM destinations WHERE id = ANY($1::text[]) FOR UPDATE`,
      [[args.destinationId, args.trailheadId]]
    );
    if (args.replaceActiveRouteId) {
      const replacement = await client.query<{ id: string }>(
        `SELECT r.id
         FROM routes r
         JOIN route_destinations rd ON rd.route_id = r.id
         WHERE r.id = $1
           AND r.owner = 'peaks'
           AND r.status = 'active'
           AND rd.destination_id = $2
         FOR UPDATE OF r`,
        [args.replaceActiveRouteId, args.destinationId]
      );
      if (replacement.rows.length !== 1) {
        throw new Error(
          `Active replacement route changed during import: ` +
            args.replaceActiveRouteId
        );
      }
    }

    const exactExisting = await client.query<{
      id: string;
      status: string;
    }>(
      `SELECT r.id, r.status
       FROM routes r
       WHERE r.owner = 'peaks'
         AND r.status IN ('pending', 'active')
         AND lower(r.name) = lower($1)
         AND r.shape = $2::route_shape
         AND r.provenance = $3::jsonb
         AND ST_Equals(
           r.path::geometry,
           ST_GeomFromText($4, 4326)
         )
         AND r.external_links = $7::jsonb
         AND EXISTS (
           SELECT 1
           FROM route_destinations rd
           WHERE rd.route_id = r.id
             AND rd.destination_id = $5
             AND rd.ordinal = 0
         )
         AND EXISTS (
           SELECT 1
           FROM route_destinations rd
           WHERE rd.route_id = r.id
             AND rd.destination_id = $6
             AND rd.ordinal = 1
         )
         AND EXISTS (
           SELECT 1
           FROM route_segments rs
           JOIN segments s ON s.id = rs.segment_id
         WHERE rs.route_id = r.id
             AND s.provenance = r.provenance
             AND ST_Equals(s.path::geometry, r.path::geometry)
         )
         AND (
           SELECT COUNT(*)
           FROM route_segments rs
           WHERE rs.route_id = r.id
         ) = 1
       ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.id
       LIMIT 1
       FOR UPDATE`,
      [
        args.name,
        args.routeShape,
        JSON.stringify(routeProvenance),
        wkt,
        args.trailheadId,
        args.destinationId,
        JSON.stringify(args.sourceLinks),
      ]
    );
    if (exactExisting.rows[0]?.status === "pending") {
      await client.query("COMMIT");
      console.log(
        `Reused exact pending route ${exactExisting.rows[0].id} after restart`
      );
      return exactExisting.rows[0].id;
    }
    if (exactExisting.rows[0]?.status === "active") {
      throw new Error(
        `The exact route is already active: ${exactExisting.rows[0].id}`
      );
    }

    const replacementRows = await client.query<{
      id: string;
      segment_id: string | null;
    }>(
      `SELECT r.id, rs.segment_id
       FROM routes r
       JOIN route_destinations rd ON rd.route_id = r.id
       LEFT JOIN route_segments rs ON rs.route_id = r.id
       WHERE r.id = ANY($1::text[])
         AND r.owner = 'peaks'
         AND r.status = 'pending'
         AND rd.destination_id = $2
       FOR UPDATE OF r`,
      [args.replacePendingRouteIds, args.destinationId]
    );
    const foundReplacementIds = new Set(
      replacementRows.rows.map((row) => row.id)
    );
    const invalidReplacementIds = args.replacePendingRouteIds.filter(
      (routeId) => !foundReplacementIds.has(routeId)
    );
    if (invalidReplacementIds.length > 0) {
      throw new Error(
        `Pending replacement routes changed during import: ` +
          invalidReplacementIds.join(", ")
      );
    }
    const replacementSegmentIds = [
      ...new Set(
        replacementRows.rows
          .map((row) => row.segment_id)
          .filter((segmentId): segmentId is string => Boolean(segmentId))
      ),
    ];

    const conflict = await lockAndFindConflictingLiveRoute(
      client,
      args.destinationId,
      args.name,
      [...args.replacePendingRouteIds, args.replaceActiveRouteId]
    );
    if (conflict) {
      throw new Error(
        `A conflicting route appeared during import: ${conflict.id}`
      );
    }

    await client.query(
      `INSERT INTO routes (
         id, name, path, polyline6, owner, distance, gain, gain_loss,
         external_links, completion, shape, status, provenance
       )
       VALUES (
         $1, $2, ST_GeomFromText($3, 4326)::geography, $4, 'peaks',
         $5, $6, $7, $8::jsonb, 'none', $9::route_shape, 'pending',
         $10::jsonb
       )`,
      [
        routeId,
        args.name,
        wkt,
        polyline6,
        distance,
        stats.gain,
        stats.loss,
        JSON.stringify(args.sourceLinks),
        args.routeShape,
        JSON.stringify(routeProvenance),
      ]
    );
    await client.query(
      `INSERT INTO segments (
         id, name, path, polyline6, distance, gain, gain_loss, provenance
       )
       VALUES (
         $1, $2, ST_GeomFromText($3, 4326)::geography, $4, $5, $6, $7,
         $8::jsonb
       )`,
      [
        segmentId,
        args.name,
        wkt,
        polyline6,
        distance,
        stats.gain,
        stats.loss,
        JSON.stringify(routeProvenance),
      ]
    );
    await client.query(
      `INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
       VALUES ($1, $2, 0, 'forward')`,
      [routeId, segmentId]
    );
    await client.query(
      `INSERT INTO route_destinations (route_id, destination_id, ordinal)
       VALUES ($1, $2, 0), ($1, $3, 1)`,
      [routeId, args.trailheadId, args.destinationId]
    );
    if (args.replacePendingRouteIds.length > 0) {
      await client.query(
        `DELETE FROM routes
         WHERE id = ANY($1::text[])
           AND owner = 'peaks'
           AND status = 'pending'`,
        [args.replacePendingRouteIds]
      );
      if (replacementSegmentIds.length > 0) {
        await client.query(
          `DELETE FROM segments s
           WHERE s.id = ANY($1::text[])
             AND NOT EXISTS (
               SELECT 1
               FROM route_segments rs
               WHERE rs.segment_id = s.id
             )`,
          [replacementSegmentIds]
        );
      }
    }
    await client.query("COMMIT");
    return routeId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upgradeActiveRoute(
  args: Args,
  candidate: Candidate,
  points: TrackPoint[],
  stats: ReturnType<typeof computeElevationStats>
): Promise<string> {
  const routeId = args.upgradeActiveRouteId;
  const segmentId = generateId();
  const wkt = pointsToLineStringZ(points);
  const polyline6 = encodePolyline6(points);
  const routeProvenance = provenance(candidate, args);
  const distance = Math.round(points[points.length - 1].dist);
  const client = await db.connect();

  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      `SELECT id FROM destinations WHERE id = ANY($1::text[]) FOR UPDATE`,
      [[args.destinationId, args.trailheadId]]
    );
    const route = await client.query<{ id: string }>(
      `SELECT r.id
       FROM routes r
       JOIN route_destinations rd ON rd.route_id = r.id
       WHERE r.id = $1
         AND r.owner = 'peaks'
         AND r.status = 'active'
         AND rd.destination_id = $2
       FOR UPDATE OF r`,
      [routeId, args.destinationId]
    );
    if (route.rows.length !== 1) {
      throw new Error(`Active upgrade route changed during import: ${routeId}`);
    }
    const conflict = await lockAndFindConflictingLiveRoute(
      client,
      args.destinationId,
      args.name,
      [routeId]
    );
    if (conflict) {
      throw new Error(
        `A conflicting route appeared during active upgrade: ${conflict.id}`
      );
    }
    const oldSegments = await client.query<{ segment_id: string }>(
      `SELECT segment_id
       FROM route_segments
       WHERE route_id = $1`,
      [routeId]
    );

    await client.query(
      `UPDATE routes
       SET name = $2,
           path = ST_GeomFromText($3, 4326)::geography,
           polyline6 = $4,
           distance = $5,
           gain = $6,
           gain_loss = $7,
           external_links = $8::jsonb,
           completion = 'none',
           shape = $9::route_shape,
           provenance = $10::jsonb
       WHERE id = $1`,
      [
        routeId,
        args.name,
        wkt,
        polyline6,
        distance,
        stats.gain,
        stats.loss,
        JSON.stringify(args.sourceLinks),
        args.routeShape,
        JSON.stringify(routeProvenance),
      ]
    );
    await client.query(
      `DELETE FROM route_segments WHERE route_id = $1`,
      [routeId]
    );
    await client.query(
      `INSERT INTO segments (
         id, name, path, polyline6, distance, gain, gain_loss, provenance
       )
       VALUES (
         $1, $2, ST_GeomFromText($3, 4326)::geography, $4, $5, $6, $7,
         $8::jsonb
       )`,
      [
        segmentId,
        args.name,
        wkt,
        polyline6,
        distance,
        stats.gain,
        stats.loss,
        JSON.stringify(routeProvenance),
      ]
    );
    await client.query(
      `INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
       VALUES ($1, $2, 0, 'forward')`,
      [routeId, segmentId]
    );
    await client.query(
      `DELETE FROM route_destinations WHERE route_id = $1`,
      [routeId]
    );
    await client.query(
      `INSERT INTO route_destinations (route_id, destination_id, ordinal)
       VALUES ($1, $2, 0), ($1, $3, 1)`,
      [routeId, args.trailheadId, args.destinationId]
    );
    const oldSegmentIds = oldSegments.rows.map((row) => row.segment_id);
    if (oldSegmentIds.length > 0) {
      await client.query(
        `DELETE FROM segments s
         WHERE s.id = ANY($1::text[])
           AND NOT EXISTS (
             SELECT 1
             FROM route_segments rs
             WHERE rs.segment_id = s.id
           )`,
        [oldSegmentIds]
      );
    }
    await client.query("COMMIT");
    return routeId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidate = await loadCandidate(args.candidatePath, args);
  const { destination, trailhead } = await loadPlaces(args);
  const points = await buildTrack(args, candidate, destination, trailhead);
  const distance = points[points.length - 1].dist;
  const stats = computeElevationStats(points.map((point) => point.ele));
  if (distance < 25) throw new Error("Route is shorter than 25 m");
  if (stats.loss > stats.gain * 1.5 && stats.loss > 100) {
    throw new Error("Route descends more than it climbs");
  }

  await assertUpgradeableActiveRoute(
    args.destinationId,
    args.upgradeActiveRouteId
  );
  await assertReplaceableActiveRoute(
    args.destinationId,
    args.replaceActiveRouteId
  );
  const exactExisting = await findExactExistingRoute(args, candidate, points);
  if (exactExisting?.status === "active") {
    throw new Error(`The exact route is already active: ${exactExisting.id}`);
  }
  if (!exactExisting) {
    await assertReplaceablePendingRoutes(
      args.destinationId,
      args.replacePendingRouteIds
    );
  }
  await assertNoConflict(
    args.destinationId,
    args.name,
    args.replacePendingRouteIds,
    args.replaceActiveRouteId,
    args.upgradeActiveRouteId,
    exactExisting?.id ?? ""
  );

  console.log(`Mode: ${args.apply ? "APPLY" : "DRY RUN"}`);
  console.log(
    `Route: ${trailhead.name} → ${destination.name}` +
      (["loop", "lollipop"].includes(args.routeShape)
        ? ` → ${trailhead.name}`
        : "") +
      `; ` +
      `${(distance / 1609.344).toFixed(2)} mi; ` +
      `+${Math.round(stats.gain * 3.28084)} ft; ` +
      `-${Math.round(stats.loss * 3.28084)} ft`
  );
  console.log(`Lists: ${destination.list_names.join(" | ")}`);
  console.log(
    `Geometry: ${candidate.sourceKind}` +
      (candidate.containsOsmGeometry
        ? `; ${candidate.wayIds.length} OSM ways`
        : "") +
      `; snaps ${candidate.trailheadSnapM.toFixed(1)} m / ` +
      `${candidate.summitSnapM.toFixed(1)} m`
  );
  console.log(`Shape: ${args.routeShape}`);
  console.log(
    `Provenance: ${candidate.attribution}; ${candidate.licenseName}; ` +
      candidate.retrievedAt
  );
  console.log(
    `Route sources: ${args.sourceLinks.map((link) => link.id).join(" | ")}`
  );
  if (args.replacePendingRouteIds.length > 0) {
    console.log(
      `Replaces incomplete pending routes: ` +
        args.replacePendingRouteIds.join(", ")
    );
  }
  if (args.replaceActiveRouteId) {
    console.log(
      `Keeps active route until publication: ${args.replaceActiveRouteId}`
    );
  }
  if (args.upgradeActiveRouteId) {
    console.log(`Upgrades active route in place: ${args.upgradeActiveRouteId}`);
  }
  console.log(
    `Elevations: ${
      process.env.PEAKS_ELEVATION_SOURCE === "terrain-cache"
        ? "local AWS Open Data Terrain Tiles cache"
        : process.env.PEAKS_ELEVATION_SOURCE === "usgs-3dep"
        ? "USGS 3DEP/NED"
        : "unknown"
    }; profile ${args.elevationProfile}`
  );

  if (!args.apply) {
    console.log("DRY RUN — no rows written");
    const result = {
      mode: "dry_run",
      destination_id: args.destinationId,
      trailhead_id: args.trailheadId,
      reusable_pending_route_id: exactExisting?.id ?? null,
      replacement_route_id: args.replaceActiveRouteId || null,
    };
    if (args.resultPath) {
      const resultPath = path.resolve(args.resultPath);
      await mkdir(path.dirname(resultPath), { recursive: true });
      await writeFile(resultPath, `${JSON.stringify(result)}\n`);
    }
    console.log(JSON.stringify(result));
    return;
  }
  let result: Record<string, string | null>;
  if (args.upgradeActiveRouteId) {
    const routeId = await upgradeActiveRoute(
      args,
      candidate,
      points,
      stats
    );
    console.log(`Upgraded active route ${routeId}`);
    result = {
      mode: "apply",
      status: "active",
      route_id: routeId,
      replacement_route_id: null,
    };
  } else {
    const routeId = await createPendingRoute(
      args,
      candidate,
      points,
      stats
    );
    console.log(`Pending route ready ${routeId}`);
    result = {
      mode: "apply",
      status: "pending",
      route_id: routeId,
      replacement_route_id: args.replaceActiveRouteId || null,
    };
  }
  if (args.resultPath) {
    const resultPath = path.resolve(args.resultPath);
    await mkdir(path.dirname(resultPath), { recursive: true });
    await writeFile(resultPath, `${JSON.stringify(result)}\n`);
  }
  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
