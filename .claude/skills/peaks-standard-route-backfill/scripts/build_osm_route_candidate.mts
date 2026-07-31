import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import dbImport from "../../../../cloud-sql/migrate/src/db";

const db =
  typeof (dbImport as { query?: unknown }).query === "function"
    ? dbImport
    : (dbImport as unknown as { default: typeof dbImport }).default;

type Options = {
  destinationId: string;
  trailheadId: string;
  trailheadName: string;
  trailheadLat: number | null;
  trailheadLng: number | null;
  radiusM: number;
  corridorPaddingM: number | null;
  snapM: number;
  wayIds: number[];
  referencePath: string;
  referenceStartPoint: number;
  referenceMaxPoints: number;
  format: "summary" | "geojson";
  outputPath: string;
};

type OsmNode = {
  type: "node";
  id: number;
  lat: number;
  lon: number;
};

type OsmWay = {
  type: "way";
  id: number;
  nodes?: number[];
  tags?: Record<string, string>;
};

type GraphEdge = {
  to: number;
  distance: number;
  cost: number;
  wayId: number;
  wayName: string | null;
};

type PlaceRow = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

type Bounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

const walkableHighways = new Set([
  "path",
  "footway",
  "steps",
  "pedestrian",
  "track",
  "service",
  "unclassified",
  "residential",
]);

function usage(): string {
  return [
    "Usage:",
    "  tsx build_osm_route_candidate.mts \\",
    "    --destination-id ID \\",
    "    (--trailhead-id ID | --trailhead-name NAME \\",
    "      --trailhead-lat LAT --trailhead-lng LNG) \\",
    "    [--radius-m 5000 | --corridor-padding-m 3000] \\",
    "    [--snap-m 300] [--way-ids ID,ID,...] \\",
    "    [--reference route.gpx] [--reference-start-point N] \\",
    "    [--reference-max-points N] \\",
    "    [--format summary|geojson] [--output candidate.geojson]",
    "",
    "Builds a review candidate along connected OpenStreetMap paths.",
    "Pass exact researched way IDs to avoid a broad Overpass query.",
    "It does not write Cloud SQL.",
  ].join("\n");
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    destinationId: "",
    trailheadId: "",
    trailheadName: "",
    trailheadLat: null,
    trailheadLng: null,
    radiusM: 5000,
    corridorPaddingM: null,
    snapM: 300,
    wayIds: [],
    referencePath: "",
    referenceStartPoint: 0,
    referenceMaxPoints: Number.POSITIVE_INFINITY,
    format: "summary",
    outputPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1] ?? "";
    if (arg === "--destination-id") {
      options.destinationId = value;
      index += 1;
    } else if (arg === "--trailhead-id") {
      options.trailheadId = value;
      index += 1;
    } else if (arg === "--trailhead-name") {
      options.trailheadName = value;
      index += 1;
    } else if (arg === "--trailhead-lat") {
      options.trailheadLat = Number(value);
      index += 1;
    } else if (arg === "--trailhead-lng") {
      options.trailheadLng = Number(value);
      index += 1;
    } else if (arg === "--radius-m") {
      options.radiusM = Number(value);
      index += 1;
    } else if (arg === "--corridor-padding-m") {
      options.corridorPaddingM = Number(value);
      index += 1;
    } else if (arg === "--snap-m") {
      options.snapM = Number(value);
      index += 1;
    } else if (arg === "--way-ids") {
      options.wayIds = value
        .split(",")
        .filter(Boolean)
        .map(Number);
      index += 1;
    } else if (arg === "--reference") {
      options.referencePath = value;
      index += 1;
    } else if (arg === "--reference-start-point") {
      options.referenceStartPoint = Number(value);
      index += 1;
    } else if (arg === "--reference-max-points") {
      options.referenceMaxPoints = Number(value);
      index += 1;
    } else if (arg === "--format") {
      if (value !== "summary" && value !== "geojson") {
        throw new Error("--format must be summary or geojson");
      }
      options.format = value;
      index += 1;
    } else if (arg === "--output") {
      options.outputPath = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!/^[A-Za-z0-9_-]+$/.test(options.destinationId)) {
    throw new Error(
      "--destination-id is required and contains unsupported characters"
    );
  }
  if (
    options.trailheadId &&
    !/^[A-Za-z0-9_-]+$/.test(options.trailheadId)
  ) {
    throw new Error("--trailhead-id contains unsupported characters");
  }
  const hasDirectTrailhead =
    options.trailheadName.trim().length > 0 &&
    options.trailheadLat !== null &&
    Number.isFinite(options.trailheadLat) &&
    options.trailheadLat >= -90 &&
    options.trailheadLat <= 90 &&
    options.trailheadLng !== null &&
    Number.isFinite(options.trailheadLng) &&
    options.trailheadLng >= -180 &&
    options.trailheadLng <= 180;
  if (!options.trailheadId && !hasDirectTrailhead) {
    throw new Error(
      "Provide --trailhead-id or a valid --trailhead-name/lat/lng set"
    );
  }
  if (!Number.isInteger(options.radiusM) || options.radiusM < 500 || options.radiusM > 20000) {
    throw new Error("--radius-m must be an integer from 500 to 20000");
  }
  if (
    options.corridorPaddingM !== null &&
    (
      !Number.isInteger(options.corridorPaddingM) ||
      options.corridorPaddingM < 500 ||
      options.corridorPaddingM > 10000
    )
  ) {
    throw new Error("--corridor-padding-m must be an integer from 500 to 10000");
  }
  if (!Number.isInteger(options.snapM) || options.snapM < 10 || options.snapM > 1000) {
    throw new Error("--snap-m must be an integer from 10 to 1000");
  }
  if (
    options.wayIds.some(
      (wayId) => !Number.isSafeInteger(wayId) || wayId <= 0
    )
  ) {
    throw new Error("--way-ids must be a comma-separated list of positive integers");
  }
  if (
    !Number.isInteger(options.referenceStartPoint) ||
    options.referenceStartPoint < 0
  ) {
    throw new Error("--reference-start-point must be a non-negative integer");
  }
  if (
    options.referenceMaxPoints !== Number.POSITIVE_INFINITY &&
    (
      !Number.isInteger(options.referenceMaxPoints) ||
      options.referenceMaxPoints < 2
    )
  ) {
    throw new Error("--reference-max-points must be an integer of at least 2");
  }
  if (options.outputPath && options.format !== "geojson") {
    throw new Error("--output requires --format geojson");
  }
  return options;
}

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const earthRadiusM = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function referenceMatcher(
  options: Options
): Promise<((lat: number, lng: number) => number) | null> {
  if (!options.referencePath) return null;
  const gpx = await readFile(options.referencePath, "utf8");
  const points = [...gpx.matchAll(
    /<(?:trkpt|rtept)\b[^>]*\blat="(-?\d+(?:\.\d+)?)"[^>]*\blon="(-?\d+(?:\.\d+)?)"/gi
  )]
    .slice(
      options.referenceStartPoint,
      options.referenceStartPoint + options.referenceMaxPoints
    )
    .map((match) => ({
      lat: Number(match[1]),
      lng: Number(match[2]),
    }));
  if (points.length < 2) {
    throw new Error("--reference does not contain enough selected track points");
  }
  return (lat: number, lng: number) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (const point of points) {
      nearest = Math.min(
        nearest,
        haversineMeters(lat, lng, point.lat, point.lng)
      );
    }
    return nearest;
  };
}

function corridorBoundingBox(
  trailhead: PlaceRow,
  destination: PlaceRow,
  paddingM: number
): Bounds {
  const meanLatRadians =
    ((trailhead.lat + destination.lat) / 2) * Math.PI / 180;
  const latPadding = paddingM / 111_320;
  const lngPadding =
    paddingM / (111_320 * Math.max(Math.cos(meanLatRadians), 0.1));
  return {
    south: Math.min(trailhead.lat, destination.lat) - latPadding,
    west: Math.min(trailhead.lng, destination.lng) - lngPadding,
    north: Math.max(trailhead.lat, destination.lat) + latPadding,
    east: Math.max(trailhead.lng, destination.lng) + lngPadding,
  };
}

function overpassBoundingBox(
  trailhead: PlaceRow,
  destination: PlaceRow,
  paddingM: number
): string {
  const bounds = corridorBoundingBox(trailhead, destination, paddingM);
  return [bounds.south, bounds.west, bounds.north, bounds.east]
    .map((coordinate) => coordinate.toFixed(7))
    .join(",");
}

function osmMapBoundingBox(bounds: Bounds): string {
  return [bounds.west, bounds.south, bounds.east, bounds.north]
    .map((coordinate) => coordinate.toFixed(7))
    .join(",");
}

function edgePenalty(tags: Record<string, string>): number {
  if (tags.highway === "track") return 1.3;
  if (tags.highway === "footway") return 1.05;
  if (tags.highway === "service") return 1.7;
  if (
    tags.highway === "unclassified" ||
    tags.highway === "residential"
  ) {
    return 2;
  }
  return 1;
}

function mergeElements(
  elementSets: Array<Array<OsmNode | OsmWay>>
): Array<OsmNode | OsmWay> {
  const unique = new Map<string, OsmNode | OsmWay>();
  for (const element of elementSets.flat()) {
    unique.set(`${element.type}:${element.id}`, element);
  }
  return [...unique.values()];
}

function splitBounds(bounds: Bounds): [Bounds, Bounds] {
  const latSpan = bounds.north - bounds.south;
  const lngSpan = bounds.east - bounds.west;
  if (lngSpan >= latSpan) {
    const middle = (bounds.west + bounds.east) / 2;
    return [
      { ...bounds, east: middle },
      { ...bounds, west: middle },
    ];
  }
  const middle = (bounds.south + bounds.north) / 2;
  return [
    { ...bounds, north: middle },
    { ...bounds, south: middle },
  ];
}

async function fetchOsmMapElements(
  osmApiUrl: string,
  bounds: Bounds,
  userAgent: string,
  depth = 0
): Promise<Array<OsmNode | OsmWay>> {
  const response = await fetch(
    `${osmApiUrl}/map.json?bbox=${osmMapBoundingBox(bounds)}`,
    { headers: { "user-agent": userAgent } }
  );
  if (response.ok) {
    const payload = (await response.json()) as {
      elements: Array<OsmNode | OsmWay>;
    };
    if (!Array.isArray(payload.elements)) {
      throw new Error("OSM map API response has no elements array");
    }
    return payload.elements;
  }
  if ([400, 509].includes(response.status) && depth < 4) {
    const parts = splitBounds(bounds);
    const elementSets = await Promise.all(
      parts.map((part) =>
        fetchOsmMapElements(osmApiUrl, part, userAgent, depth + 1)
      )
    );
    return mergeElements(elementSets);
  }
  throw new Error(`OSM map API returned HTTP ${response.status}`);
}

function nearestNode(
  place: PlaceRow,
  nodes: Map<number, OsmNode>
): { id: number; distance: number } {
  let bestId = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes.values()) {
    const distance = haversineMeters(place.lat, place.lng, node.lat, node.lon);
    if (distance < bestDistance) {
      bestId = node.id;
      bestDistance = distance;
    }
  }
  return { id: bestId, distance: bestDistance };
}

function nearestConnectedNodes(
  trailhead: PlaceRow,
  destination: PlaceRow,
  nodes: Map<number, OsmNode>,
  graph: Map<number, GraphEdge[]>,
  snapM: number
): {
  start: { id: number; distance: number };
  finish: { id: number; distance: number };
} {
  const componentByNode = new Map<number, number>();
  let componentId = 0;
  for (const nodeId of graph.keys()) {
    if (componentByNode.has(nodeId)) continue;
    componentId += 1;
    const stack = [nodeId];
    componentByNode.set(nodeId, componentId);
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const edge of graph.get(current) ?? []) {
        if (!componentByNode.has(edge.to)) {
          componentByNode.set(edge.to, componentId);
          stack.push(edge.to);
        }
      }
    }
  }

  const candidates = (place: PlaceRow) =>
    [...graph.keys()]
      .map((id) => {
        const node = nodes.get(id)!;
        return {
          id,
          distance: haversineMeters(place.lat, place.lng, node.lat, node.lon),
          component: componentByNode.get(id)!,
        };
      })
      .filter((candidate) => candidate.distance <= snapM)
      .sort((left, right) => left.distance - right.distance);

  const starts = candidates(trailhead);
  const finishes = candidates(destination);
  let best:
    | {
        start: { id: number; distance: number };
        finish: { id: number; distance: number };
        score: number;
      }
    | undefined;

  for (const start of starts) {
    for (const finish of finishes) {
      if (start.component !== finish.component) continue;
      const score = start.distance + finish.distance;
      if (!best || score < best.score) {
        best = {
          start: { id: start.id, distance: start.distance },
          finish: { id: finish.id, distance: finish.distance },
          score,
        };
      }
    }
  }

  if (best) return best;

  const nearestStart = nearestNode(trailhead, nodes);
  const nearestFinish = nearestNode(destination, nodes);
  throw new Error(
    `No shared OSM path component within --snap-m; nearest trailhead ` +
      `${Math.round(nearestStart.distance)} m, summit ${Math.round(nearestFinish.distance)} m`
  );
}

function shortestPath(
  graph: Map<number, GraphEdge[]>,
  startId: number,
  endId: number
): { nodeIds: number[]; edges: GraphEdge[] } {
  const distances = new Map<number, number>([[startId, 0]]);
  const previous = new Map<number, { nodeId: number; edge: GraphEdge }>();
  const queue: Array<{ id: number; cost: number }> = [{ id: startId, cost: 0 }];
  const visited = new Set<number>();

  while (queue.length > 0) {
    queue.sort((left, right) => left.cost - right.cost);
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    if (current.id === endId) break;

    for (const edge of graph.get(current.id) ?? []) {
      if (visited.has(edge.to)) continue;
      const nextCost = current.cost + edge.cost;
      if (nextCost < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.to, nextCost);
        previous.set(edge.to, { nodeId: current.id, edge });
        queue.push({ id: edge.to, cost: nextCost });
      }
    }
  }

  if (!previous.has(endId) && startId !== endId) {
    throw new Error("No connected OSM path found between the snapped endpoints");
  }

  const reversedNodes = [endId];
  const reversedEdges: GraphEdge[] = [];
  let current = endId;
  while (current !== startId) {
    const step = previous.get(current);
    if (!step) throw new Error("OSM path reconstruction failed");
    reversedEdges.push(step.edge);
    current = step.nodeId;
    reversedNodes.push(current);
  }

  return {
    nodeIds: reversedNodes.reverse(),
    edges: reversedEdges.reverse(),
  };
}

const options = parseArgs(process.argv.slice(2));
const overpassUrl =
  process.env.PEAKS_OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const osmApiUrl =
  process.env.PEAKS_OSM_API_URL ?? "https://api.openstreetmap.org/api/0.6";
const licenseName = "Open Data Commons Open Database License (ODbL) 1.0";
const licenseUrl = "https://opendatacommons.org/licenses/odbl/1-0/";
const attribution = "© OpenStreetMap contributors";
const retrievedAt = new Date().toISOString();

try {
  const requestedIds = options.trailheadId
    ? [options.destinationId, options.trailheadId]
    : [options.destinationId];
  const placesResult = await db.query<PlaceRow>(
    `SELECT id, name,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM destinations
     WHERE id = ANY($1::text[])`,
    [requestedIds]
  );

  const places = new Map(placesResult.rows.map((row) => [row.id, row]));
  const destination = places.get(options.destinationId);
  const trailhead = options.trailheadId
    ? places.get(options.trailheadId)
    : {
      id: "draft-trailhead",
      name: options.trailheadName.trim(),
      lat: options.trailheadLat!,
      lng: options.trailheadLng!,
    };
  if (!destination) throw new Error(`Destination not found: ${options.destinationId}`);
  if (!trailhead) throw new Error(`Trailhead not found: ${options.trailheadId}`);
  const matchReference = await referenceMatcher(options);

  let sourceUrl: string;
  let elements: Array<OsmNode | OsmWay>;
  if (options.wayIds.length > 0) {
    sourceUrl = osmApiUrl;
    const responses = await Promise.all(
      options.wayIds.map(async (wayId) => {
        const response = await fetch(`${osmApiUrl}/way/${wayId}/full.json`, {
          headers: {
            "user-agent":
              process.env.PEAKS_OVERPASS_USER_AGENT ?? "Peaks route research/1.0",
          },
        });
        if (!response.ok) {
          throw new Error(`OSM way ${wayId} returned HTTP ${response.status}`);
        }
        const payload = (await response.json()) as {
          elements: Array<OsmNode | OsmWay>;
        };
        return payload.elements;
      })
    );
    const unique = new Map<string, OsmNode | OsmWay>();
    for (const element of responses.flat()) {
      unique.set(`${element.type}:${element.id}`, element);
    }
    elements = [...unique.values()];
  } else {
    sourceUrl = overpassUrl;
    const wayScope = options.corridorPaddingM === null
      ? `around:${options.radiusM},${destination.lat},${destination.lng}`
      : overpassBoundingBox(
        trailhead,
        destination,
        options.corridorPaddingM
      );
    const query =
      `[out:json][timeout:30];` +
      `way(${wayScope})` +
      `["highway"~"^(path|footway|steps|pedestrian|track|service|unclassified|residential)$"];` +
      `out body;>;out skel qt;`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(overpassUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent":
            process.env.PEAKS_OVERPASS_USER_AGENT ?? "Peaks route research/1.0",
        },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Overpass returned HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        remark?: string;
        elements: Array<OsmNode | OsmWay>;
      };
      if (payload.remark) throw new Error(payload.remark);
      elements = payload.elements;
    } catch (error) {
      const paddingM = options.corridorPaddingM ?? options.radiusM;
      console.error(
        `Overpass unavailable (${error instanceof Error ? error.message : String(error)}); ` +
        `falling back to the main OSM map API`
      );
      const bounds = corridorBoundingBox(
        trailhead,
        destination,
        paddingM
      );
      elements = await fetchOsmMapElements(
        osmApiUrl,
        bounds,
        process.env.PEAKS_OVERPASS_USER_AGENT ?? "Peaks route research/1.0"
      );
      sourceUrl = osmApiUrl;
    } finally {
      clearTimeout(timeout);
    }
  }

  const nodes = new Map<number, OsmNode>();
  const ways: OsmWay[] = [];
  for (const element of elements) {
    if (element.type === "node") nodes.set(element.id, element);
    if (element.type === "way") ways.push(element);
  }

  const graph = new Map<number, GraphEdge[]>();
  const footAccessOverrides = new Set<number>();
  for (const way of ways) {
    const tags = way.tags ?? {};
    if (!walkableHighways.has(tags.highway ?? "")) {
      continue;
    }
    const footAllows = ["yes", "designated", "permissive", "permit"].includes(
      tags.foot ?? ""
    );
    if (["no", "private"].includes(tags.access ?? "") && footAllows) {
      footAccessOverrides.add(way.id);
    }
    const genericAccessBlocks =
      ["no", "private"].includes(tags.access ?? "") && !footAllows;
    if (
      genericAccessBlocks ||
      ["no", "private"].includes(tags.foot ?? "")
    ) {
      continue;
    }
    const nodeIds = way.nodes ?? [];
    for (let index = 1; index < nodeIds.length; index += 1) {
      const from = nodes.get(nodeIds[index - 1]);
      const to = nodes.get(nodeIds[index]);
      if (!from || !to) continue;
      const distance = haversineMeters(from.lat, from.lon, to.lat, to.lon);
      const referencePenalty = matchReference
        ? 1 +
          Math.min(
            (
              matchReference(from.lat, from.lon) +
              matchReference(to.lat, to.lon)
            ) / 2,
            5000
          ) / 5
        : 1;
      const baseEdge = {
        distance,
        cost: distance * edgePenalty(tags) * referencePenalty,
        wayId: way.id,
        wayName: tags.name ?? null,
      };
      graph.set(from.id, [
        ...(graph.get(from.id) ?? []),
        { ...baseEdge, to: to.id },
      ]);
      graph.set(to.id, [
        ...(graph.get(to.id) ?? []),
        { ...baseEdge, to: from.id },
      ]);
    }
  }

  const { start, finish } = nearestConnectedNodes(
    trailhead,
    destination,
    nodes,
    graph,
    options.snapM
  );

  const path = shortestPath(graph, start.id, finish.id);
  const networkCoordinates = path.nodeIds.map((id) => {
    const node = nodes.get(id)!;
    return [node.lon, node.lat];
  });
  const coordinates = [
    [trailhead.lng, trailhead.lat],
    ...networkCoordinates,
    [destination.lng, destination.lat],
  ];
  const distanceM =
    start.distance +
    path.edges.reduce((sum, edge) => sum + edge.distance, 0) +
    finish.distance;
  const wayIds = [...new Set(path.edges.map((edge) => edge.wayId))];
  const wayNames = [
    ...new Set(path.edges.map((edge) => edge.wayName).filter(Boolean)),
  ];

  if (options.format === "summary") {
    console.log(`Route: ${trailhead.name} → ${destination.name}`);
    console.log(
      `OSM path: ${(distanceM / 1609.344).toFixed(2)} mi; ${coordinates.length} points`
    );
    console.log(
      `Snaps: trailhead ${start.distance.toFixed(1)} m; summit ${finish.distance.toFixed(1)} m`
    );
    console.log(`Ways: ${wayIds.join(", ")}`);
    console.log(`Names: ${wayNames.join(" | ") || "unnamed"}`);
    const usedOverrides = wayIds.filter((wayId) =>
      footAccessOverrides.has(wayId)
    );
    if (usedOverrides.length > 0) {
      console.log(
        `Access note: foot-specific access overrides generic access on ways ` +
          usedOverrides.join(", ")
      );
    }
    console.log(`License: ${attribution}, ${licenseName}; ${licenseUrl}`);
  } else {
    const geojson = JSON.stringify({
        type: "FeatureCollection",
        peaks_destination_id: destination.id,
        peaks_trailhead_id: trailhead.id,
        peaks_source: "https://www.openstreetmap.org/",
        peaks_retrieval_source: sourceUrl,
        peaks_license_name: licenseName,
        peaks_license: licenseUrl,
        peaks_attribution: attribution,
        peaks_retrieved_at: retrievedAt,
        features: [
          {
            type: "Feature",
            properties: {
              name: `${destination.name} OSM route candidate`,
              trailhead_name: trailhead.name,
              destination_name: destination.name,
              distance_m: distanceM,
              trailhead_snap_m: start.distance,
              summit_snap_m: finish.distance,
              osm_way_ids: wayIds,
              osm_way_urls: wayIds.map(
                (id) => `https://www.openstreetmap.org/way/${id}`
              ),
              osm_way_names: wayNames,
              osm_foot_access_override_way_ids: wayIds.filter((wayId) =>
                footAccessOverrides.has(wayId)
              ),
            },
            geometry: {
              type: "LineString",
              coordinates,
            },
          },
        ],
      });
    if (options.outputPath) {
      await writeFile(options.outputPath, `${geojson}\n`);
      console.error(`Wrote ${options.outputPath}`);
    } else {
      console.log(geojson);
    }
  }
} finally {
  await db.end();
}
