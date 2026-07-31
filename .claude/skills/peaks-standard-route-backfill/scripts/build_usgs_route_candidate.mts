#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import process from "node:process";
import dbImport from "../../../../cloud-sql/migrate/src/db";

const db =
  typeof (dbImport as { query?: unknown }).query === "function"
    ? dbImport
    : (dbImport as unknown as { default: typeof dbImport }).default;

const SERVICE_URL =
  "https://partnerships.nationalmap.gov/arcgis/rest/services/" +
  "USGSTrails/MapServer/0/query";
const LICENSE_URL =
  "https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map";

type Options = {
  destinationId: string;
  trailheadId: string;
  objectIds: number[];
  outputPath: string;
};

type Place = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

type Properties = Record<string, unknown>;

function valuesAfter(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) {
      values.push(argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function valueAfter(argv: string[], flag: string): string {
  return valuesAfter(argv, flag)[0] ?? "";
}

function parseArgs(argv: string[]): Options {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "Usage: build_usgs_route_candidate.mts " +
        "--destination-id ID --trailhead-id ID --object-id N " +
        "[--object-id N ...] " +
        "--output candidate.geojson"
    );
    process.exit(0);
  }
  const options = {
    destinationId: valueAfter(argv, "--destination-id"),
    trailheadId: valueAfter(argv, "--trailhead-id"),
    objectIds: valuesAfter(argv, "--object-id").map(Number),
    outputPath: valueAfter(argv, "--output"),
  };
  for (const [label, value] of [
    ["--destination-id", options.destinationId],
    ["--trailhead-id", options.trailheadId],
  ] as const) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error(`${label} is required and contains unsupported characters`);
    }
  }
  if (
    options.objectIds.length === 0 ||
    options.objectIds.some(
      (objectId) => !Number.isSafeInteger(objectId) || objectId <= 0
    ) ||
    new Set(options.objectIds).size !== options.objectIds.length
  ) {
    throw new Error("--object-id must be one or more unique positive integers");
  }
  if (!options.outputPath) throw new Error("--output is required");
  return options;
}

function haversineMeters(
  first: [number, number],
  second: [number, number]
): number {
  const earthRadiusM = 6_371_000;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = toRadians(second[1] - first[1]);
  const dLng = toRadians(second[0] - first[0]);
  const firstLat = toRadians(first[1]);
  const secondLat = toRadians(second[1]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(firstLat) *
      Math.cos(secondLat) *
      Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function textProperty(
  properties: Properties,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

const options = parseArgs(process.argv.slice(2));

try {
  const placesResult = await db.query<Place>(
    `SELECT id, name,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM destinations
     WHERE id = ANY($1::text[])`,
    [[options.destinationId, options.trailheadId]]
  );
  const places = new Map(placesResult.rows.map((place) => [place.id, place]));
  const destination = places.get(options.destinationId);
  const trailhead = places.get(options.trailheadId);
  if (!destination) throw new Error("Destination was not found");
  if (!trailhead) throw new Error("Trailhead was not found");

  const sourceUrl = new URL(SERVICE_URL);
  sourceUrl.searchParams.set(
    "where",
    `objectid IN (${options.objectIds.join(",")})`
  );
  sourceUrl.searchParams.set("outFields", "*");
  sourceUrl.searchParams.set("returnGeometry", "true");
  sourceUrl.searchParams.set("outSR", "4326");
  sourceUrl.searchParams.set("f", "geojson");
  const response = await fetch(sourceUrl, {
    headers: {
      "user-agent":
        "Peaks route research/1.0 " +
        "(https://github.com/jhmacdon/peaks-firebase)",
    },
  });
  if (!response.ok) {
    throw new Error(`USGS National Map returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    features?: Array<{
      properties?: Properties;
      geometry?: { type?: string; coordinates?: unknown };
    }>;
  };
  if (
    !Array.isArray(payload.features) ||
    payload.features.length !== options.objectIds.length
  ) {
    throw new Error(
      `USGS National Map returned ${payload.features?.length ?? 0} features ` +
        `for ${options.objectIds.length} object IDs`
    );
  }
  const networkPaths: Array<{
    objectId: number;
    properties: Properties;
    coordinates: Array<[number, number]>;
  }> = [];
  for (const feature of payload.features) {
    const properties = feature.properties ?? {};
    const objectId = Number(
      properties.objectid ?? properties.OBJECTID ?? properties.ObjectID
    );
    const rawPaths =
      feature.geometry?.type === "LineString" &&
      Array.isArray(feature.geometry.coordinates)
        ? [feature.geometry.coordinates]
        : feature.geometry?.type === "MultiLineString" &&
            Array.isArray(feature.geometry.coordinates)
          ? feature.geometry.coordinates
          : [];
    if (!Number.isSafeInteger(objectId) || !options.objectIds.includes(objectId)) {
      throw new Error("USGS feature has an unexpected object ID");
    }
    if (rawPaths.length === 0) {
      throw new Error(`USGS object ${objectId} has no line geometry`);
    }
    for (const rawPath of rawPaths) {
      if (!Array.isArray(rawPath)) {
        throw new Error(`USGS object ${objectId} has invalid line geometry`);
      }
      const coordinates = rawPath.map((coordinate, index) => {
        if (
          !Array.isArray(coordinate) ||
          coordinate.length < 2 ||
          !Number.isFinite(coordinate[0]) ||
          !Number.isFinite(coordinate[1])
        ) {
          throw new Error(
            `USGS object ${objectId} coordinate ${index} is invalid`
          );
        }
        return [Number(coordinate[0]), Number(coordinate[1])] as [
          number,
          number,
        ];
      });
      if (coordinates.length < 2) {
        throw new Error(`USGS object ${objectId} has too few points`);
      }
      networkPaths.push({ objectId, properties, coordinates });
    }
  }

  const trailheadCoordinate: [number, number] = [
    trailhead.lng,
    trailhead.lat,
  ];
  const destinationCoordinate: [number, number] = [
    destination.lng,
    destination.lat,
  ];
  type GraphEdge = {
    to: number;
    cost: number;
    coordinates: Array<[number, number]>;
    pathIndex: number | null;
    connectionM: number;
  };
  const endpointCoordinates = networkPaths.flatMap(({ coordinates }) => [
    coordinates[0],
    coordinates[coordinates.length - 1],
  ]);
  const sourceNode = endpointCoordinates.length;
  const targetNode = sourceNode + 1;
  const graph = Array.from(
    { length: targetNode + 1 },
    () => [] as GraphEdge[]
  );
  const addEdge = (from: number, edge: GraphEdge) => {
    graph[from].push(edge);
  };
  for (let pathIndex = 0; pathIndex < networkPaths.length; pathIndex += 1) {
    const path = networkPaths[pathIndex].coordinates;
    const startNode = pathIndex * 2;
    const endNode = startNode + 1;
    const pathDistanceM = path
      .slice(1)
      .reduce(
        (total, coordinate, index) =>
          total + haversineMeters(path[index], coordinate),
        0
      );
    addEdge(startNode, {
      to: endNode,
      cost: pathDistanceM,
      coordinates: path,
      pathIndex,
      connectionM: 0,
    });
    addEdge(endNode, {
      to: startNode,
      cost: pathDistanceM,
      coordinates: [...path].reverse(),
      pathIndex,
      connectionM: 0,
    });
  }
  for (let first = 0; first < endpointCoordinates.length; first += 1) {
    for (let second = first + 1; second < endpointCoordinates.length; second += 1) {
      if (Math.floor(first / 2) === Math.floor(second / 2)) continue;
      const distanceM = haversineMeters(
        endpointCoordinates[first],
        endpointCoordinates[second]
      );
      if (distanceM > 100) continue;
      addEdge(first, {
        to: second,
        cost: distanceM,
        coordinates: [endpointCoordinates[first], endpointCoordinates[second]],
        pathIndex: null,
        connectionM: distanceM,
      });
      addEdge(second, {
        to: first,
        cost: distanceM,
        coordinates: [endpointCoordinates[second], endpointCoordinates[first]],
        pathIndex: null,
        connectionM: distanceM,
      });
    }
  }
  for (let node = 0; node < endpointCoordinates.length; node += 1) {
    const trailheadDistanceM = haversineMeters(
      trailheadCoordinate,
      endpointCoordinates[node]
    );
    if (trailheadDistanceM <= 300) {
      addEdge(sourceNode, {
        to: node,
        cost: trailheadDistanceM,
        coordinates: [trailheadCoordinate, endpointCoordinates[node]],
        pathIndex: null,
        connectionM: trailheadDistanceM,
      });
    }
    const summitDistanceM = haversineMeters(
      endpointCoordinates[node],
      destinationCoordinate
    );
    if (summitDistanceM <= 250) {
      addEdge(node, {
        to: targetNode,
        cost: summitDistanceM,
        coordinates: [endpointCoordinates[node], destinationCoordinate],
        pathIndex: null,
        connectionM: summitDistanceM,
      });
    }
  }

  const distances = Array(graph.length).fill(Number.POSITIVE_INFINITY);
  const prior = Array<{
    node: number;
    edge: GraphEdge;
  } | null>(graph.length).fill(null);
  const visited = Array(graph.length).fill(false);
  distances[sourceNode] = 0;
  for (let iteration = 0; iteration < graph.length; iteration += 1) {
    let currentNode = -1;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (let node = 0; node < graph.length; node += 1) {
      if (!visited[node] && distances[node] < currentDistance) {
        currentNode = node;
        currentDistance = distances[node];
      }
    }
    if (currentNode < 0 || currentNode === targetNode) break;
    visited[currentNode] = true;
    for (const edge of graph[currentNode]) {
      const nextDistance = currentDistance + edge.cost;
      if (nextDistance < distances[edge.to]) {
        distances[edge.to] = nextDistance;
        prior[edge.to] = { node: currentNode, edge };
      }
    }
  }
  if (!Number.isFinite(distances[targetNode])) {
    const nearestTrailheadM = Math.min(
      ...endpointCoordinates.map((coordinate) =>
        haversineMeters(trailheadCoordinate, coordinate)
      )
    );
    const nearestSummitM = Math.min(
      ...endpointCoordinates.map((coordinate) =>
        haversineMeters(destinationCoordinate, coordinate)
      )
    );
    throw new Error(
      `USGS selected lines do not connect the catalog places; nearest endpoints ` +
        `${nearestTrailheadM.toFixed(1)} m / ${nearestSummitM.toFixed(1)} m`
    );
  }
  const routeEdges: GraphEdge[] = [];
  let routeNode = targetNode;
  while (routeNode !== sourceNode) {
    const step = prior[routeNode];
    if (!step) throw new Error("USGS route reconstruction failed");
    routeEdges.push(step.edge);
    routeNode = step.node;
  }
  routeEdges.reverse();
  const coordinates: Array<[number, number]> = [];
  for (const edge of routeEdges) {
    if (coordinates.length === 0) {
      coordinates.push(...edge.coordinates);
    } else {
      coordinates.push(...edge.coordinates.slice(1));
    }
  }
  const trailheadSnapM = routeEdges[0].connectionM;
  const summitSnapM = routeEdges[routeEdges.length - 1].connectionM;
  const largestConnectionM = Math.max(
    ...routeEdges.map(({ connectionM }) => connectionM)
  );
  const usedPathIndexes = new Set(
    routeEdges
      .map(({ pathIndex }) => pathIndex)
      .filter((pathIndex): pathIndex is number => pathIndex !== null)
  );
  const usedNetworkPaths = networkPaths.filter((_, index) =>
    usedPathIndexes.has(index)
  );
  const usedObjectIds = [
    ...new Set(usedNetworkPaths.map(({ objectId }) => objectId)),
  ];
  const publishedSourceUrl = new URL(sourceUrl);
  publishedSourceUrl.searchParams.set(
    "where",
    `objectid IN (${usedObjectIds.join(",")})`
  );
  let distanceM = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    distanceM += haversineMeters(coordinates[index - 1], coordinates[index]);
  }

  const originators = [
    ...new Set(
      usedNetworkPaths.map(
        ({ properties }) =>
          textProperty(properties, "sourceoriginator", "SOURCEORIGINATOR") ||
          "U.S. Geological Survey"
      )
    ),
  ];
  const originator = originators.join(" and ");
  const attribution =
    `${originator} via U.S. Geological Survey, The National Map`;
  const output = {
    type: "FeatureCollection",
    peaks_destination_id: destination.id,
    peaks_trailhead_id: trailhead.id,
    peaks_source_kind: "usgs-national-map",
    peaks_source: publishedSourceUrl.toString(),
    peaks_retrieval_source: publishedSourceUrl.toString(),
    peaks_license_name: "Public domain",
    peaks_license: LICENSE_URL,
    peaks_attribution: attribution,
    peaks_retrieved_at: new Date().toISOString(),
    features: [
      {
        type: "Feature",
        properties: {
          name: `${destination.name} USGS route candidate`,
          trailhead_name: trailhead.name,
          destination_name: destination.name,
          distance_m: distanceM,
          trailhead_snap_m: trailheadSnapM,
          summit_snap_m: summitSnapM,
          osm_way_ids: [],
          osm_way_urls: [],
          usgs_object_ids: usedObjectIds,
          usgs_requested_object_ids: options.objectIds,
          usgs_names: [
            ...new Set(
              usedNetworkPaths
                .map(({ properties }) => textProperty(properties, "name", "NAME"))
                .filter(Boolean)
            ),
          ],
          usgs_originators: originators,
          usgs_source_feature_ids: [
            ...new Set(
              usedNetworkPaths
                .map(({ properties }) =>
                  textProperty(
                    properties,
                    "sourcefeatureid",
                    "SOURCEFEATUREID"
                  )
                )
                .filter(Boolean)
            ),
          ],
          usgs_source_dataset_ids: [
            ...new Set(
              usedNetworkPaths
                .map(({ properties }) =>
                  textProperty(
                    properties,
                    "sourcedatasetid",
                    "SOURCEDATASETID"
                  )
                )
                .filter(Boolean)
            ),
          ],
          largest_connection_m: largestConnectionM,
        },
        geometry: {
          type: "LineString",
          coordinates,
        },
      },
    ],
  };
  await writeFile(options.outputPath, `${JSON.stringify(output)}\n`);
  console.log(
    `Wrote ${options.outputPath}: ${(distanceM / 1609.344).toFixed(2)} mi; ` +
      `snaps ${trailheadSnapM.toFixed(1)} m / ${summitSnapM.toFixed(1)} m; ` +
      `largest selected-line connection ${largestConnectionM.toFixed(1)} m`
  );
  console.log(`Attribution: ${attribution}`);
  console.log(`License: Public domain; ${LICENSE_URL}`);
} finally {
  await db.end();
}
