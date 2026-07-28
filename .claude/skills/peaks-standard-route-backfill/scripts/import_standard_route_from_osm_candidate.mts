#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dbImport from "../../../../cloud-sql/migrate/src/db";
import elevationImport from "../../../../web/src/lib/elevation";
import gpxImport from "../../../../web/src/lib/gpx";
import routeUtilsImport from "../../../../web/src/lib/route-utils";

const db =
  typeof (dbImport as { query?: unknown }).query === "function"
    ? dbImport
    : (dbImport as unknown as { default: typeof dbImport }).default;
const { computeElevationStats, fetchElevations: fetchMapboxElevations } =
  elevationImport as unknown as
  typeof import("../../../../web/src/lib/elevation");
const { haversineDistance } = gpxImport as unknown as
  typeof import("../../../../web/src/lib/gpx");
const { encodePolyline6, generateId, pointsToLineStringZ } =
  routeUtilsImport as unknown as
    typeof import("../../../../web/src/lib/route-utils");

const OSM_LICENSE_NAME =
  "Open Data Commons Open Database License (ODbL) 1.0";
const OSM_LICENSE_URL =
  "https://opendatacommons.org/licenses/odbl/1-0/";
const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
const USGS_3DEP_SAMPLES_URL =
  "https://elevation.nationalmap.gov/arcgis/rest/services/" +
  "3DEPElevation/ImageServer/getSamples";
const OPEN_TOPO_DATA_NED_URL =
  "https://api.opentopodata.org/v1/ned10m";

type ElevationPoint = { lat: number; lng: number };

type SourceLink = { type: string; id: string };

type TrackPoint = {
  lat: number;
  lng: number;
  ele: number;
  dist: number;
};

type Args = {
  candidatePath: string;
  destinationId: string;
  trailheadId: string;
  name: string;
  sourceLinks: SourceLink[];
  apply: boolean;
  acknowledgeOsmOdbl: boolean;
  acknowledgeMapReview: boolean;
};

type Candidate = {
  sourceUrl: string;
  retrievedAt: string;
  wayIds: number[];
  wayUrls: string[];
  coordinates: Array<[number, number]>;
  trailheadSnapM: number;
  summitSnapM: number;
};

type Place = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  list_names: string[];
};

const HELP = `Usage:
  tsx import_standard_route_from_osm_candidate.mts \\
    --candidate /path/to/candidate.geojson \\
    --destination-id ID \\
    --trailhead-id ID \\
    --name "Peak via Standard Route" \\
    --source-url type=https://direct/route/page \\
    [--apply --acknowledge-osm-odbl --acknowledge-map-review]

Dry-run is the default. Apply creates a Peaks-owned pending route and segment.
It never activates a route. Build the GeoJSON with build_osm_route_candidate.mts.
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
    apply: argv.includes("--apply"),
    acknowledgeOsmOdbl: argv.includes("--acknowledge-osm-odbl"),
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
  if (args.apply && !args.acknowledgeOsmOdbl) {
    throw new Error("--apply requires --acknowledge-osm-odbl");
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

function positiveIntegerArray(value: unknown, label: string): number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
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

  const sourceUrl = stringValue(raw.peaks_source, "peaks_source");
  const source = new URL(sourceUrl);
  if (
    source.protocol !== "https:" ||
    !source.hostname.endsWith("openstreetmap.org")
  ) {
    throw new Error("peaks_source must be an HTTPS OpenStreetMap URL");
  }
  if (raw.peaks_license_name !== OSM_LICENSE_NAME) {
    throw new Error(`peaks_license_name must be "${OSM_LICENSE_NAME}"`);
  }
  if (raw.peaks_license !== OSM_LICENSE_URL) {
    throw new Error(`peaks_license must be ${OSM_LICENSE_URL}`);
  }
  if (raw.peaks_attribution !== OSM_ATTRIBUTION) {
    throw new Error(`peaks_attribution must be "${OSM_ATTRIBUTION}"`);
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
    "osm_way_ids"
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
    sourceUrl: source.toString(),
    retrievedAt: retrievedAt.toISOString(),
    wayIds,
    wayUrls,
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
    `SELECT d.id, d.name,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
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
        list_names: Array.isArray(row.list_names) ? row.list_names : [],
      },
    ])
  );
  const destination = places.get(args.destinationId);
  const trailhead = places.get(args.trailheadId);
  if (!destination) throw new Error("Destination was not found");
  if (!trailhead) throw new Error("Trailhead was not found");
  if (destination.list_names.length === 0) {
    throw new Error("Destination is not on a Peaks-owned list");
  }
  return { destination, trailhead };
}

async function buildTrack(
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
  const endOffset = haversineDistance(
    last[1],
    last[0],
    destination.lat,
    destination.lng
  );
  if (startOffset > 20 || endOffset > 20) {
    throw new Error(
      `Candidate endpoints do not match catalog places: ` +
        `${startOffset.toFixed(1)} m / ${endOffset.toFixed(1)} m`
    );
  }

  const elevationPoints = candidate.coordinates.map(([lng, lat]) => ({
    lat,
    lng,
  }));
  const elevations =
    process.env.PEAKS_ELEVATION_SOURCE === "usgs-3dep"
      ? await fetchUsgs3depElevations(elevationPoints)
      : await fetchMapboxElevations(elevationPoints);
  let distance = 0;
  return candidate.coordinates.map(([lng, lat], index) => {
    if (index > 0) {
      const prior = candidate.coordinates[index - 1];
      distance += haversineDistance(prior[1], prior[0], lat, lng);
    }
    return {
      lat,
      lng,
      ele: elevations[index],
      dist: Math.round(distance * 10) / 10,
    };
  });
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
  name: string
): Promise<void> {
  const conflict = await db.query(
    `SELECT r.id, r.name, r.status
     FROM route_destinations rd
     JOIN routes r ON r.id = rd.route_id
     WHERE rd.destination_id = $1
       AND r.owner = 'peaks'
       AND (
         r.status IN ('active', 'pending')
         OR lower(r.name) = lower($2)
       )
     LIMIT 1`,
    [destinationId, name]
  );
  if (conflict.rows.length > 0) {
    throw new Error(
      `A conflicting Peaks route exists: ${conflict.rows[0].name} ` +
      `(${conflict.rows[0].status}, ${conflict.rows[0].id})`
    );
  }
}

function provenance(candidate: Candidate) {
  return {
    source_kind: "openstreetmap",
    source_url: candidate.sourceUrl,
    license_name: OSM_LICENSE_NAME,
    license_url: OSM_LICENSE_URL,
    attribution: OSM_ATTRIBUTION,
    retrieved_at: candidate.retrievedAt,
    osm_way_ids: candidate.wayIds,
    osm_way_urls: candidate.wayUrls,
    contains_osm_geometry: true,
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
  const routeProvenance = provenance(candidate);
  const distance = Math.round(points[points.length - 1].dist);
  const client = await db.connect();

  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      `SELECT id FROM destinations WHERE id = ANY($1::text[]) FOR UPDATE`,
      [[args.destinationId, args.trailheadId]]
    );

    const conflict = await client.query(
      `SELECT r.id, r.name, r.status
       FROM route_destinations rd
       JOIN routes r ON r.id = rd.route_id
       WHERE rd.destination_id = $1
         AND r.owner = 'peaks'
         AND (r.status = 'active' OR lower(r.name) = lower($2))
       LIMIT 1`,
      [args.destinationId, args.name]
    );
    if (conflict.rows.length > 0) {
      throw new Error(
        `A conflicting route appeared during import: ${conflict.rows[0].id}`
      );
    }

    await client.query(
      `INSERT INTO routes (
         id, name, path, polyline6, owner, distance, gain, gain_loss,
         external_links, completion, shape, status, provenance
       )
       VALUES (
         $1, $2, ST_GeomFromText($3, 4326)::geography, $4, 'peaks',
         $5, $6, $7, $8::jsonb, 'none', 'out_and_back', 'pending',
         $9::jsonb
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
  const points = await buildTrack(candidate, destination, trailhead);
  const distance = points[points.length - 1].dist;
  const stats = computeElevationStats(points.map((point) => point.ele));
  if (distance < 1500) throw new Error("Route is shorter than 1,500 m");
  if (stats.gain < 200) throw new Error("Route gains less than 200 m");
  if (stats.loss > stats.gain * 1.5 && stats.loss > 100) {
    throw new Error("Route descends more than it climbs");
  }

  const wkt = pointsToLineStringZ(points);
  await assertNoConflict(args.destinationId, args.name);

  console.log(`Mode: ${args.apply ? "APPLY" : "DRY RUN"}`);
  console.log(
    `Route: ${trailhead.name} → ${destination.name}; ` +
      `${(distance / 1609.344).toFixed(2)} mi; ` +
      `+${Math.round(stats.gain * 3.28084)} ft; ` +
      `-${Math.round(stats.loss * 3.28084)} ft`
  );
  console.log(`Lists: ${destination.list_names.join(" | ")}`);
  console.log(
    `OSM: ${candidate.wayIds.length} ways; snaps ` +
      `${candidate.trailheadSnapM.toFixed(1)} m / ` +
      `${candidate.summitSnapM.toFixed(1)} m`
  );
  console.log(
    `Provenance: ${OSM_ATTRIBUTION}; ${OSM_LICENSE_NAME}; ` +
      candidate.retrievedAt
  );
  console.log(
    `Route sources: ${args.sourceLinks.map((link) => link.id).join(" | ")}`
  );
  console.log(
    `Elevations: ${
      process.env.PEAKS_ELEVATION_SOURCE === "usgs-3dep"
        ? "USGS 3DEP/NED"
        : "Mapbox Terrain-RGB"
    }`
  );

  if (!args.apply) {
    console.log("DRY RUN — no rows written");
    return;
  }
  const routeId = await createPendingRoute(
    args,
    candidate,
    points,
    stats
  );
  console.log(`Created pending route ${routeId}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
