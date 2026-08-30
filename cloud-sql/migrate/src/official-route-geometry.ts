import {
  interpolateWorldPosition,
  normalizeLongitudeDelta as normalizedLongitudeDelta,
  pointToSegmentMeters as worldPointToSegmentMeters,
  projectPointToSegmentMeters,
} from "./route-world-geometry";

export type Coordinate = [number, number];

export type LatLng = {
  lat: number;
  lng: number;
};

export type ArcgisTrailService = {
  queryUrl: string;
  idField: string;
  nameFields: readonly string[];
  accessFields: readonly string[];
};

export type OfficialNetworkPath = {
  featureId: string;
  properties: Record<string, unknown>;
  coordinates: Coordinate[];
  names: string[];
  access: string[];
};

export type OfficialSourceSegment = {
  featureId: string;
  start: LatLng;
  end: LatLng;
};

export type OfficialRoutePath = {
  coordinates: Coordinate[];
  usedFeatureIds: string[];
  usedPaths: OfficialNetworkPath[];
  trailheadSnapM: number;
  summitSnapM: number;
  largestConnectionM: number;
  distanceM: number;
};

export type OfficialRouteReview = {
  startConnectorM: number;
  endConnectorM: number;
  startConnectorJoinOffsetM: number;
  endConnectorJoinOffsetM: number;
  internalConnectorMaxM: number;
  internalConnectorJoinMaxOffsetM: number;
  coreMaxOffsetM: number;
  coreP95OffsetM: number;
  coreCoveragePct: number;
  coreSampleCount: number;
  sourceTopologyValid: boolean;
  usedFeatureIds: string[];
  unusedFeatureIds: string[];
};

export type OfficialRouteReviewOptions = {
  internalConnectorSegmentIndexes?: readonly number[];
};

export type LollipopRetraceReview = {
  valid: boolean;
  retracedPairs: number;
};

type ArcgisFeature = {
  properties?: Record<string, unknown>;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
};

type ArcgisPayload = {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  features?: ArcgisFeature[];
};

type GraphEdge = {
  to: number;
  cost: number;
  coordinates: Coordinate[];
  pathIndex: number | null;
  connectionM: number;
};

type NetworkSegment = {
  pathIndex: number;
  segmentIndex: number;
  start: Coordinate;
  end: Coordinate;
};

type PathCut = {
  pathIndex: number;
  position: number;
  coordinate: Coordinate;
};

type PendingConnection = {
  first: PathCut;
  second: PathCut;
  distanceM: number;
};

type SourceTraversal = {
  pathIndex: number;
  segmentIndex: number;
  sourceStart: LatLng;
  sourceEnd: LatLng;
};

const EARTH_RADIUS_M = 6_371_000;
const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const FEATURE_ID_MAX_LENGTH = 256;
const NETWORK_CONNECTION_MAX_M = 5;
const TRAILHEAD_SNAP_MAX_M = 125;
const SUMMIT_SNAP_MAX_M = 125;
const CORE_SAMPLE_STEP_M = 20;
const MAX_CORE_SAMPLES = 100_000;
const CORE_COVERAGE_DISTANCE_M = 3;
const CORE_MAX_OFFSET_M = 5;
const CONNECTOR_MAX_M = 125;
const SOURCE_USAGE_DISTANCE_M = 5;
const SOURCE_USAGE_SAMPLE_STEP_M = 5;
const SOURCE_USAGE_MIN_FOLLOWED_M = 25;
const SOURCE_USAGE_MIN_SHORT_FEATURE_M = 5;
const SOURCE_USAGE_MIN_FEATURE_COVERAGE = 0.5;
const SOURCE_USAGE_MIN_DIRECTION_ALIGNMENT = 0.8;
const GRAPH_POSITION_PRECISION = 10;
const GRAPH_COORDINATE_EPSILON_M = 0.01;
const INTERNAL_CONNECTOR_VERTEX_STEP_M = 5;
const GRAPH_CONNECTION_COST_MULTIPLIER = 2;
const MAX_GRAPH_GEOMETRY_CHECKS = 2_000_000;
const TOPOLOGY_MATCH_MAX_M = 0.5;
const TOPOLOGY_DIRECTION_ALIGNMENT_MIN = 0.99;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireField(field: string, label: string): string {
  if (!FIELD_PATTERN.test(field)) {
    throw new Error(`${label} is not a safe ArcGIS field name`);
  }
  return field;
}

function uniqueFields(service: ArcgisTrailService): string[] {
  return [
    ...new Set([
      requireField(service.idField, "service.idField"),
      ...service.nameFields.map((field) =>
        requireField(field, "service.nameFields entry")
      ),
      ...service.accessFields.map((field) =>
        requireField(field, "service.accessFields entry")
      ),
    ]),
  ];
}

function propertyValue(
  properties: Record<string, unknown>,
  field: string
): unknown {
  if (Object.prototype.hasOwnProperty.call(properties, field)) {
    return properties[field];
  }
  const lowerField = field.toLowerCase();
  const matchingKey = Object.keys(properties).find(
    (key) => key.toLowerCase() === lowerField
  );
  return matchingKey === undefined ? undefined : properties[matchingKey];
}

function propertyText(
  properties: Record<string, unknown>,
  field: string
): string {
  const value = propertyValue(properties, field);
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}

function textsForFields(
  properties: Record<string, unknown>,
  fields: readonly string[]
): string[] {
  return [
    ...new Set(fields.map((field) => propertyText(properties, field)).filter(Boolean)),
  ];
}

function coordinate(value: unknown, label: string): Coordinate {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1])
  ) {
    throw new Error(`${label} is not a valid coordinate`);
  }
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new Error(`${label} is outside WGS84 bounds`);
  }
  return [lng, lat];
}

function lineSortKey(line: Coordinate[]): string {
  const forward = JSON.stringify(line);
  const reverse = JSON.stringify([...line].reverse());
  return forward < reverse ? forward : reverse;
}

function rawLines(feature: ArcgisFeature, featureId: string): unknown[][] {
  const geometry = feature.geometry;
  if (geometry?.type === "LineString" && Array.isArray(geometry.coordinates)) {
    return [geometry.coordinates];
  }
  if (
    geometry?.type === "MultiLineString" &&
    Array.isArray(geometry.coordinates)
  ) {
    return geometry.coordinates as unknown[][];
  }
  throw new Error(`Official feature ${featureId} has no line geometry`);
}

function radians(value: number): number {
  return value * Math.PI / 180;
}

export function normalizeOfficialFeatureIds(values: readonly string[]): string[] {
  if (values.length === 0) {
    throw new Error("at least one official feature ID is required");
  }
  const ids = values.map((value, index) => {
    if (typeof value !== "string") {
      throw new Error(`official feature ID ${index + 1} must be a string`);
    }
    const id = value.trim();
    if (
      !id ||
      id.length > FEATURE_ID_MAX_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(id)
    ) {
      throw new Error(`official feature ID ${index + 1} is invalid`);
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error("official feature IDs must be unique");
  }
  return ids.sort(compareText);
}

export function buildOfficialArcgisQueryUrl(
  service: ArcgisTrailService,
  featureIds: readonly string[]
): URL {
  const ids = normalizeOfficialFeatureIds(featureIds);
  const url = new URL(service.queryUrl);
  if (url.protocol !== "https:") {
    throw new Error("official ArcGIS query URL must use HTTPS");
  }
  const idField = requireField(service.idField, "service.idField");
  const quotedIds = ids.map((id) => `'${id.replace(/'/g, "''")}'`);
  url.searchParams.set("where", `${idField} IN (${quotedIds.join(",")})`);
  url.searchParams.set("outFields", uniqueFields(service).join(","));
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("returnZ", "false");
  url.searchParams.set("returnM", "false");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("f", "geojson");
  return url;
}

function parseSqlStringList(value: string, idField: string): string[] {
  const prefix = `${idField} IN (`;
  if (!value.startsWith(prefix) || !value.endsWith(")")) {
    throw new Error("official source URL has an invalid stable-ID query");
  }
  const body = value.slice(prefix.length, -1);
  const ids: string[] = [];
  let index = 0;
  while (index < body.length) {
    if (body[index] !== "'") {
      throw new Error("official source URL has an invalid stable-ID query");
    }
    index += 1;
    let id = "";
    let closed = false;
    while (index < body.length) {
      if (body[index] !== "'") {
        id += body[index];
        index += 1;
        continue;
      }
      if (body[index + 1] === "'") {
        id += "'";
        index += 2;
        continue;
      }
      index += 1;
      closed = true;
      break;
    }
    if (!closed) {
      throw new Error("official source URL has an unterminated stable ID");
    }
    ids.push(id);
    if (index === body.length) break;
    if (body[index] !== ",") {
      throw new Error("official source URL has an invalid stable-ID separator");
    }
    index += 1;
  }
  return normalizeOfficialFeatureIds(ids);
}

export function parseOfficialFeatureIdsFromSourceUrl(
  service: ArcgisTrailService,
  sourceUrl: string
): string[] {
  const url = new URL(sourceUrl);
  const registryUrl = new URL(service.queryUrl);
  if (
    url.protocol !== "https:" ||
    url.origin !== registryUrl.origin ||
    url.pathname !== registryUrl.pathname
  ) {
    throw new Error("official source URL does not match the registry service");
  }
  const idField = requireField(service.idField, "service.idField");
  const ids = parseSqlStringList(url.searchParams.get("where") ?? "", idField);
  const expected = buildOfficialArcgisQueryUrl(service, ids);
  if (url.toString() !== expected.toString()) {
    throw new Error("official source URL is not the canonical registry query");
  }
  return ids;
}

export function parseOfficialArcgisPaths(
  payloadValue: unknown,
  service: ArcgisTrailService,
  expectedFeatureIds: readonly string[]
): OfficialNetworkPath[] {
  if (!payloadValue || typeof payloadValue !== "object" || Array.isArray(payloadValue)) {
    throw new Error("official ArcGIS source returned an invalid payload");
  }
  const payload = payloadValue as ArcgisPayload;
  if (payload.error) {
    const code =
      typeof payload.error.code === "number" || typeof payload.error.code === "string"
        ? ` ${payload.error.code}`
        : "";
    const message =
      typeof payload.error.message === "string" ? `: ${payload.error.message}` : "";
    throw new Error(`official ArcGIS source returned error${code}${message}`);
  }
  if (!Array.isArray(payload.features)) {
    throw new Error("official ArcGIS source returned no feature array");
  }

  const expected = normalizeOfficialFeatureIds(expectedFeatureIds);
  const expectedSet = new Set(expected);
  const returned = new Set<string>();
  const paths: OfficialNetworkPath[] = [];
  for (const [featureIndex, feature] of payload.features.entries()) {
    if (!feature || typeof feature !== "object" || Array.isArray(feature)) {
      throw new Error(`official ArcGIS feature ${featureIndex + 1} is invalid`);
    }
    const properties = feature.properties ?? {};
    const featureId = propertyText(properties, service.idField);
    if (!featureId || !expectedSet.has(featureId)) {
      throw new Error(
        featureId
          ? `official ArcGIS source returned unexpected feature ${featureId}`
          : "official ArcGIS source returned a feature without its stable ID"
      );
    }
    returned.add(featureId);
    const names = textsForFields(properties, service.nameFields);
    const access = textsForFields(properties, service.accessFields);
    const lines = rawLines(feature, featureId).map((rawLine, lineIndex) => {
      if (!Array.isArray(rawLine)) {
        throw new Error(`official feature ${featureId} line ${lineIndex + 1} is invalid`);
      }
      const parsed = rawLine.map((value, coordinateIndex) =>
        coordinate(
          value,
          `official feature ${featureId} line ${lineIndex + 1} coordinate ${
            coordinateIndex + 1
          }`
        )
      );
      if (parsed.length < 2) {
        throw new Error(`official feature ${featureId} has a line with too few points`);
      }
      return parsed;
    });
    lines.sort((left, right) => compareText(lineSortKey(left), lineSortKey(right)));
    for (const coordinates of lines) {
      paths.push({ featureId, properties, coordinates, names, access });
    }
  }

  const missing = expected.filter((id) => !returned.has(id));
  if (missing.length > 0) {
    throw new Error(`official ArcGIS source omitted features: ${missing.join(", ")}`);
  }
  return paths.sort((left, right) => {
    const idOrder = compareText(left.featureId, right.featureId);
    return idOrder || compareText(lineSortKey(left.coordinates), lineSortKey(right.coordinates));
  });
}

export function haversineMeters(first: LatLng, second: LatLng): number {
  const dLat = radians(second.lat - first.lat);
  const dLng = radians(second.lng - first.lng);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(first.lat)) *
      Math.cos(radians(second.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function coordinateToLatLng(value: Coordinate): LatLng {
  return { lng: value[0], lat: value[1] };
}

function pathDistanceMeters(coordinates: Coordinate[]): number {
  return coordinates.slice(1).reduce(
    (total, value, index) =>
      total +
      haversineMeters(
        coordinateToLatLng(coordinates[index]),
        coordinateToLatLng(value)
      ),
    0
  );
}

function interpolateCoordinate(
  start: Coordinate,
  end: Coordinate,
  fraction: number
): Coordinate {
  return interpolateWorldPosition(start, end, fraction);
}

function graphPosition(segmentIndex: number, fraction: number): number {
  const clamped = Math.max(0, Math.min(1, fraction));
  if (clamped <= 1e-10) return segmentIndex;
  if (clamped >= 1 - 1e-10) return segmentIndex + 1;
  return segmentIndex + clamped;
}

function pathCoordinatesBetween(
  path: readonly Coordinate[],
  first: PathCut,
  second: PathCut
): Coordinate[] {
  if (first.position > second.position) {
    return pathCoordinatesBetween(path, second, first).reverse();
  }
  const output: Coordinate[] = [first.coordinate];
  for (
    let vertexIndex = Math.floor(first.position) + 1;
    vertexIndex < second.position - 1e-10;
    vertexIndex += 1
  ) {
    output.push(path[vertexIndex]);
  }
  if (
    haversineMeters(
      coordinateToLatLng(output[output.length - 1]),
      coordinateToLatLng(second.coordinate)
    ) > GRAPH_COORDINATE_EPSILON_M
  ) {
    output.push(second.coordinate);
  }
  return output;
}

function connectorCoordinates(
  first: Coordinate,
  second: Coordinate,
  distanceM: number
): Coordinate[] {
  const stepCount = Math.max(
    1,
    Math.ceil(distanceM / INTERNAL_CONNECTOR_VERTEX_STEP_M)
  );
  return Array.from({ length: stepCount + 1 }, (_, index) =>
    interpolateCoordinate(first, second, index / stepCount)
  );
}

export function ensureMinimumRouteCoordinates(
  values: readonly Coordinate[],
  minimumCount: number
): Coordinate[] {
  const coordinates = values.map(
    ([longitude, latitude]) => [longitude, latitude] as Coordinate
  );
  while (coordinates.length < minimumCount) {
    let longestSegmentIndex = 0;
    let longestSegmentM = -1;
    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const distanceM = haversineMeters(
        coordinateToLatLng(coordinates[index]),
        coordinateToLatLng(coordinates[index + 1])
      );
      if (distanceM > longestSegmentM) {
        longestSegmentM = distanceM;
        longestSegmentIndex = index;
      }
    }
    coordinates.splice(
      longestSegmentIndex + 1,
      0,
      interpolateCoordinate(
        coordinates[longestSegmentIndex],
        coordinates[longestSegmentIndex + 1],
        0.5
      )
    );
  }
  return coordinates;
}

function segmentProjection(
  point: Coordinate,
  segment: NetworkSegment
): { fraction: number; distanceM: number; coordinate: Coordinate } {
  const projection = projectPointToSegmentMeters(
    coordinateToLatLng(point),
    coordinateToLatLng(segment.start),
    coordinateToLatLng(segment.end)
  );
  return {
    fraction: projection.fraction,
    distanceM: projection.distanceM,
    coordinate: interpolateCoordinate(
      segment.start,
      segment.end,
      projection.fraction
    ),
  };
}

function pushHeap(
  heap: Array<{ distance: number; node: number }>,
  value: { distance: number; node: number }
): void {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    const parentValue = heap[parent];
    if (
      parentValue.distance < value.distance ||
      (parentValue.distance === value.distance && parentValue.node <= value.node)
    ) {
      break;
    }
    heap[index] = parentValue;
    index = parent;
  }
  heap[index] = value;
}

function popHeap(
  heap: Array<{ distance: number; node: number }>
): { distance: number; node: number } | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || heap.length === 0) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= heap.length) break;
    let child = left;
    if (
      right < heap.length &&
      (heap[right].distance < heap[left].distance ||
        (heap[right].distance === heap[left].distance &&
          heap[right].node < heap[left].node))
    ) {
      child = right;
    }
    if (
      heap[child].distance > last.distance ||
      (heap[child].distance === last.distance && heap[child].node >= last.node)
    ) {
      break;
    }
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return first;
}

export function buildOfficialRoutePath(
  networkPathsValue: readonly OfficialNetworkPath[],
  trailhead: LatLng,
  summit: LatLng
): OfficialRoutePath {
  if (networkPathsValue.length === 0) {
    throw new Error("official ArcGIS source returned no usable paths");
  }
  const networkPaths = [...networkPathsValue].sort((left, right) => {
    const idOrder = compareText(left.featureId, right.featureId);
    return idOrder || compareText(lineSortKey(left.coordinates), lineSortKey(right.coordinates));
  });
  const trailheadCoordinate: Coordinate = [trailhead.lng, trailhead.lat];
  const summitCoordinate: Coordinate = [summit.lng, summit.lat];

  const segments: NetworkSegment[] = [];
  networkPaths.forEach(({ coordinates }, pathIndex) => {
    coordinates.slice(1).forEach((end, segmentIndex) => {
      const start = coordinates[segmentIndex];
      if (
        haversineMeters(
          coordinateToLatLng(start),
          coordinateToLatLng(end)
        ) < 1e-6
      ) {
        return;
      }
      segments.push({
        pathIndex,
        segmentIndex,
        start,
        end,
      });
    });
  });
  if (segments.length === 0) {
    throw new Error("official ArcGIS source returned only zero-length paths");
  }

  const cutsByPath = networkPaths.map(() => new Map<string, PathCut>());
  const addCut = (
    pathIndex: number,
    positionValue: number,
    coordinateValue: Coordinate
  ): PathCut => {
    const position = Number(positionValue.toFixed(GRAPH_POSITION_PRECISION));
    const key = position.toFixed(GRAPH_POSITION_PRECISION);
    const existing = cutsByPath[pathIndex].get(key);
    if (existing) return existing;
    const cut = { pathIndex, position, coordinate: coordinateValue };
    cutsByPath[pathIndex].set(key, cut);
    return cut;
  };
  networkPaths.forEach(({ coordinates }, pathIndex) => {
    addCut(pathIndex, 0, coordinates[0]);
    addCut(pathIndex, coordinates.length - 1, coordinates[coordinates.length - 1]);
  });

  const trailheadCuts = new Map<PathCut, number>();
  const summitCuts = new Map<PathCut, number>();
  let nearestTrailheadM = Number.POSITIVE_INFINITY;
  let nearestSummitM = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const trailheadProjection = segmentProjection(trailheadCoordinate, segment);
    const trailheadDistanceM = haversineMeters(
      trailhead,
      coordinateToLatLng(trailheadProjection.coordinate)
    );
    nearestTrailheadM = Math.min(nearestTrailheadM, trailheadDistanceM);
    if (trailheadDistanceM <= TRAILHEAD_SNAP_MAX_M) {
      const cut = addCut(
        segment.pathIndex,
        graphPosition(segment.segmentIndex, trailheadProjection.fraction),
        trailheadProjection.coordinate
      );
      trailheadCuts.set(
        cut,
        Math.min(
          trailheadCuts.get(cut) ?? Number.POSITIVE_INFINITY,
          trailheadDistanceM
        )
      );
    }
    const summitProjection = segmentProjection(summitCoordinate, segment);
    const summitDistanceM = haversineMeters(
      coordinateToLatLng(summitProjection.coordinate),
      summit
    );
    nearestSummitM = Math.min(nearestSummitM, summitDistanceM);
    if (summitDistanceM <= SUMMIT_SNAP_MAX_M) {
      const cut = addCut(
        segment.pathIndex,
        graphPosition(segment.segmentIndex, summitProjection.fraction),
        summitProjection.coordinate
      );
      summitCuts.set(
        cut,
        Math.min(
          summitCuts.get(cut) ?? Number.POSITIVE_INFINITY,
          summitDistanceM
        )
      );
    }
  }

  const pendingConnections: PendingConnection[] = [];
  let geometryChecks = 0;
  const checked = (): void => {
    geometryChecks += 1;
    if (geometryChecks > MAX_GRAPH_GEOMETRY_CHECKS) {
      throw new Error(
        "official selected-line network is too complex to split safely"
      );
    }
  };

  networkPaths.forEach(({ coordinates }, pathIndex) => {
    const endpointCuts = [
      addCut(pathIndex, 0, coordinates[0]),
      addCut(pathIndex, coordinates.length - 1, coordinates[coordinates.length - 1]),
    ];
    for (const endpointCut of endpointCuts) {
      for (const segment of segments) {
        if (segment.pathIndex === pathIndex) continue;
        checked();
        const projection = segmentProjection(endpointCut.coordinate, segment);
        const projectedDistanceM = haversineMeters(
          coordinateToLatLng(endpointCut.coordinate),
          coordinateToLatLng(projection.coordinate)
        );
        if (projectedDistanceM > NETWORK_CONNECTION_MAX_M) continue;
        const targetCut = addCut(
          segment.pathIndex,
          graphPosition(segment.segmentIndex, projection.fraction),
          projection.coordinate
        );
        const distanceM = haversineMeters(
          coordinateToLatLng(endpointCut.coordinate),
          coordinateToLatLng(targetCut.coordinate)
        );
        if (distanceM > NETWORK_CONNECTION_MAX_M) continue;
        pendingConnections.push({
          first: endpointCut,
          second: targetCut,
          distanceM,
        });
      }
    }
  });

  const cuts = cutsByPath.flatMap((pathCuts) =>
    [...pathCuts.values()].sort((left, right) => left.position - right.position)
  );
  const nodeByCut = new Map<PathCut, number>(
    cuts.map((cut, index) => [cut, index])
  );
  const sourceNode = cuts.length;
  const targetNode = sourceNode + 1;
  const graph = Array.from({ length: targetNode + 1 }, () => [] as GraphEdge[]);
  const addEdge = (from: number, edge: GraphEdge): void => {
    graph[from].push(edge);
  };

  cutsByPath.forEach((pathCuts, pathIndex) => {
    const ordered = [...pathCuts.values()].sort(
      (left, right) => left.position - right.position
    );
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const first = ordered[index];
      const second = ordered[index + 1];
      const coordinates = pathCoordinatesBetween(
        networkPaths[pathIndex].coordinates,
        first,
        second
      );
      const distanceM = pathDistanceMeters(coordinates);
      const firstNode = nodeByCut.get(first)!;
      const secondNode = nodeByCut.get(second)!;
      addEdge(firstNode, {
        to: secondNode,
        cost: distanceM,
        coordinates,
        pathIndex,
        connectionM: 0,
      });
      addEdge(secondNode, {
        to: firstNode,
        cost: distanceM,
        coordinates: [...coordinates].reverse(),
        pathIndex,
        connectionM: 0,
      });
    }
  });

  const connectionByNodes = new Map<
    string,
    { firstNode: number; secondNode: number; distanceM: number }
  >();
  for (const connection of pendingConnections) {
    const firstNode = nodeByCut.get(connection.first)!;
    const secondNode = nodeByCut.get(connection.second)!;
    if (firstNode === secondNode) continue;
    const low = Math.min(firstNode, secondNode);
    const high = Math.max(firstNode, secondNode);
    const key = `${low}:${high}`;
    const existing = connectionByNodes.get(key);
    if (!existing || connection.distanceM < existing.distanceM) {
      connectionByNodes.set(key, {
        firstNode: low,
        secondNode: high,
        distanceM: connection.distanceM,
      });
    }
  }
  for (const connection of [...connectionByNodes.values()].sort(
    (left, right) =>
      left.firstNode - right.firstNode || left.secondNode - right.secondNode
  )) {
    const firstCoordinate = cuts[connection.firstNode].coordinate;
    const secondCoordinate = cuts[connection.secondNode].coordinate;
    const coordinates = connectorCoordinates(
      firstCoordinate,
      secondCoordinate,
      connection.distanceM
    );
    addEdge(connection.firstNode, {
      to: connection.secondNode,
      cost: connection.distanceM * GRAPH_CONNECTION_COST_MULTIPLIER,
      coordinates,
      pathIndex: null,
      connectionM: connection.distanceM,
    });
    addEdge(connection.secondNode, {
      to: connection.firstNode,
      cost: connection.distanceM * GRAPH_CONNECTION_COST_MULTIPLIER,
      coordinates: [...coordinates].reverse(),
      pathIndex: null,
      connectionM: connection.distanceM,
    });
  }

  for (const [cut, distanceM] of [...trailheadCuts.entries()].sort(
    ([left], [right]) => nodeByCut.get(left)! - nodeByCut.get(right)!
  )) {
    addEdge(sourceNode, {
      to: nodeByCut.get(cut)!,
      cost: distanceM * GRAPH_CONNECTION_COST_MULTIPLIER,
      coordinates: [trailheadCoordinate, cut.coordinate],
      pathIndex: null,
      connectionM: distanceM,
    });
  }
  for (const [cut, distanceM] of [...summitCuts.entries()].sort(
    ([left], [right]) => nodeByCut.get(left)! - nodeByCut.get(right)!
  )) {
    addEdge(nodeByCut.get(cut)!, {
      to: targetNode,
      cost: distanceM * GRAPH_CONNECTION_COST_MULTIPLIER,
      coordinates: [cut.coordinate, summitCoordinate],
      pathIndex: null,
      connectionM: distanceM,
    });
  }

  const distances = Array(graph.length).fill(Number.POSITIVE_INFINITY);
  const prior = Array<{ node: number; edge: GraphEdge } | null>(graph.length).fill(null);
  distances[sourceNode] = 0;
  const heap = [{ distance: 0, node: sourceNode }];
  while (heap.length > 0) {
    const current = popHeap(heap)!;
    const currentNode = current.node;
    const currentDistance = current.distance;
    if (currentDistance !== distances[currentNode]) continue;
    if (currentNode === targetNode) break;
    for (const edge of graph[currentNode]) {
      const nextDistance = currentDistance + edge.cost;
      if (nextDistance < distances[edge.to]) {
        distances[edge.to] = nextDistance;
        prior[edge.to] = { node: currentNode, edge };
        pushHeap(heap, { distance: nextDistance, node: edge.to });
      }
    }
  }

  if (!Number.isFinite(distances[targetNode])) {
    throw new Error(
      "official selected lines do not connect the catalog places; nearest " +
        `source geometry ${nearestTrailheadM.toFixed(1)} m / ` +
        `${nearestSummitM.toFixed(1)} m`
    );
  }

  const routeEdges: GraphEdge[] = [];
  let routeNode = targetNode;
  while (routeNode !== sourceNode) {
    const step = prior[routeNode];
    if (!step) throw new Error("official route reconstruction failed");
    routeEdges.push(step.edge);
    routeNode = step.node;
  }
  routeEdges.reverse();
  const assembledCoordinates: Coordinate[] = [];
  for (const edge of routeEdges) {
    for (const value of edge.coordinates) {
      const priorCoordinate = assembledCoordinates.at(-1);
      if (
        priorCoordinate &&
        haversineMeters(
          coordinateToLatLng(priorCoordinate),
          coordinateToLatLng(value)
        ) <= GRAPH_COORDINATE_EPSILON_M
      ) {
        continue;
      }
      assembledCoordinates.push(value);
    }
  }
  const coordinates = ensureMinimumRouteCoordinates(assembledCoordinates, 5);
  const usedPathIndexes = new Set(
    routeEdges
      .map(({ pathIndex }) => pathIndex)
      .filter((pathIndex): pathIndex is number => pathIndex !== null)
  );
  const usedPaths = networkPaths.filter((_, index) => usedPathIndexes.has(index));
  if (usedPaths.length === 0) {
    throw new Error("official route does not use any cited source line");
  }
  const usedFeatureIds = [
    ...new Set(usedPaths.map(({ featureId }) => featureId)),
  ].sort(compareText);
  const trailheadSnapM = routeEdges[0].connectionM;
  const summitSnapM = routeEdges[routeEdges.length - 1].connectionM;
  return {
    coordinates,
    usedFeatureIds,
    usedPaths,
    trailheadSnapM,
    summitSnapM,
    largestConnectionM: Math.max(
      ...routeEdges.map(({ connectionM }) => connectionM)
    ),
    distanceM: pathDistanceMeters(coordinates),
  };
}

export function collectOfficialPathMetadata(paths: readonly OfficialNetworkPath[]): {
  names: string[];
  access: string[];
} {
  return {
    names: [...new Set(paths.flatMap(({ names }) => names))].sort(compareText),
    access: [...new Set(paths.flatMap(({ access }) => access))].sort(compareText),
  };
}

export function officialSourceSegments(
  paths: readonly OfficialNetworkPath[]
): OfficialSourceSegment[] {
  return paths.flatMap(({ featureId, coordinates }) =>
    coordinates.slice(1).map((value, index) => ({
      featureId,
      start: coordinateToLatLng(coordinates[index]),
      end: coordinateToLatLng(value),
    }))
  );
}

function pointToSegmentMeters(
  point: LatLng,
  segment: OfficialSourceSegment
): number {
  return worldPointToSegmentMeters(point, segment.start, segment.end);
}

function nearest(
  point: LatLng,
  segments: readonly OfficialSourceSegment[]
): { distance: number; featureId: string } {
  let distance = Number.POSITIVE_INFINITY;
  let featureId = "";
  for (const segment of segments) {
    const candidate = pointToSegmentMeters(point, segment);
    if (candidate < distance) {
      distance = candidate;
      featureId = segment.featureId;
    }
  }
  return { distance, featureId };
}

function directionAlignment(
  routeStart: LatLng,
  routeEnd: LatLng,
  source: OfficialSourceSegment
): number {
  const referenceLat =
    (routeStart.lat + routeEnd.lat + source.start.lat + source.end.lat) / 4;
  const xScale = Math.cos(radians(referenceLat));
  const routeX = normalizedLongitudeDelta(routeEnd.lng - routeStart.lng) * xScale;
  const routeY = routeEnd.lat - routeStart.lat;
  const sourceX = normalizedLongitudeDelta(source.end.lng - source.start.lng) * xScale;
  const sourceY = source.end.lat - source.start.lat;
  const routeLength = Math.hypot(routeX, routeY);
  const sourceLength = Math.hypot(sourceX, sourceY);
  if (routeLength === 0 || sourceLength === 0) return 0;
  return Math.abs(routeX * sourceX + routeY * sourceY) /
    (routeLength * sourceLength);
}

function followedDistanceMeters(
  points: readonly LatLng[],
  startIndex: number,
  endIndex: number,
  excludedSegmentIndexes: ReadonlySet<number>,
  featureSegments: readonly OfficialSourceSegment[]
): number {
  let followedM = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    if (excludedSegmentIndexes.has(index)) continue;
    const start = points[index];
    const end = points[index + 1];
    const lengthM = haversineMeters(start, end);
    if (lengthM === 0) continue;
    const count = Math.max(
      1,
      Math.ceil(lengthM / SOURCE_USAGE_SAMPLE_STEP_M)
    );
    const sampleWeightM = lengthM / count;
    for (let step = 0; step < count; step += 1) {
      const fraction = (step + 0.5) / count;
      const [lng, lat] = interpolateCoordinate(
        [start.lng, start.lat],
        [end.lng, end.lat],
        fraction
      );
      const sample: LatLng = { lat, lng };
      if (
        featureSegments.some(
          (segment) =>
            pointToSegmentMeters(sample, segment) <= SOURCE_USAGE_DISTANCE_M &&
            directionAlignment(start, end, segment) >=
              SOURCE_USAGE_MIN_DIRECTION_ALIGNMENT
        )
      ) {
        followedM += sampleWeightM;
      }
    }
  }
  return followedM;
}

function featureContributesMeaningfully(
  points: readonly LatLng[],
  startIndex: number,
  endIndex: number,
  excludedSegmentIndexes: ReadonlySet<number>,
  featureSegments: readonly OfficialSourceSegment[]
): boolean {
  if (featureSegments.length === 0) return false;
  const followedM = followedDistanceMeters(
    points,
    startIndex,
    endIndex,
    excludedSegmentIndexes,
    featureSegments
  );
  if (followedM >= SOURCE_USAGE_MIN_FOLLOWED_M) return true;
  const sourceLengthM = featureSegments.reduce(
    (total, segment) => total + haversineMeters(segment.start, segment.end),
    0
  );
  return (
    sourceLengthM >= SOURCE_USAGE_MIN_SHORT_FEATURE_M &&
    followedM / sourceLengthM >= SOURCE_USAGE_MIN_FEATURE_COVERAGE
  );
}

function routeDistanceMeters(
  points: readonly LatLng[],
  startIndex: number,
  endIndex: number
): number {
  let distanceM = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    distanceM += haversineMeters(points[index], points[index + 1]);
  }
  return distanceM;
}

function connectorPartition(
  points: readonly LatLng[],
  segments: readonly OfficialSourceSegment[]
): {
  coreStartIndex: number;
  coreEndIndex: number;
  startConnectorM: number;
  endConnectorM: number;
  startConnectorJoinOffsetM: number;
  endConnectorJoinOffsetM: number;
} {
  const routeOffsets = points.map((point) => nearest(point, segments).distance);
  const coreStartIndex = routeOffsets.findIndex(
    (offset) => offset <= CORE_MAX_OFFSET_M
  );
  let coreEndIndex = -1;
  for (let index = routeOffsets.length - 1; index >= 0; index -= 1) {
    if (routeOffsets[index] <= CORE_MAX_OFFSET_M) {
      coreEndIndex = index;
      break;
    }
  }
  if (
    coreStartIndex < 0 ||
    coreEndIndex < 0 ||
    coreStartIndex >= coreEndIndex
  ) {
    return {
      coreStartIndex: -1,
      coreEndIndex: -1,
      startConnectorM: Number.POSITIVE_INFINITY,
      endConnectorM: Number.POSITIVE_INFINITY,
      startConnectorJoinOffsetM: Number.POSITIVE_INFINITY,
      endConnectorJoinOffsetM: Number.POSITIVE_INFINITY,
    };
  }
  return {
    coreStartIndex,
    coreEndIndex,
    startConnectorM: routeDistanceMeters(points, 0, coreStartIndex),
    endConnectorM: routeDistanceMeters(
      points,
      coreEndIndex,
      points.length - 1
    ),
    startConnectorJoinOffsetM: routeOffsets[coreStartIndex],
    endConnectorJoinOffsetM: routeOffsets[coreEndIndex],
  };
}

function routeCoreSamples(
  points: readonly LatLng[],
  startIndex: number,
  endIndex: number,
  excludedSegmentIndexes: ReadonlySet<number>
): LatLng[] {
  const output: LatLng[] = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    if (excludedSegmentIndexes.has(index)) {
      continue;
    }
    const start = points[index];
    const end = points[index + 1];
    const count = Math.max(
      2,
      Math.ceil(haversineMeters(start, end) / CORE_SAMPLE_STEP_M)
    );
    if (output.length + count + 1 > MAX_CORE_SAMPLES) {
      throw new Error(
        `route core exceeds the ${MAX_CORE_SAMPLES}-sample review limit`
      );
    }
    for (let step = 0; step <= count; step += 1) {
      const fraction = step / count;
      const [lng, lat] = interpolateCoordinate(
        [start.lng, start.lat],
        [end.lng, end.lat],
        fraction
      );
      const sample = { lat, lng };
      if (!output.at(-1) || !pointsMatch(output.at(-1)!, sample, 0.01)) {
        output.push(sample);
      }
    }
  }
  return output;
}

function sourceSegmentsForPath(
  path: OfficialNetworkPath
): OfficialSourceSegment[] {
  return path.coordinates.slice(1).map((end, index) => ({
    featureId: path.featureId,
    start: coordinateToLatLng(path.coordinates[index]),
    end: coordinateToLatLng(end),
  }));
}

function topologySamples(start: LatLng, end: LatLng): LatLng[] {
  const intervalCount = Math.max(
    2,
    Math.ceil(haversineMeters(start, end) / CORE_SAMPLE_STEP_M)
  );
  return Array.from({ length: intervalCount + 1 }, (_, index) => {
    const [lng, lat] = interpolateCoordinate(
      [start.lng, start.lat],
      [end.lng, end.lat],
      index / intervalCount
    );
    return { lat, lng };
  });
}

function pathTraversalCandidates(
  start: LatLng,
  end: LatLng,
  segments: readonly OfficialSourceSegment[],
  pathIndex: number
): SourceTraversal[] {
  if (segments.length === 0 || pointsMatch(start, end, 0.01)) return [];
  const samples = topologySamples(start, end);
  return segments.flatMap((segment, segmentIndex) => {
    if (
      directionAlignment(start, end, segment) <
        TOPOLOGY_DIRECTION_ALIGNMENT_MIN ||
      !samples.every(
        (sample) =>
          pointToSegmentMeters(sample, segment) <= TOPOLOGY_MATCH_MAX_M
      )
    ) {
      return [];
    }
    const startProjection = projectPointToSegmentMeters(
      start,
      segment.start,
      segment.end
    );
    const endProjection = projectPointToSegmentMeters(
      end,
      segment.start,
      segment.end
    );
    const [sourceStartLng, sourceStartLat] = interpolateCoordinate(
      [segment.start.lng, segment.start.lat],
      [segment.end.lng, segment.end.lat],
      startProjection.fraction
    );
    const [sourceEndLng, sourceEndLat] = interpolateCoordinate(
      [segment.start.lng, segment.start.lat],
      [segment.end.lng, segment.end.lat],
      endProjection.fraction
    );
    return [
      {
        pathIndex,
        segmentIndex,
        sourceStart: { lng: sourceStartLng, lat: sourceStartLat },
        sourceEnd: { lng: sourceEndLng, lat: sourceEndLat },
      },
    ];
  });
}

function samePathTraversalAllowed(
  first: SourceTraversal,
  second: SourceTraversal,
  paths: readonly OfficialNetworkPath[],
  routeJoint: LatLng
): boolean {
  if (
    first.pathIndex !== second.pathIndex ||
    !pointsMatch(first.sourceEnd, routeJoint, TOPOLOGY_MATCH_MAX_M) ||
    !pointsMatch(second.sourceStart, routeJoint, TOPOLOGY_MATCH_MAX_M)
  ) {
    return false;
  }
  if (first.segmentIndex === second.segmentIndex) return true;
  if (Math.abs(first.segmentIndex - second.segmentIndex) !== 1) return false;
  const sharedVertexIndex = Math.max(first.segmentIndex, second.segmentIndex);
  const sharedVertex = coordinateToLatLng(
    paths[first.pathIndex].coordinates[sharedVertexIndex]
  );
  return pointsMatch(
    routeJoint,
    sharedVertex,
    TOPOLOGY_MATCH_MAX_M
  );
}

function endpointJoinsPath(
  endpointPath: OfficialNetworkPath,
  lineSegments: readonly OfficialSourceSegment[],
  endpointRoutePoint: LatLng,
  lineRoutePoint: LatLng
): boolean {
  const endpoints = [
    coordinateToLatLng(endpointPath.coordinates[0]),
    coordinateToLatLng(endpointPath.coordinates.at(-1)!),
  ];
  return endpoints.some((endpoint) => {
    if (!pointsMatch(endpoint, endpointRoutePoint, TOPOLOGY_MATCH_MAX_M)) {
      return false;
    }
    if (
      haversineMeters(endpointRoutePoint, lineRoutePoint) >
      NETWORK_CONNECTION_MAX_M + TOPOLOGY_MATCH_MAX_M
    ) {
      return false;
    }
    return lineSegments.some((segment) => {
      const projection = projectPointToSegmentMeters(
        endpoint,
        segment.start,
        segment.end
      );
      const [projectedLng, projectedLat] = interpolateCoordinate(
        [segment.start.lng, segment.start.lat],
        [segment.end.lng, segment.end.lat],
        projection.fraction
      );
      return (
        projection.distanceM <=
          NETWORK_CONNECTION_MAX_M + TOPOLOGY_MATCH_MAX_M &&
        pointsMatch(
          { lng: projectedLng, lat: projectedLat },
          lineRoutePoint,
          TOPOLOGY_MATCH_MAX_M
        )
      );
    });
  });
}

function topologyConnectionAllowed(
  paths: readonly OfficialNetworkPath[],
  pathSegments: readonly (readonly OfficialSourceSegment[])[],
  firstPathIndex: number,
  secondPathIndex: number,
  firstRoutePoint: LatLng,
  secondRoutePoint: LatLng
): boolean {
  if (firstPathIndex === secondPathIndex) return false;
  return (
    endpointJoinsPath(
      paths[firstPathIndex],
      pathSegments[secondPathIndex],
      firstRoutePoint,
      secondRoutePoint
    ) ||
    endpointJoinsPath(
      paths[secondPathIndex],
      pathSegments[firstPathIndex],
      secondRoutePoint,
      firstRoutePoint
    )
  );
}

function sourceNetworkTopologyReview(
  points: readonly LatLng[],
  paths: readonly OfficialNetworkPath[],
  coreStartIndex: number,
  coreEndIndex: number,
  excludedSegmentIndexes: ReadonlySet<number>
): { valid: boolean; connectorSegmentIndexes: Set<number> } {
  const connectorSegmentIndexes = new Set<number>();
  if (
    coreStartIndex < 0 ||
    coreEndIndex <= coreStartIndex ||
    paths.length === 0
  ) {
    return { valid: false, connectorSegmentIndexes };
  }
  const pathSegments = paths.map(sourceSegmentsForPath);
  const candidatesBySegment = new Map<number, SourceTraversal[]>();
  for (let index = coreStartIndex; index < coreEndIndex; index += 1) {
    if (excludedSegmentIndexes.has(index)) continue;
    candidatesBySegment.set(
      index,
      pathSegments.flatMap((segments, pathIndex) =>
        pathTraversalCandidates(
          points[index],
          points[index + 1],
          segments,
          pathIndex
        )
      )
    );
  }

  const runs: number[][] = [];
  let run: number[] = [];
  for (let index = coreStartIndex; index < coreEndIndex; index += 1) {
    if (excludedSegmentIndexes.has(index)) {
      if (run.length > 0) runs.push(run);
      run = [];
      continue;
    }
    run.push(index);
  }
  if (run.length > 0) runs.push(run);
  if (runs.length === 0) return { valid: false, connectorSegmentIndexes };

  for (const segmentIndexes of runs) {
    const supported = segmentIndexes.filter(
      (index) => (candidatesBySegment.get(index)?.length ?? 0) > 0
    );
    if (supported.length === 0) {
      return { valid: false, connectorSegmentIndexes };
    }
    const firstSupported = supported[0];
    const lastSupported = supported.at(-1)!;
    const leadingM = routeDistanceMeters(
      points,
      segmentIndexes[0],
      firstSupported
    );
    const trailingM = routeDistanceMeters(
      points,
      lastSupported + 1,
      segmentIndexes.at(-1)! + 1
    );
    if (
      (firstSupported !== segmentIndexes[0] &&
        (segmentIndexes[0] !== coreStartIndex ||
          leadingM > NETWORK_CONNECTION_MAX_M + TOPOLOGY_MATCH_MAX_M)) ||
      (lastSupported !== segmentIndexes.at(-1) &&
        (segmentIndexes.at(-1)! !== coreEndIndex - 1 ||
          trailingM > NETWORK_CONNECTION_MAX_M + TOPOLOGY_MATCH_MAX_M))
    ) {
      return { valid: false, connectorSegmentIndexes };
    }

    let reachable = candidatesBySegment.get(firstSupported)!;
    let priorSupported = firstSupported;
    for (const currentSupported of supported.slice(1)) {
      const gapIndexes = segmentIndexes.filter(
        (index) => index > priorSupported && index < currentSupported
      );
      const firstRoutePoint = points[priorSupported + 1];
      const secondRoutePoint = points[currentSupported];
      const gapLengthM = routeDistanceMeters(
        points,
        priorSupported + 1,
        currentSupported
      );
      const directGapM = haversineMeters(firstRoutePoint, secondRoutePoint);
      const nextReachable: SourceTraversal[] = [];
      for (const secondTraversal of candidatesBySegment.get(currentSupported)!) {
        const connected = reachable.some((firstTraversal) => {
          const allowed =
            gapIndexes.length === 0
              ? firstTraversal.pathIndex === secondTraversal.pathIndex
                ? samePathTraversalAllowed(
                    firstTraversal,
                    secondTraversal,
                    paths,
                    firstRoutePoint
                  )
                : topologyConnectionAllowed(
                    paths,
                    pathSegments,
                    firstTraversal.pathIndex,
                    secondTraversal.pathIndex,
                    firstRoutePoint,
                    secondRoutePoint
                  )
              : gapLengthM <=
                  NETWORK_CONNECTION_MAX_M + TOPOLOGY_MATCH_MAX_M &&
                gapLengthM - directGapM <= TOPOLOGY_MATCH_MAX_M &&
                topologyConnectionAllowed(
                  paths,
                  pathSegments,
                  firstTraversal.pathIndex,
                  secondTraversal.pathIndex,
                  firstRoutePoint,
                  secondRoutePoint
                );
          return allowed;
        });
        if (connected) nextReachable.push(secondTraversal);
      }
      if (nextReachable.length === 0) {
        return { valid: false, connectorSegmentIndexes };
      }
      if (gapIndexes.length > 0) {
        gapIndexes.forEach((index) => connectorSegmentIndexes.add(index));
      }
      reachable = nextReachable;
      priorSupported = currentSupported;
    }
  }
  return { valid: true, connectorSegmentIndexes };
}

function pointsMatch(
  left: LatLng,
  right: LatLng,
  toleranceM = 0.25
): boolean {
  return haversineMeters(left, right) <= toleranceM;
}

function segmentsMatch(
  leftStart: LatLng,
  leftEnd: LatLng,
  rightStart: LatLng,
  rightEnd: LatLng
): boolean {
  return (
    (pointsMatch(leftStart, rightStart) && pointsMatch(leftEnd, rightEnd)) ||
    (pointsMatch(leftStart, rightEnd) && pointsMatch(leftEnd, rightStart))
  );
}

function pointOnSegmentInterior(
  point: LatLng,
  start: LatLng,
  end: LatLng,
  toleranceM = 0.25
): boolean {
  const latitude = ((point.lat + start.lat + end.lat) / 3) * Math.PI / 180;
  const xScale = 111_320 * Math.cos(latitude);
  const yScale = 110_540;
  const px = normalizedLongitudeDelta(point.lng - start.lng) * xScale;
  const py = (point.lat - start.lat) * yScale;
  const ex = normalizedLongitudeDelta(end.lng - start.lng) * xScale;
  const ey = (end.lat - start.lat) * yScale;
  const lengthSquared = ex * ex + ey * ey;
  if (lengthSquared <= toleranceM * toleranceM) return false;
  const fraction = (px * ex + py * ey) / lengthSquared;
  const endpointMargin = toleranceM / Math.sqrt(lengthSquared);
  if (fraction <= endpointMargin || fraction >= 1 - endpointMargin) {
    return false;
  }
  return Math.hypot(px - fraction * ex, py - fraction * ey) <= toleranceM;
}

export function reviewLollipopRetrace(
  points: readonly LatLng[]
): LollipopRetraceReview {
  const segmentCount = points.length - 1;
  if (
    points.length < 5 ||
    !pointsMatch(points[0], points[points.length - 1])
  ) {
    return { valid: false, retracedPairs: 0 };
  }

  const retracedPairs: Array<{ left: number; right: number }> = [];
  for (let leftIndex = 0; leftIndex < segmentCount; leftIndex += 1) {
    const leftStart = points[leftIndex];
    const leftEnd = points[leftIndex + 1];
    for (
      let rightIndex = leftIndex + 2;
      rightIndex < segmentCount;
      rightIndex += 1
    ) {
      const rightStart = points[rightIndex];
      const rightEnd = points[rightIndex + 1];
      if (segmentsMatch(leftStart, leftEnd, rightStart, rightEnd)) {
        retracedPairs.push({ left: leftIndex, right: rightIndex });
        continue;
      }
      if (
        pointOnSegmentInterior(leftStart, rightStart, rightEnd) ||
        pointOnSegmentInterior(leftEnd, rightStart, rightEnd) ||
        pointOnSegmentInterior(rightStart, leftStart, leftEnd) ||
        pointOnSegmentInterior(rightEnd, leftStart, leftEnd)
      ) {
        return { valid: false, retracedPairs: retracedPairs.length };
      }
      if (
        pointsMatch(leftStart, rightStart) ||
        pointsMatch(leftStart, rightEnd) ||
        pointsMatch(leftEnd, rightStart) ||
        pointsMatch(leftEnd, rightEnd)
      ) {
        continue;
      }

      const latitude =
        (leftStart.lat + leftEnd.lat + rightStart.lat + rightEnd.lat) / 4;
      const lngScale = Math.cos(latitude * Math.PI / 180);
      const referenceLng = leftStart.lng;
      const ax = 0;
      const ay = leftStart.lat;
      const bx = normalizedLongitudeDelta(leftEnd.lng - referenceLng) * lngScale;
      const by = leftEnd.lat;
      const cx = normalizedLongitudeDelta(rightStart.lng - referenceLng) * lngScale;
      const cy = rightStart.lat;
      const dx =
        (normalizedLongitudeDelta(rightStart.lng - referenceLng) +
          normalizedLongitudeDelta(rightEnd.lng - rightStart.lng)) *
        lngScale;
      const dy = rightEnd.lat;
      const rx = bx - ax;
      const ry = by - ay;
      const sx = dx - cx;
      const sy = dy - cy;
      const denominator = rx * sy - ry * sx;
      const qpx = cx - ax;
      const qpy = cy - ay;
      const crossQpR = qpx * ry - qpy * rx;
      if (Math.abs(denominator) < 1e-14) {
        continue;
      }
      const leftFraction = (qpx * sy - qpy * sx) / denominator;
      const rightFraction = crossQpR / denominator;
      const withinLeft = leftFraction >= -1e-8 && leftFraction <= 1 + 1e-8;
      const withinRight = rightFraction >= -1e-8 && rightFraction <= 1 + 1e-8;
      const leftInterior = leftFraction > 1e-8 && leftFraction < 1 - 1e-8;
      const rightInterior = rightFraction > 1e-8 && rightFraction < 1 - 1e-8;
      if (
        withinLeft &&
        withinRight &&
        (leftInterior || rightInterior)
      ) {
        return { valid: false, retracedPairs: retracedPairs.length };
      }
    }
  }
  if (retracedPairs.length === 0) {
    return { valid: false, retracedPairs: 0 };
  }
  const retracedSegmentIndexes = new Set<number>();
  for (let leftIndex = 0; leftIndex < segmentCount; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < segmentCount;
      rightIndex += 1
    ) {
      if (
        segmentsMatch(
          points[leftIndex],
          points[leftIndex + 1],
          points[rightIndex],
          points[rightIndex + 1]
        )
      ) {
        retracedSegmentIndexes.add(leftIndex);
        retracedSegmentIndexes.add(rightIndex);
      }
    }
  }
  if (retracedSegmentIndexes.size === segmentCount) {
    return { valid: false, retracedPairs: retracedPairs.length };
  }

  const groups: Array<Array<{ left: number; right: number }>> = [];
  for (const pair of retracedPairs) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (
      group &&
      previous &&
      pair.left === previous.left + 1 &&
      pair.right === previous.right - 1
    ) {
      group.push(pair);
    } else {
      groups.push([pair]);
    }
  }
  if (
    !groups.every((group) => {
      const lastPair = group.at(-1)!;
      return pointsMatch(points[lastPair.left + 1], points[lastPair.right]);
    })
  ) {
    return { valid: false, retracedPairs: retracedPairs.length };
  }

  if (
    groups.length !== 1 ||
    groups[0][0].left !== 0 ||
    groups[0][0].right !== segmentCount - 1
  ) {
    return { valid: false, retracedPairs: retracedPairs.length };
  }
  const stemEnd = groups[0].at(-1)!;
  const loop = points.slice(stemEnd.left + 1, stemEnd.right + 1);
  return {
    valid: isSimpleClosedRoute(loop),
    retracedPairs: retracedPairs.length,
  };
}

export function isSimpleClosedRoute(points: readonly LatLng[]): boolean {
  const segmentCount = points.length - 1;
  if (
    points.length < 4 ||
    !pointsMatch(points[0], points[points.length - 1])
  ) {
    return false;
  }
  for (let index = 0; index < segmentCount; index += 1) {
    if (pointsMatch(points[index], points[index + 1])) return false;
  }

  for (let leftIndex = 0; leftIndex < segmentCount; leftIndex += 1) {
    const leftStart = points[leftIndex];
    const leftEnd = points[leftIndex + 1];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < segmentCount;
      rightIndex += 1
    ) {
      const adjacent =
        rightIndex === leftIndex + 1 ||
        (leftIndex === 0 && rightIndex === segmentCount - 1);
      if (adjacent) continue;
      const rightStart = points[rightIndex];
      const rightEnd = points[rightIndex + 1];
      if (
        pointsMatch(leftStart, rightStart) ||
        pointsMatch(leftStart, rightEnd) ||
        pointsMatch(leftEnd, rightStart) ||
        pointsMatch(leftEnd, rightEnd) ||
        pointOnSegmentInterior(leftStart, rightStart, rightEnd) ||
        pointOnSegmentInterior(leftEnd, rightStart, rightEnd) ||
        pointOnSegmentInterior(rightStart, leftStart, leftEnd) ||
        pointOnSegmentInterior(rightEnd, leftStart, leftEnd)
      ) {
        return false;
      }

      const latitude =
        (leftStart.lat + leftEnd.lat + rightStart.lat + rightEnd.lat) / 4;
      const lngScale = Math.cos(latitude * Math.PI / 180);
      const bx =
        normalizedLongitudeDelta(leftEnd.lng - leftStart.lng) * lngScale;
      const by = leftEnd.lat - leftStart.lat;
      const cx =
        normalizedLongitudeDelta(rightStart.lng - leftStart.lng) * lngScale;
      const cy = rightStart.lat - leftStart.lat;
      const dx =
        (normalizedLongitudeDelta(rightStart.lng - leftStart.lng) +
          normalizedLongitudeDelta(rightEnd.lng - rightStart.lng)) *
        lngScale;
      const dy = rightEnd.lat - leftStart.lat;
      const sx = dx - cx;
      const sy = dy - cy;
      const denominator = bx * sy - by * sx;
      const crossQpR = cx * by - cy * bx;
      if (Math.abs(denominator) < 1e-14) {
        continue;
      }
      const leftFraction = (cx * sy - cy * sx) / denominator;
      const rightFraction = crossQpR / denominator;
      if (
        leftFraction >= -1e-8 &&
        leftFraction <= 1 + 1e-8 &&
        rightFraction >= -1e-8 &&
        rightFraction <= 1 + 1e-8
      ) {
        return false;
      }
    }
  }
  return true;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ];
}

export function reviewOfficialRouteGeometry(
  points: readonly LatLng[],
  paths: readonly OfficialNetworkPath[],
  citedFeatureIds: readonly string[],
  options: OfficialRouteReviewOptions = {}
): OfficialRouteReview {
  const cited = normalizeOfficialFeatureIds(citedFeatureIds);
  const segments = officialSourceSegments(paths);
  const partition = connectorPartition(points, segments);
  const excludedSegmentIndexes = new Set(
    options.internalConnectorSegmentIndexes ?? []
  );
  const topology = sourceNetworkTopologyReview(
    points,
    paths,
    partition.coreStartIndex,
    partition.coreEndIndex,
    excludedSegmentIndexes
  );
  const offsetExcludedSegmentIndexes = new Set([
    ...excludedSegmentIndexes,
    ...topology.connectorSegmentIndexes,
  ]);
  const internalConnectors = [...excludedSegmentIndexes].map((index) => {
    if (
      !Number.isInteger(index) ||
      index < partition.coreStartIndex ||
      index >= partition.coreEndIndex
    ) {
      return {
        lengthM: Number.POSITIVE_INFINITY,
        joinOffsetM: Number.POSITIVE_INFINITY,
      };
    }
    return {
      lengthM: haversineMeters(points[index], points[index + 1]),
      joinOffsetM: Math.min(
        nearest(points[index], segments).distance,
        nearest(points[index + 1], segments).distance
      ),
    };
  });
  const core = routeCoreSamples(
    points,
    partition.coreStartIndex,
    partition.coreEndIndex,
    offsetExcludedSegmentIndexes
  );
  const offsets = core.map((point) => nearest(point, segments).distance);
  const usedFeatureIds = cited.filter((featureId) => {
    const featureSegments = segments.filter(
      (segment) => segment.featureId === featureId
    );
    return featureContributesMeaningfully(
      points,
      partition.coreStartIndex,
      partition.coreEndIndex,
      offsetExcludedSegmentIndexes,
      featureSegments
    );
  });
  return {
    startConnectorM: partition.startConnectorM,
    endConnectorM: partition.endConnectorM,
    startConnectorJoinOffsetM: partition.startConnectorJoinOffsetM,
    endConnectorJoinOffsetM: partition.endConnectorJoinOffsetM,
    internalConnectorMaxM:
      internalConnectors.length > 0
        ? Math.max(...internalConnectors.map(({ lengthM }) => lengthM))
        : 0,
    internalConnectorJoinMaxOffsetM:
      internalConnectors.length > 0
        ? Math.max(...internalConnectors.map(({ joinOffsetM }) => joinOffsetM))
        : 0,
    coreMaxOffsetM: offsets.length > 0 ? Math.max(...offsets) : Number.POSITIVE_INFINITY,
    coreP95OffsetM: percentile(offsets, 0.95),
    coreCoveragePct:
      offsets.length === 0
        ? 0
        : 100 *
          offsets.filter((offset) => offset <= CORE_COVERAGE_DISTANCE_M).length /
          offsets.length,
    coreSampleCount: core.length,
    sourceTopologyValid: topology.valid,
    usedFeatureIds,
    unusedFeatureIds: cited.filter((featureId) => !usedFeatureIds.includes(featureId)),
  };
}

export default {
  buildOfficialArcgisQueryUrl,
  buildOfficialRoutePath,
  collectOfficialPathMetadata,
  haversineMeters,
  isSimpleClosedRoute,
  normalizeOfficialFeatureIds,
  officialSourceSegments,
  parseOfficialArcgisPaths,
  parseOfficialFeatureIdsFromSourceUrl,
  reviewLollipopRetrace,
  reviewOfficialRouteGeometry,
};
