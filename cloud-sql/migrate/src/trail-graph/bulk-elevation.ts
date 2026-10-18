import { sampleTerrariumProfile } from '../lib/terrarium-route-profile';
import type { Segment } from './types';

function validElevation(value: number): boolean {
  return Number.isFinite(value) && value !== 0 && value >= -500 && value <= 9000;
}

/**
 * Samples a whole batch before its write transaction. Frozen XYZ is returned
 * unchanged; callers must reuse those stored segments and never update them.
 */
export async function sampleBulkSegments(
  segments: Segment[],
  options: { cacheDir: string; fetcher?: typeof fetch; concurrency?: number }
): Promise<Map<string, number[][]>> {
  const concurrency = options.concurrency ?? 8;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('Bulk Terrarium concurrency must be an integer from 1 to 8');
  }
  const profiles = new Map<string, number[][]>();
  const sampled: Segment[] = [];
  const points: Array<{ lng: number; lat: number }> = [];
  const seen = new Map<string, Segment>();
  for (const segment of segments) {
    const previous = seen.get(segment.id);
    if (previous) {
      if (JSON.stringify(previous.coords) !== JSON.stringify(segment.coords) ||
          JSON.stringify(previous.frozen_catalog) !== JSON.stringify(segment.frozen_catalog)) {
        throw new Error(`Conflicting bulk segment geometry ${segment.id}`);
      }
      continue;
    }
    seen.set(segment.id, segment);
    if (segment.frozen_partial) throw new Error(`Partial frozen segment is review-only: ${segment.id}`);
    if (segment.coords.length < 2) throw new Error(`Incomplete/invalid elevation profile ${segment.id}`);
    if (segment.frozen_catalog) {
      const xyz = segment.frozen_catalog.coords_xyz;
      if (xyz.length !== segment.coords.length || xyz.some((point, index) =>
        point.length !== 3 || !point.every(Number.isFinite) || !validElevation(point[2]) ||
        point[0] !== segment.coords[index][0] || point[1] !== segment.coords[index][1]
      )) throw new Error(`Frozen segment lacks usable exact XYZ: ${segment.id}`);
      profiles.set(segment.id, xyz);
    } else {
      sampled.push(segment);
      for (const [lng, lat] of segment.coords) points.push({ lng, lat });
    }
  }
  if (points.length === 0) return profiles;
  const elevations = await sampleTerrariumProfile(points, { ...options, concurrency });
  if (elevations.length !== points.length) throw new Error('Incomplete/invalid bulk elevation profile');
  // A segment with any unusable sample gets no profile; the caller fails only
  // the routes that use it, not the whole batch.
  let offset = 0;
  for (const segment of sampled) {
    const xyz = segment.coords.map(([lng, lat]) => [lng, lat, elevations[offset++]]);
    if (xyz.every(point => validElevation(point[2]))) profiles.set(segment.id, xyz);
  }
  return profiles;
}
