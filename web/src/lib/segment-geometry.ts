import type { TrackPoint } from "./route-utils";

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
