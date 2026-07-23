/**
 * Audit and expand named route coverage for every summit destination.
 *
 * Sources:
 * - Explicitly named OSM hiking/foot route relations whose geometry comes
 *   within 250 m of a catalog summit.
 * - Public Peaks recordings whose user-supplied name identifies a summit
 *   reached by that recording.
 *
 * Dry-run is the default. Pass --apply to save the verified routes.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import db from "./db";
import {
  encodePolyline6,
  explicitOsmRouteName,
  isNamedPublicRecording,
  OsmRouteRelation,
  pointToPolylineDistanceMeters,
  RoutePoint,
  stitchOsmRouteChains,
} from "./route-coverage";

const ROUTE_REACH_METERS = 250;
const OSM_NODE_BATCH_SIZE = 100;
const COORDINATE_BATCH_SIZE = 25;
const MIN_ROUTE_METERS = 100;
const DEFAULT_CACHE_DIR = "/tmp/peaks-route-coverage/osm";
const DEFAULT_REPORT_PATH = "/tmp/peaks-route-coverage/report.json";
const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

interface CliOptions {
  apply: boolean;
  refresh: boolean;
  cacheDir: string;
  reportPath: string;
  batchLimit: number | null;
  concurrency: number;
}

interface Summit {
  id: string;
  name: string;
  lat: number;
  lng: number;
  osmId: string | null;
  covered: boolean;
}

interface PublicRecording {
  id: string;
  name: string;
  points: RoutePoint[];
  ewkt: string;
  distance: number | null;
  gain: number | null;
  gainLoss: number | null;
  summitIds: string[];
  summitNames: string[];
}

interface PreparedRoute {
  id: string;
  segmentId: string;
  name: string;
  points: RoutePoint[];
  ewkt: string;
  polyline6: string;
  distance: number | null;
  gain: number | null;
  gainLoss: number | null;
  externalLinks: Array<Record<string, string>>;
  destinationIds: string[];
  source: "osm" | "public_recording";
}

interface OverpassBatch {
  key: string;
  summits: Summit[];
  query: string;
  kind: "osm_node" | "coordinate";
}

interface OverpassResponse {
  elements?: Array<OsmRouteRelation | { type: string; id: number }>;
}

interface CoverageCounts {
  total: number;
  covered: number;
  unresolved: number;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  await fs.mkdir(options.cacheDir, { recursive: true });
  await fs.mkdir(path.dirname(options.reportPath), { recursive: true });

  const summits = await loadSummits();
  const before = summarizeCoverage(summits);
  const unresolved = summits.filter((summit) => !summit.covered);
  const allBatches = buildOverpassBatches(unresolved);
  const batches = allBatches.slice(
    0,
    options.batchLimit ?? Number.POSITIVE_INFINITY
  );
  const partial = batches.length < allBatches.length;

  console.log(
    `[route-audit] ${before.covered}/${before.total} summits already have a named saved route; ` +
    `${unresolved.length} unresolved`
  );
  console.log(
    `[route-audit] querying ${batches.length} OSM batches ` +
    `(${batches.filter((batch) => batch.kind === "osm_node").length} node, ` +
    `${batches.filter((batch) => batch.kind === "coordinate").length} coordinate)`
  );

  const relationCandidates = new Map<number, { relation: OsmRouteRelation; summits: Map<string, Summit> }>();
  const batchFailures: Array<{ key: string; error: string }> = [];
  let cachedBatches = 0;

  let nextBatchIndex = 0;
  const fetchWorker = async () => {
    while (nextBatchIndex < batches.length) {
      const index = nextBatchIndex++;
      const batch = batches[index];
      try {
        const result = await fetchOverpassBatch(batch, options);
        if (result.cached) cachedBatches++;
        for (const element of result.response.elements ?? []) {
          if (element.type !== "relation") continue;
          const relation = element as OsmRouteRelation;
          if (!explicitOsmRouteName(relation.tags)) continue;
          const current = relationCandidates.get(relation.id) ?? {
            relation,
            summits: new Map<string, Summit>(),
          };
          current.relation = relation;
          for (const summit of batch.summits) current.summits.set(summit.id, summit);
          relationCandidates.set(relation.id, current);
        }
        console.log(
          `[route-audit] OSM batch ${index + 1}/${batches.length}: ` +
          `${batch.summits.length} summits, ${result.response.elements?.length ?? 0} relations` +
          `${result.cached ? " (cache)" : ""}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        batchFailures.push({ key: batch.key, error: message });
        console.error(`[route-audit] OSM batch ${index + 1}/${batches.length} failed: ${message}`);
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(options.concurrency, batches.length) },
    () => fetchWorker()
  ));

  const osmRoutes = prepareOsmRoutes(relationCandidates);
  const publicRecordings = await loadPublicRecordings();
  const publicRoutes = preparePublicRecordingRoutes(
    publicRecordings,
    new Set(unresolved.map((summit) => summit.id))
  );
  const routes = dedupePreparedRoutes([...osmRoutes, ...publicRoutes]);
  const plannedDestinationIds = new Set(routes.flatMap((route) => route.destinationIds));

  let appliedRoutes = 0;
  let appliedLinks = 0;
  if (options.apply && batchFailures.length === 0) {
    const applied = await applyRoutes(routes);
    appliedRoutes = applied.routes;
    appliedLinks = applied.links;
  }

  const finalSummits = options.apply && batchFailures.length === 0
    ? await loadSummits()
    : summits.map((summit) => ({
      ...summit,
      covered: summit.covered || plannedDestinationIds.has(summit.id),
    }));
  const after = summarizeCoverage(finalSummits);
  const unresolvedRows = finalSummits
    .filter((summit) => !summit.covered)
    .map(({ id, name, lat, lng, osmId }) => ({ id, name, lat, lng, osmId }));

  const report = {
    generatedAt: new Date().toISOString(),
    apply: options.apply,
    status: batchFailures.length > 0 ? "failed" : partial ? "partial" : "complete",
    reachMeters: ROUTE_REACH_METERS,
    before,
    after,
    batches: {
      total: allBatches.length,
      requested: batches.length,
      cached: cachedBatches,
      failures: batchFailures,
    },
    osm: {
      relations: relationCandidates.size,
      preparedRoutes: osmRoutes.length,
      linkedSummits: new Set(osmRoutes.flatMap((route) => route.destinationIds)).size,
    },
    publicRecordings: {
      reviewed: publicRecordings.length,
      preparedRoutes: publicRoutes.length,
      linkedSummits: new Set(publicRoutes.flatMap((route) => route.destinationIds)).size,
    },
    planned: {
      routes: routes.length,
      links: routes.reduce((sum, route) => sum + route.destinationIds.length, 0),
      linkedSummits: plannedDestinationIds.size,
    },
    applied: {
      routes: appliedRoutes,
      links: appliedLinks,
    },
    unresolved: unresolvedRows,
  };

  await fs.writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `[route-audit] ${routes.length} verified named routes cover ${plannedDestinationIds.size} summits; ` +
    `${after.covered}/${after.total} covered, ${after.unresolved} unresolved`
  );
  console.log(`[route-audit] report: ${options.reportPath}`);

  if (batchFailures.length > 0) process.exitCode = 1;
}

function parseCliOptions(args: string[]): CliOptions {
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const limitValue = value("--batch-limit=");
  const concurrencyValue = value("--concurrency=");
  const batchLimit = limitValue == null ? null : Number.parseInt(limitValue, 10);
  const concurrency = concurrencyValue == null ? 4 : Number.parseInt(concurrencyValue, 10);
  if (batchLimit != null && (!Number.isFinite(batchLimit) || batchLimit < 1)) {
    throw new Error("--batch-limit must be a positive integer");
  }
  if (!Number.isFinite(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error("--concurrency must be an integer from 1 to 4");
  }
  return {
    apply: args.includes("--apply"),
    refresh: args.includes("--refresh"),
    cacheDir: value("--cache-dir=") ?? DEFAULT_CACHE_DIR,
    reportPath: value("--report=") ?? DEFAULT_REPORT_PATH,
    batchLimit,
    concurrency,
  };
}

async function loadSummits(): Promise<Summit[]> {
  const result = await db.query<{
    id: string;
    name: string;
    lat: number | string;
    lng: number | string;
    osm_id: string | null;
    covered: boolean;
  }>(
    `SELECT
       d.id,
       d.name,
       ST_Y(d.location::geometry) AS lat,
       ST_X(d.location::geometry) AS lng,
       d.external_ids->>'osm' AS osm_id,
       EXISTS (
         SELECT 1
         FROM route_destinations rd
         JOIN routes r ON r.id = rd.route_id
         WHERE rd.destination_id = d.id
           AND r.path IS NOT NULL
           AND nullif(btrim(r.name), '') IS NOT NULL
           AND r.status IN ('active', 'pending')
       ) AS covered
     FROM destinations d
     WHERE 'summit' = ANY(d.features)
       AND d.location IS NOT NULL
       AND nullif(btrim(d.name), '') IS NOT NULL
     ORDER BY d.country_code NULLS LAST, lat, lng, d.id`
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    lat: Number(row.lat),
    lng: Number(row.lng),
    osmId: normalizeOsmNodeId(row.osm_id),
    covered: row.covered,
  }));
}

function buildOverpassBatches(summits: Summit[]): OverpassBatch[] {
  const withNodes = summits.filter((summit) => summit.osmId);
  const withoutNodes = summits.filter((summit) => !summit.osmId);
  const batches: OverpassBatch[] = [];

  for (let index = 0; index < withNodes.length; index += OSM_NODE_BATCH_SIZE) {
    const batchSummits = withNodes.slice(index, index + OSM_NODE_BATCH_SIZE);
    const nodeIds = batchSummits.map((summit) => summit.osmId).join(",");
    const query =
      `[out:json][timeout:300];` +
      `node(id:${nodeIds})->.summits;` +
      `way(around.summits:${ROUTE_REACH_METERS})` +
      `["highway"~"^(path|footway|track|steps|pedestrian)$"]->.near;` +
      `rel(bw.near)["type"="route"]["route"~"^(hiking|foot)$"]["name"];` +
      `out body geom;`;
    batches.push(makeBatch("osm_node", batchSummits, query));
  }

  for (let index = 0; index < withoutNodes.length; index += COORDINATE_BATCH_SIZE) {
    const batchSummits = withoutNodes.slice(index, index + COORDINATE_BATCH_SIZE);
    const ways = batchSummits
      .map((summit) =>
        `way(around:${ROUTE_REACH_METERS},${summit.lat.toFixed(7)},${summit.lng.toFixed(7)})` +
        `["highway"~"^(path|footway|track|steps|pedestrian)$"];`
      )
      .join("");
    const query =
      `[out:json][timeout:300];(${ways})->.near;` +
      `rel(bw.near)["type"="route"]["route"~"^(hiking|foot)$"]["name"];` +
      `out body geom;`;
    batches.push(makeBatch("coordinate", batchSummits, query));
  }
  return batches;
}

function makeBatch(
  kind: OverpassBatch["kind"],
  summits: Summit[],
  query: string
): OverpassBatch {
  return {
    kind,
    summits,
    query,
    key: createHash("sha256").update(query).digest("hex").slice(0, 20),
  };
}

async function fetchOverpassBatch(
  batch: OverpassBatch,
  options: CliOptions
): Promise<{ response: OverpassResponse; cached: boolean }> {
  const cachePath = path.join(options.cacheDir, `${batch.kind}-${batch.key}.json`);
  if (!options.refresh) {
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, "utf8")) as OverpassResponse;
      return { response: cached, cached: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const errors: string[] = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 330_000);
      try {
        const body = new URLSearchParams({ data: batch.query });
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as OverpassResponse;
        if (!Array.isArray(payload.elements)) throw new Error("missing elements array");
        await fs.writeFile(cachePath, JSON.stringify(payload));
        return { response: payload, cached: false };
      } catch (error) {
        errors.push(
          `${endpoint} attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        clearTimeout(timeout);
      }
    }
  }
  throw new Error(errors.join("; "));
}

function prepareOsmRoutes(
  relationCandidates: Map<number, { relation: OsmRouteRelation; summits: Map<string, Summit> }>
): PreparedRoute[] {
  const routes: PreparedRoute[] = [];
  for (const { relation, summits } of relationCandidates.values()) {
    const name = explicitOsmRouteName(relation.tags);
    if (!name) continue;
    for (const chain of stitchOsmRouteChains(relation)) {
      if (chain.distanceMeters < MIN_ROUTE_METERS) continue;
      const destinationIds = [...summits.values()]
        .filter((summit) =>
          pointToPolylineDistanceMeters(summit, chain.points) <= ROUTE_REACH_METERS
        )
        .map((summit) => summit.id)
        .sort();
      if (destinationIds.length === 0) continue;

      const id = `osm-route-${relation.id}-${chain.key}`;
      routes.push({
        id,
        segmentId: `${id}-segment`,
        name,
        points: chain.points,
        ewkt: pointsToEwkt(chain.points),
        polyline6: encodePolyline6(chain.points),
        distance: Math.round(chain.distanceMeters),
        gain: null,
        gainLoss: null,
        externalLinks: [{ type: "osm", id: `relation/${relation.id}` }],
        destinationIds,
        source: "osm",
      });
    }
  }
  return routes;
}

async function loadPublicRecordings(): Promise<PublicRecording[]> {
  const result = await db.query<{
    id: string;
    name: string;
    geojson: { coordinates: number[][] } | string;
    ewkt: string;
    distance: number | string | null;
    gain: number | string | null;
    gain_loss: number | string | null;
    summit_ids: string[];
    summit_names: string[];
  }>(
    `SELECT
       s.id,
       s.name,
       ST_AsGeoJSON(s.path::geometry)::jsonb AS geojson,
       ST_AsEWKT(s.path::geometry) AS ewkt,
       s.distance,
       s.gain,
       NULL::double precision AS gain_loss,
       array_agg(DISTINCT d.id ORDER BY d.id) AS summit_ids,
       array_agg(DISTINCT d.name ORDER BY d.name) AS summit_names
     FROM tracking_sessions s
     JOIN session_destinations sd ON sd.session_id = s.id
     JOIN destinations d ON d.id = sd.destination_id
       AND 'summit' = ANY(d.features)
       AND ST_DWithin(d.location, s.path, $1)
     WHERE s.is_public = true
       AND s.path IS NOT NULL
       AND nullif(btrim(s.name), '') IS NOT NULL
     GROUP BY s.id, s.name, s.path, s.distance, s.gain
     ORDER BY s.id`,
    [ROUTE_REACH_METERS]
  );

  return result.rows.map((row) => {
    const geojson = typeof row.geojson === "string" ? JSON.parse(row.geojson) : row.geojson;
    return {
      id: row.id,
      name: row.name,
      points: geojson.coordinates.map((coordinate) => ({
        lng: Number(coordinate[0]),
        lat: Number(coordinate[1]),
      })),
      ewkt: row.ewkt,
      distance: nullableNumber(row.distance),
      gain: nullableNumber(row.gain),
      gainLoss: nullableNumber(row.gain_loss),
      summitIds: row.summit_ids,
      summitNames: row.summit_names,
    };
  });
}

function preparePublicRecordingRoutes(
  recordings: PublicRecording[],
  unresolvedDestinationIds: Set<string>
): PreparedRoute[] {
  return recordings.flatMap((recording) => {
    const destinationIds = recording.summitIds.filter((id) => unresolvedDestinationIds.has(id));
    if (
      recording.points.length < 2 ||
      destinationIds.length === 0 ||
      !isNamedPublicRecording(recording.name, recording.summitNames)
    ) {
      return [];
    }
    const id = `public-recording-${recording.id}`;
    return [{
      id,
      segmentId: `${id}-segment`,
      name: recording.name.trim(),
      points: recording.points,
      ewkt: recording.ewkt,
      polyline6: encodePolyline6(recording.points),
      distance: recording.distance,
      gain: recording.gain,
      gainLoss: recording.gainLoss,
      externalLinks: [{ type: "peaks_session", id: recording.id }],
      destinationIds,
      source: "public_recording" as const,
    }];
  });
}

function dedupePreparedRoutes(routes: PreparedRoute[]): PreparedRoute[] {
  const byId = new Map<string, PreparedRoute>();
  for (const route of routes) {
    const current = byId.get(route.id);
    if (!current) {
      byId.set(route.id, route);
      continue;
    }
    current.destinationIds = [...new Set([
      ...current.destinationIds,
      ...route.destinationIds,
    ])].sort();
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

async function applyRoutes(
  routes: PreparedRoute[]
): Promise<{ routes: number; links: number }> {
  if (routes.length === 0) return { routes: 0, links: 0 };
  const client = await db.connect();
  let routeCount = 0;
  let linkCount = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('peaks-route-coverage-import'))");
    for (const route of routes) {
      await client.query(
        `INSERT INTO segments (
           id, name, path, polyline6, distance, gain, gain_loss
         ) VALUES (
           $1, $2, ST_GeomFromEWKT($3)::geography, $4, $5, $6, $7
         )
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           path = EXCLUDED.path,
           polyline6 = EXCLUDED.polyline6,
           distance = EXCLUDED.distance,
           gain = EXCLUDED.gain,
           gain_loss = EXCLUDED.gain_loss,
           updated_at = now()`,
        [
          route.segmentId,
          route.name,
          route.ewkt,
          route.polyline6,
          route.distance,
          route.gain,
          route.gainLoss,
        ]
      );
      await client.query(
        `INSERT INTO routes (
           id, name, path, polyline6, owner, distance, gain, gain_loss,
           external_links, completion, status
         ) VALUES (
           $1, $2, ST_GeomFromEWKT($3)::geography, $4, 'peaks', $5, $6, $7,
           $8::jsonb, 'none', 'active'
         )
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           path = EXCLUDED.path,
           polyline6 = EXCLUDED.polyline6,
           distance = EXCLUDED.distance,
           gain = EXCLUDED.gain,
           gain_loss = EXCLUDED.gain_loss,
           external_links = EXCLUDED.external_links,
           status = 'active',
           updated_at = now()`,
        [
          route.id,
          route.name,
          route.ewkt,
          route.polyline6,
          route.distance,
          route.gain,
          route.gainLoss,
          JSON.stringify(route.externalLinks),
        ]
      );
      await client.query(
        `INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
         VALUES ($1, $2, 0, 'forward')
         ON CONFLICT (route_id, segment_id, ordinal) DO UPDATE SET direction = 'forward'`,
        [route.id, route.segmentId]
      );
      for (let index = 0; index < route.destinationIds.length; index++) {
        const result = await client.query(
          `INSERT INTO route_destinations (route_id, destination_id, ordinal)
           VALUES ($1, $2, $3)
           ON CONFLICT (route_id, destination_id) DO UPDATE SET ordinal = EXCLUDED.ordinal
           RETURNING route_id`,
          [route.id, route.destinationIds[index], index]
        );
        linkCount += result.rowCount ?? 0;
      }
      routeCount++;
    }
    await client.query("COMMIT");
    return { routes: routeCount, links: linkCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function summarizeCoverage(summits: Summit[]): CoverageCounts {
  const covered = summits.filter((summit) => summit.covered).length;
  return {
    total: summits.length,
    covered,
    unresolved: summits.length - covered,
  };
}

function normalizeOsmNodeId(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(?:node\/)?(\d+)$/);
  return match?.[1] ?? null;
}

function nullableNumber(value: number | string | null): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pointsToEwkt(points: RoutePoint[]): string {
  return `SRID=4326;LINESTRING Z(${points
    .map((point) => `${point.lng} ${point.lat} 0`)
    .join(",")})`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
