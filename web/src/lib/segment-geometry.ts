import type { TrackPoint } from "./route-utils";

export interface VertexSplit {
  vertexIndices: number[];
  originalPointCount: number;
}

function exactSplitCuts(split: VertexSplit): number[] {
  if (!Array.isArray(split.vertexIndices) || !Number.isInteger(split.originalPointCount)
    || split.originalPointCount < 2 || split.vertexIndices.some((index, position) =>
      !Number.isInteger(index) || index <= 0 || index >= split.originalPointCount - 1
      || (position > 0 && index <= split.vertexIndices[position - 1]))) {
    throw new Error("segment_split_vertex_indices_invalid");
  }
  return [0, ...split.vertexIndices, split.originalPointCount - 1];
}

/** Split at actual vertices, retaining both XYZ and the shared boundary point. */
export function splitSegmentAtVertices(points: TrackPoint[], split: VertexSplit): TrackPoint[][] {
  const cuts = exactSplitCuts(split);
  if (points.length !== split.originalPointCount) throw new Error("segment_split_geometry_changed");
  if (points.some(point => ![point.lat, point.lng, point.ele].every(Number.isFinite))) {
    throw new Error("segment_split_geometry_invalid");
  }
  return cuts.slice(1).map((end, index) => points.slice(cuts[index], end + 1));
}

/** Select every stored split piece in an exact, directed source interval. */
export function splitSegmentPieceIndices(
  split: VertexSplit, start: number | undefined, end: number | undefined,
  direction: "forward" | "reverse"
): number[] {
  const cuts = exactSplitCuts(split);
  if (start === undefined || end === undefined || start >= end
    || !cuts.includes(start) || !cuts.includes(end)) throw new Error("segment_split_interval_invalid");
  const pieces = cuts.slice(0, -1).flatMap((value, index) =>
    value >= start && cuts[index + 1] <= end ? [index] : []);
  if (!pieces.length) throw new Error("segment_split_interval_empty");
  return direction === "reverse" ? pieces.reverse() : pieces;
}

/** Extract points between two cumulative distances, interpolating at boundaries. */
export function extractSubPoints(
  points: TrackPoint[],
  startDist: number,
  endDist: number
): TrackPoint[] {
  const result: TrackPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const distance = points[i].dist;

    if (distance >= startDist && distance <= endDist) {
      if (result.length === 0 && i > 0 && points[i - 1].dist < startDist) {
        result.push(interpolatePoint(points[i - 1], points[i], startDist));
      }
      result.push(points[i]);
    } else if (distance > endDist && result.length > 0) {
      result.push(interpolatePoint(points[i - 1], points[i], endDist));
      break;
    }
  }

  if (result.length === 0 && points.length > 0) {
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i].dist <= startDist && points[i + 1].dist >= startDist) {
        result.push(interpolatePoint(points[i], points[i + 1], startDist));
        for (
          let j = i + 1;
          j < points.length && points[j].dist <= endDist;
          j++
        ) {
          result.push(points[j]);
        }
        break;
      }
    }
  }

  return result;
}

function interpolatePoint(
  first: TrackPoint,
  second: TrackPoint,
  targetDist: number
): TrackPoint {
  const segmentDistance = second.dist - first.dist;
  if (segmentDistance === 0) return { ...first };
  const fraction = (targetDist - first.dist) / segmentDistance;
  return {
    lat: first.lat + (second.lat - first.lat) * fraction,
    lng: first.lng + (second.lng - first.lng) * fraction,
    ele: first.ele + (second.ele - first.ele) * fraction,
    dist: targetDist,
  };
}
