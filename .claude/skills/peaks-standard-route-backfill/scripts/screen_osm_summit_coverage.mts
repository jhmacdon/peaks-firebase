import process from "node:process";

type Target = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

type OsmWay = {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};

const walkableHighways =
  "^(path|footway|steps|pedestrian|track|service|unclassified|residential)$";

function valueAfter(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? "" : "";
}

function positiveInteger(
  argv: string[],
  flag: string,
  fallback: number
): number {
  const raw = valueAfter(argv, flag);
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function pointToSegmentMeters(
  point: [number, number],
  start: [number, number],
  end: [number, number]
): number {
  const meanLatitudeRadians =
    (((point[1] + start[1] + end[1]) / 3) * Math.PI) / 180;
  const xScale = 111320 * Math.cos(meanLatitudeRadians);
  const yScale = 110540;
  const px = (point[0] - start[0]) * xScale;
  const py = (point[1] - start[1]) * yScale;
  const ex = (end[0] - start[0]) * xScale;
  const ey = (end[1] - start[1]) * yScale;
  const lengthSquared = ex * ex + ey * ey;
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, (px * ex + py * ey) / lengthSquared));
  return Math.hypot(px - fraction * ex, py - fraction * ey);
}

function distanceToWay(target: Target, way: OsmWay): number {
  const geometry = way.geometry ?? [];
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < geometry.length; index += 1) {
    nearest = Math.min(
      nearest,
      pointToSegmentMeters(
        [target.lng, target.lat],
        [geometry[index - 1].lon, geometry[index - 1].lat],
        [geometry[index].lon, geometry[index].lat]
      )
    );
  }
  return nearest;
}

function footBlocked(tags: Record<string, string>): boolean {
  const footAllows = ["yes", "designated", "permissive"].includes(
    tags.foot ?? ""
  );
  return (
    ["no", "private"].includes(tags.foot ?? "") ||
    (["no", "private"].includes(tags.access ?? "") && !footAllows)
  );
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

async function fetchMapWays(
  target: Target,
  radiusM: number
): Promise<OsmWay[]> {
  const latDelta = radiusM / 111320;
  const lngDelta =
    radiusM / (111320 * Math.cos((target.lat * Math.PI) / 180));
  const bounds = [
    target.lng - lngDelta,
    target.lat - latDelta,
    target.lng + lngDelta,
    target.lat + latDelta,
  ].join(",");
  const response = await fetch(
    `https://api.openstreetmap.org/api/0.6/map?bbox=${bounds}`,
    {
      headers: {
        "user-agent":
          process.env.PEAKS_OVERPASS_USER_AGENT ??
          "Peaks route coverage screen/1.0",
      },
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!response.ok) {
    throw new Error(`OSM map API returned HTTP ${response.status}`);
  }
  const xml = await response.text();
  const nodes = new Map<number, { lat: number; lon: number }>();
  for (const match of xml.matchAll(
    /<node\b[^>]*\bid="(\d+)"[^>]*\blat="(-?\d+(?:\.\d+)?)"[^>]*\blon="(-?\d+(?:\.\d+)?)"[^>]*\/?>/g
  )) {
    nodes.set(Number(match[1]), {
      lat: Number(match[2]),
      lon: Number(match[3]),
    });
  }
  const ways: OsmWay[] = [];
  for (const match of xml.matchAll(
    /<way\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/way>/g
  )) {
    const body = match[2];
    const tags = Object.fromEntries(
      [...body.matchAll(
        /<tag\b[^>]*\bk="([^"]+)"[^>]*\bv="([^"]*)"[^>]*\/>/g
      )].map((tag) => [decodeXml(tag[1]), decodeXml(tag[2])])
    );
    if (!new RegExp(walkableHighways).test(tags.highway ?? "")) continue;
    const geometry = [
      ...body.matchAll(/<nd\b[^>]*\bref="(\d+)"[^>]*\/>/g),
    ]
      .map((node) => nodes.get(Number(node[1])))
      .filter(
        (node): node is { lat: number; lon: number } => node !== undefined
      );
    if (geometry.length < 2) continue;
    ways.push({
      type: "way",
      id: Number(match[1]),
      tags,
      geometry,
    });
  }
  return ways;
}

async function fetchWays(
  targets: Target[],
  radiusM: number
): Promise<OsmWay[]> {
  const clauses = targets
    .map(
      ({ lat, lng }) =>
        `way(around:${radiusM},${lat},${lng})` +
        `["highway"~"${walkableHighways}"];`
    )
    .join("");
  const query = `[out:json][timeout:60];(${clauses});out tags geom;`;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  let lastStatus = 0;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent":
            process.env.PEAKS_OVERPASS_USER_AGENT ??
            "Peaks route coverage screen/1.0",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(20000),
      });
      lastStatus = response.status;
      if (!response.ok) continue;
      const payload = (await response.json()) as { elements?: OsmWay[] };
      return (payload.elements ?? []).filter(
        (element): element is OsmWay =>
          element.type === "way" && (element.geometry?.length ?? 0) >= 2
      );
    } catch {
      lastStatus = 0;
    }
  }
  const fallback: OsmWay[] = [];
  let fallbackSucceeded = false;
  for (const target of targets) {
    let fetched = false;
    for (let attempt = 0; attempt < 2 && !fetched; attempt += 1) {
      try {
        fallback.push(...await fetchMapWays(target, radiusM));
        fetched = true;
        fallbackSucceeded = true;
      } catch (error) {
        if (attempt === 1) {
          console.error(
            `OSM lookup failed for ${target.id}: ` +
              (error instanceof Error ? error.message : String(error))
          );
        }
      }
    }
  }
  if (fallbackSucceeded) return fallback;
  throw new Error(
    `Overpass endpoints returned HTTP ${lastStatus}; OSM map fallback was empty`
  );
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    "Usage: audit-standard-route-goal.sh --format tsv --missing-only ... | " +
      "tsx screen_osm_summit_coverage.mts " +
      "[--radius-m 300] [--batch-size 20] [--limit N]"
  );
  process.exit(0);
}
const radiusM = positiveInteger(argv, "--radius-m", 300);
const batchSize = positiveInteger(argv, "--batch-size", 20);
const limit = positiveInteger(argv, "--limit", 100000);
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  input += chunk;
}
const lines = input.trim().split(/\r?\n/);
const headers = lines[0]?.split("\t") ?? [];
const index = Object.fromEntries(headers.map((header, position) => [header, position]));
for (const required of ["destination_id", "name", "lat", "lng"]) {
  if (index[required] === undefined) {
    throw new Error(`Missing TSV column: ${required}`);
  }
}
const targets = lines
  .slice(1)
  .map((line) => line.split("\t"))
  .map((columns) => ({
    id: columns[index.destination_id],
    name: columns[index.name],
    lat: Number(columns[index.lat]),
    lng: Number(columns[index.lng]),
  }))
  .filter(
    ({ id, name, lat, lng }) =>
      Boolean(id && name) && Number.isFinite(lat) && Number.isFinite(lng)
  )
  .slice(0, limit);

console.log(
  [
    "destination_id",
    "name",
    "nearest_m",
    "osm_way_id",
    "highway",
    "way_name",
    "access",
    "foot",
    "foot_blocked",
  ].join("\t")
);
for (let offset = 0; offset < targets.length; offset += batchSize) {
  const batch = targets.slice(offset, offset + batchSize);
  const ways = await fetchWays(batch, radiusM);
  for (const target of batch) {
    const candidates = ways
      .map((way) => ({ way, distance: distanceToWay(target, way) }))
      .filter(({ distance }) => distance <= radiusM)
      .sort((left, right) => left.distance - right.distance);
    const nearest = candidates[0];
    const tags = nearest?.way.tags ?? {};
    console.log(
      [
        target.id,
        target.name,
        nearest ? nearest.distance.toFixed(1) : "",
        nearest?.way.id ?? "",
        tags.highway ?? "",
        tags.name ?? "",
        tags.access ?? "",
        tags.foot ?? "",
        nearest ? String(footBlocked(tags)) : "",
      ].join("\t")
    );
  }
}
