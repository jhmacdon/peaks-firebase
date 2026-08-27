import {
  interpolateWorldPosition,
  normalizeLongitudeDelta,
  pointToSegmentMeters,
} from "./route-world-geometry";

export type OsmRoutePoint = {
  lat: number;
  lng: number;
};

export type OsmRouteSourceSegment = {
  wayId: number;
  start: OsmRoutePoint;
  end: OsmRoutePoint;
};

export type OsmRouteGraphSegment = OsmRouteSourceSegment & {
  startNodeId: number;
  endNodeId: number;
};

export type OsmRouteGeometryReview = {
  coreStartIndex: number;
  coreEndIndex: number;
  startConnectorM: number;
  endConnectorM: number;
  startConnectorJoinOffsetM: number;
  endConnectorJoinOffsetM: number;
  coreSamples: OsmRoutePoint[];
};

export type OsmRouteTopologyReview = {
  valid: boolean;
  startNetworkPointIndex: number;
  endNetworkPointIndex: number;
  startConnectorM: number;
  endConnectorM: number;
  endpointConnectorSegmentIndexes: number[];
};

const EARTH_RADIUS_M = 6_371_000;
const CORE_JOIN_MAX_OFFSET_M = 5;
const CORE_SAMPLE_STEP_M = 20;
const MAX_CORE_SAMPLES = 100_000;
const TOPOLOGY_MAX_OFFSET_M = 5;
const TOPOLOGY_NODE_MATCH_MAX_M = 5;
const TOPOLOGY_DIRECTION_ALIGNMENT_MIN = 0.99;

function radians(value: number): number {
  return value * Math.PI / 180;
}

export function osmRouteHaversineMeters(
  first: OsmRoutePoint,
  second: OsmRoutePoint
): number {
  const dLat = radians(second.lat - first.lat);
  const dLng = radians(second.lng - first.lng);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(first.lat)) *
      Math.cos(radians(second.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function nearestOsmRouteSource(
  point: OsmRoutePoint,
  segments: readonly OsmRouteSourceSegment[]
): { distance: number; wayId: number } {
  let distance = Number.POSITIVE_INFINITY;
  let wayId = -1;
  for (const segment of segments) {
    const candidate = pointToSegmentMeters(point, segment.start, segment.end);
    if (candidate < distance) {
      distance = candidate;
      wayId = segment.wayId;
    }
  }
  return { distance, wayId };
}

function routeDistanceMeters(
  points: readonly OsmRoutePoint[],
  startIndex: number,
  endIndex: number
): number {
  let distanceM = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    distanceM += osmRouteHaversineMeters(points[index], points[index + 1]);
  }
  return distanceM;
}

function directionAlignment(
  routeStart: OsmRoutePoint,
  routeEnd: OsmRoutePoint,
  source: OsmRouteGraphSegment
): number {
  const referenceLat =
    (routeStart.lat + routeEnd.lat + source.start.lat + source.end.lat) / 4;
  const xScale = Math.cos(radians(referenceLat));
  const routeX = normalizeLongitudeDelta(routeEnd.lng - routeStart.lng) * xScale;
  const routeY = routeEnd.lat - routeStart.lat;
  const sourceX = normalizeLongitudeDelta(source.end.lng - source.start.lng) * xScale;
  const sourceY = source.end.lat - source.start.lat;
  const routeLength = Math.hypot(routeX, routeY);
  const sourceLength = Math.hypot(sourceX, sourceY);
  if (routeLength === 0 || sourceLength === 0) return 0;
  return Math.abs(routeX * sourceX + routeY * sourceY) /
    (routeLength * sourceLength);
}

function graphSegmentSupportsRouteSegment(
  routeStart: OsmRoutePoint,
  routeEnd: OsmRoutePoint,
  source: OsmRouteGraphSegment
): boolean {
  const [midLng, midLat] = interpolateWorldPosition(
    [routeStart.lng, routeStart.lat],
    [routeEnd.lng, routeEnd.lat],
    0.5
  );
  return (
    pointToSegmentMeters(routeStart, source.start, source.end) <=
      TOPOLOGY_MAX_OFFSET_M &&
    pointToSegmentMeters(routeEnd, source.start, source.end) <=
      TOPOLOGY_MAX_OFFSET_M &&
    pointToSegmentMeters(
      { lat: midLat, lng: midLng },
      source.start,
      source.end
    ) <= TOPOLOGY_MAX_OFFSET_M &&
    directionAlignment(routeStart, routeEnd, source) >=
      TOPOLOGY_DIRECTION_ALIGNMENT_MIN
  );
}

function pointMatchesNode(
  point: OsmRoutePoint,
  segment: OsmRouteGraphSegment,
  nodeId: number
): boolean {
  if (
    segment.startNodeId === nodeId &&
    osmRouteHaversineMeters(point, segment.start) <= TOPOLOGY_NODE_MATCH_MAX_M
  ) {
    return true;
  }
  return (
    segment.endNodeId === nodeId &&
    osmRouteHaversineMeters(point, segment.end) <= TOPOLOGY_NODE_MATCH_MAX_M
  );
}

function pointMatchesEitherNode(
  point: OsmRoutePoint,
  segment: OsmRouteGraphSegment
): boolean {
  return (
    pointMatchesNode(point, segment, segment.startNodeId) ||
    pointMatchesNode(point, segment, segment.endNodeId)
  );
}

function sameGraphEdge(
  first: OsmRouteGraphSegment,
  second: OsmRouteGraphSegment
): boolean {
  return (
    (first.startNodeId === second.startNodeId &&
      first.endNodeId === second.endNodeId) ||
    (first.startNodeId === second.endNodeId &&
      first.endNodeId === second.startNodeId)
  );
}

function graphTransitionAllowed(
  first: OsmRouteGraphSegment,
  second: OsmRouteGraphSegment,
  routeJoint: OsmRoutePoint
): boolean {
  if (sameGraphEdge(first, second)) return true;
  const sharedNodeIds = [first.startNodeId, first.endNodeId].filter(
    (nodeId) =>
      nodeId === second.startNodeId || nodeId === second.endNodeId
  );
  return sharedNodeIds.some(
    (nodeId) =>
      pointMatchesNode(routeJoint, first, nodeId) &&
      pointMatchesNode(routeJoint, second, nodeId)
  );
}

function topologyRunValid(
  points: readonly OsmRoutePoint[],
  graphSegments: readonly OsmRouteGraphSegment[],
  segmentIndexes: readonly number[]
): boolean {
  if (segmentIndexes.length === 0) return false;
  const candidates = segmentIndexes.map((segmentIndex) =>
    graphSegments.flatMap((segment, sourceIndex) =>
      graphSegmentSupportsRouteSegment(
        points[segmentIndex],
        points[segmentIndex + 1],
        segment
      )
        ? [sourceIndex]
        : []
    )
  );
  if (candidates.some((values) => values.length === 0)) return false;

  let reachable = new Set(
    candidates[0].filter((sourceIndex) =>
      pointMatchesEitherNode(
        points[segmentIndexes[0]],
        graphSegments[sourceIndex]
      )
    )
  );
  if (reachable.size === 0) return false;

  for (let index = 1; index < segmentIndexes.length; index += 1) {
    const routeJoint = points[segmentIndexes[index]];
    const nextReachable = new Set<number>();
    for (const priorSourceIndex of reachable) {
      for (const sourceIndex of candidates[index]) {
        if (
          graphTransitionAllowed(
            graphSegments[priorSourceIndex],
            graphSegments[sourceIndex],
            routeJoint
          )
        ) {
          nextReachable.add(sourceIndex);
        }
      }
    }
    if (nextReachable.size === 0) return false;
    reachable = nextReachable;
  }

  const routeEnd = points[segmentIndexes.at(-1)! + 1];
  return [...reachable].some((sourceIndex) =>
    pointMatchesEitherNode(routeEnd, graphSegments[sourceIndex])
  );
}

function topologyRangeValid(
  points: readonly OsmRoutePoint[],
  graphSegments: readonly OsmRouteGraphSegment[],
  startNetworkPointIndex: number,
  endNetworkPointIndex: number,
  excludedSegmentIndexes: ReadonlySet<number>
): boolean {
  const runs: number[][] = [];
  let run: number[] = [];
  for (
    let segmentIndex = startNetworkPointIndex;
    segmentIndex < endNetworkPointIndex;
    segmentIndex += 1
  ) {
    if (excludedSegmentIndexes.has(segmentIndex)) {
      if (run.length > 0) runs.push(run);
      run = [];
      continue;
    }
    run.push(segmentIndex);
  }
  if (run.length > 0) runs.push(run);
  return (
    runs.length > 0 &&
    runs.every((segmentIndexes) =>
      topologyRunValid(points, graphSegments, segmentIndexes)
    )
  );
}

function pointMatchesAnyGraphNode(
  point: OsmRoutePoint,
  graphSegments: readonly OsmRouteGraphSegment[]
): boolean {
  return graphSegments.some((segment) => pointMatchesEitherNode(point, segment));
}

export function reviewOsmRouteTopology(
  points: readonly OsmRoutePoint[],
  graphSegments: readonly OsmRouteGraphSegment[],
  options: { excludedCoreSegmentIndexes?: readonly number[] } = {}
): OsmRouteTopologyReview {
  const failed = (): OsmRouteTopologyReview => ({
    valid: false,
    startNetworkPointIndex: -1,
    endNetworkPointIndex: -1,
    startConnectorM: Number.POSITIVE_INFINITY,
    endConnectorM: Number.POSITIVE_INFINITY,
    endpointConnectorSegmentIndexes: [],
  });
  if (points.length < 2 || graphSegments.length === 0) return failed();

  const lastPointIndex = points.length - 1;
  const excluded = new Set(options.excludedCoreSegmentIndexes ?? []);
  for (const index of excluded) {
    if (!Number.isInteger(index) || index < 0 || index >= lastPointIndex) {
      throw new Error("excluded OSM topology segment index is outside the route");
    }
  }

  const startCandidates = [0, 1].filter(
    (index) =>
      index < lastPointIndex &&
      pointMatchesAnyGraphNode(points[index], graphSegments)
  );
  const endCandidates = [lastPointIndex, lastPointIndex - 1].filter(
    (index) =>
      index > 0 && pointMatchesAnyGraphNode(points[index], graphSegments)
  );
  const valid: OsmRouteTopologyReview[] = [];
  for (const startNetworkPointIndex of startCandidates) {
    for (const endNetworkPointIndex of endCandidates) {
      if (startNetworkPointIndex >= endNetworkPointIndex) continue;
      if (
        [...excluded].some(
          (index) =>
            index < startNetworkPointIndex || index >= endNetworkPointIndex
        )
      ) {
        continue;
      }
      if (
        !topologyRangeValid(
          points,
          graphSegments,
          startNetworkPointIndex,
          endNetworkPointIndex,
          excluded
        )
      ) {
        continue;
      }
      const endpointConnectorSegmentIndexes = [
        ...(startNetworkPointIndex === 1 ? [0] : []),
        ...(endNetworkPointIndex === lastPointIndex - 1
          ? [lastPointIndex - 1]
          : []),
      ];
      valid.push({
        valid: true,
        startNetworkPointIndex,
        endNetworkPointIndex,
        startConnectorM: routeDistanceMeters(
          points,
          0,
          startNetworkPointIndex
        ),
        endConnectorM: routeDistanceMeters(
          points,
          endNetworkPointIndex,
          lastPointIndex
        ),
        endpointConnectorSegmentIndexes,
      });
    }
  }
  valid.sort(
    (left, right) =>
      left.startConnectorM + left.endConnectorM -
        (right.startConnectorM + right.endConnectorM) ||
      left.startNetworkPointIndex - right.startNetworkPointIndex ||
      right.endNetworkPointIndex - left.endNetworkPointIndex
  );
  return valid[0] ?? failed();
}

function sampleCore(
  points: readonly OsmRoutePoint[],
  coreStartIndex: number,
  coreEndIndex: number,
  excludedSegmentIndexes: ReadonlySet<number>
): OsmRoutePoint[] {
  const samples: OsmRoutePoint[] = [];
  for (let index = coreStartIndex; index < coreEndIndex; index += 1) {
    if (excludedSegmentIndexes.has(index)) continue;
    const start = points[index];
    const end = points[index + 1];
    const intervalCount = Math.max(
      2,
      Math.ceil(osmRouteHaversineMeters(start, end) / CORE_SAMPLE_STEP_M)
    );
    if (samples.length + intervalCount + 1 > MAX_CORE_SAMPLES) {
      throw new Error(
        `route core exceeds the ${MAX_CORE_SAMPLES}-sample review limit`
      );
    }
    for (let step = 0; step <= intervalCount; step += 1) {
      const [lng, lat] = interpolateWorldPosition(
        [start.lng, start.lat],
        [end.lng, end.lat],
        step / intervalCount
      );
      const prior = samples.at(-1);
      if (prior && osmRouteHaversineMeters(prior, { lat, lng }) <= 0.01) {
        continue;
      }
      samples.push({ lat, lng });
    }
  }
  return samples;
}

export function reviewOsmRouteGeometry(
  points: readonly OsmRoutePoint[],
  segments: readonly OsmRouteSourceSegment[],
  options: { excludedCoreSegmentIndexes?: readonly number[] } = {}
): OsmRouteGeometryReview {
  if (points.length < 2 || segments.length === 0) {
    return {
      coreStartIndex: -1,
      coreEndIndex: -1,
      startConnectorM: Number.POSITIVE_INFINITY,
      endConnectorM: Number.POSITIVE_INFINITY,
      startConnectorJoinOffsetM: Number.POSITIVE_INFINITY,
      endConnectorJoinOffsetM: Number.POSITIVE_INFINITY,
      coreSamples: [],
    };
  }
  const offsets = points.map(
    (point) => nearestOsmRouteSource(point, segments).distance
  );
  const coreStartIndex = offsets.findIndex(
    (offset) => offset <= CORE_JOIN_MAX_OFFSET_M
  );
  let coreEndIndex = -1;
  for (let index = offsets.length - 1; index >= 0; index -= 1) {
    if (offsets[index] <= CORE_JOIN_MAX_OFFSET_M) {
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
      coreSamples: [],
    };
  }
  const excluded = new Set(options.excludedCoreSegmentIndexes ?? []);
  for (const index of excluded) {
    if (
      !Number.isInteger(index) ||
      index < coreStartIndex ||
      index >= coreEndIndex
    ) {
      throw new Error("excluded OSM core segment index is outside the route core");
    }
  }
  return {
    coreStartIndex,
    coreEndIndex,
    startConnectorM: routeDistanceMeters(points, 0, coreStartIndex),
    endConnectorM: routeDistanceMeters(points, coreEndIndex, points.length - 1),
    startConnectorJoinOffsetM: offsets[coreStartIndex],
    endConnectorJoinOffsetM: offsets[coreEndIndex],
    coreSamples: sampleCore(points, coreStartIndex, coreEndIndex, excluded),
  };
}

export default {
  nearestOsmRouteSource,
  osmRouteHaversineMeters,
  reviewOsmRouteGeometry,
  reviewOsmRouteTopology,
};
