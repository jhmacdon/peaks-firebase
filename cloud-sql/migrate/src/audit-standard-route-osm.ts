/**
 * Rank listed summits without a current Peaks route by nearby OSM path
 * geometry and saved trailhead access.
 *
 * This is a read-only research aid. It never writes Cloud SQL or OSM data.
 *
 * Usage:
 *   npx tsx src/audit-standard-route-osm.ts --state=WA
 *   npx tsx src/audit-standard-route-osm.ts --list="Colorado 14ers"
 */

import db from "./db";
import {
  pointToPolylineDistanceMeters,
  RoutePoint,
} from "./route-coverage";

const OSM_REACH_METERS = 250;
const TRAILHEAD_SEARCH_METERS = 25_000;
const BATCH_SIZE = 20;
const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

interface Options {
  state: string | null;
  list: string | null;
  format: "tsv" | "json";
}

interface Candidate {
  id: string;
  name: string;
  stateCode: string | null;
  lat: number;
  lng: number;
  listNames: string[];
  trailheads: Array<{
    id: string;
    name: string;
    distanceM: number;
  }>;
}

interface OsmWay {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

interface RankedCandidate extends Candidate {
  osmWays: Array<{
    id: number;
    distanceM: number;
    name: string | null;
    highway: string | null;
  }>;
}

function parseOptions(args: string[]): Options {
  const value = (prefix: string) =>
    args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const format = value("--format=") ?? "tsv";
  if (format !== "tsv" && format !== "json") {
    throw new Error("--format must be tsv or json");
  }
  const state = value("--state=")?.trim().toUpperCase() || null;
  if (state && !/^[A-Z0-9]{2}$/.test(state)) {
    throw new Error("--state must be a two-character catalog state code");
  }
  return {
    state,
    list: value("--list=")?.trim() || null,
    format,
  };
}

async function loadCandidates(options: Options): Promise<Candidate[]> {
  const result = await db.query<{
    id: string;
    name: string;
    state_code: string | null;
    lat: number | string;
    lng: number | string;
    list_names: string[];
    trailheads: Array<{
      id: string;
      name: string;
      distance_m: number | string;
    }>;
  }>(
    `WITH gaps AS (
       SELECT d.id,
              d.name,
              d.state_code,
              d.location,
              array_agg(DISTINCT l.name ORDER BY l.name) AS list_names
       FROM destinations d
       JOIN list_destinations ld ON ld.destination_id = d.id
       JOIN lists l ON l.id = ld.list_id AND l.owner = 'peaks'
       WHERE 'summit'::destination_feature = ANY(d.features)
         AND ($1::text IS NULL OR d.state_code = $1)
         AND ($2::text IS NULL OR l.id = $2 OR l.name ILIKE '%' || $2 || '%')
         AND NOT EXISTS (
           SELECT 1
           FROM route_destinations rd
           JOIN routes r ON r.id = rd.route_id
           WHERE rd.destination_id = d.id
             AND r.owner = 'peaks'
             AND r.status IN ('active', 'pending')
         )
       GROUP BY d.id
     )
     SELECT g.id,
            g.name,
            g.state_code,
            ST_Y(g.location::geometry) AS lat,
            ST_X(g.location::geometry) AS lng,
            g.list_names,
            COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', nearest.id,
                    'name', nearest.name,
                    'distance_m', nearest.distance_m
                  )
                  ORDER BY nearest.distance_m, nearest.id
                )
                FROM (
                  SELECT th.id,
                         th.name,
                         round(ST_Distance(g.location, th.location))::int AS distance_m
                  FROM destinations th
                  WHERE 'trailhead'::destination_feature = ANY(th.features)
                    AND ST_DWithin(g.location, th.location, $3)
                  ORDER BY ST_Distance(g.location, th.location), th.id
                  LIMIT 3
                ) nearest
              ),
              '[]'::jsonb
            ) AS trailheads
     FROM gaps g
     ORDER BY g.state_code NULLS LAST, g.name, g.id`,
    [options.state, options.list, TRAILHEAD_SEARCH_METERS]
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    stateCode: row.state_code,
    lat: Number(row.lat),
    lng: Number(row.lng),
    listNames: row.list_names,
    trailheads: row.trailheads.map((trailhead) => ({
      id: trailhead.id,
      name: trailhead.name,
      distanceM: Number(trailhead.distance_m),
    })),
  }));
}

function buildQuery(candidates: Candidate[]): string {
  const clauses = candidates
    .map(
      (candidate) =>
        `way(around:${OSM_REACH_METERS},${candidate.lat.toFixed(7)},` +
        `${candidate.lng.toFixed(7)})` +
        `["highway"~"^(path|footway|track|steps|pedestrian)$"];`
    )
    .join("");
  return `[out:json][timeout:120];(${clauses});out body geom;`;
}

async function fetchWays(candidates: Candidate[]): Promise<OsmWay[]> {
  const query = buildQuery(candidates);
  const errors: string[] = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 150_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "Peaks standard route coverage audit/1.0",
        },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as {
        remark?: string;
        elements?: OsmWay[];
      };
      if (payload.remark) throw new Error(payload.remark);
      if (!Array.isArray(payload.elements)) {
        throw new Error("missing elements");
      }
      return payload.elements.filter(
        (element) =>
          element.type === "way" &&
          Array.isArray(element.geometry) &&
          element.geometry.length >= 2
      );
    } catch (error) {
      errors.push(
        `${endpoint}: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(errors.join("; "));
}

function rankCandidate(candidate: Candidate, ways: OsmWay[]): RankedCandidate {
  const osmWays = ways
    .map((way) => {
      const points: RoutePoint[] = way.geometry!.map((point) => ({
        lat: point.lat,
        lng: point.lon,
      }));
      return {
        id: way.id,
        distanceM: pointToPolylineDistanceMeters(candidate, points),
        name: way.tags?.name?.trim() || null,
        highway: way.tags?.highway ?? null,
      };
    })
    .filter((way) => way.distanceM <= OSM_REACH_METERS)
    .sort((left, right) => left.distanceM - right.distanceM || left.id - right.id)
    .slice(0, 5);
  return { ...candidate, osmWays };
}

function printTsv(candidates: RankedCandidate[]): void {
  console.log([
    "destination_id",
    "destination_name",
    "state_code",
    "lists",
    "nearest_osm_m",
    "osm_way_ids",
    "osm_way_names",
    "trailhead_id",
    "trailhead_name",
    "trailhead_distance_m",
  ].join("\t"));
  for (const candidate of candidates) {
    const trailhead = candidate.trailheads[0];
    console.log([
      candidate.id,
      candidate.name,
      candidate.stateCode ?? "",
      candidate.listNames.join(" | "),
      Math.round(candidate.osmWays[0].distanceM),
      candidate.osmWays.map((way) => way.id).join(","),
      candidate.osmWays.map((way) => way.name ?? "unnamed").join(" | "),
      trailhead?.id ?? "",
      trailhead?.name ?? "",
      trailhead?.distanceM ?? "",
    ].join("\t"));
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const candidates = await loadCandidates(options);
  const ranked: RankedCandidate[] = [];

  for (let index = 0; index < candidates.length; index += BATCH_SIZE) {
    const batch = candidates.slice(index, index + BATCH_SIZE);
    const ways = await fetchWays(batch);
    ranked.push(...batch.map((candidate) => rankCandidate(candidate, ways)));
    console.error(
      `[standard-route-osm] ${Math.min(index + batch.length, candidates.length)}/` +
      `${candidates.length}`
    );
  }

  const useful = ranked
    .filter((candidate) => candidate.osmWays.length > 0)
    .sort(
      (left, right) =>
        Number(right.osmWays.some((way) => way.name)) -
          Number(left.osmWays.some((way) => way.name)) ||
        Number(right.trailheads.length > 0) -
          Number(left.trailheads.length > 0) ||
        left.osmWays[0].distanceM - right.osmWays[0].distanceM ||
        left.name.localeCompare(right.name)
    );

  if (options.format === "json") {
    console.log(JSON.stringify(useful, null, 2));
  } else {
    printTsv(useful);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
