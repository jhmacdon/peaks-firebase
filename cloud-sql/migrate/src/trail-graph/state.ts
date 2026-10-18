import { resolve } from 'node:path';
import type { Coord } from './types';

export type StateCode = 'WA' | 'OR' | 'CA' | 'ID';
export type Bbox = readonly [number, number, number, number];
export interface StateConfig { code: StateCode; name: string; slug: string; bbox: Bbox; input: string; osmSourceUrl: string }
const PRIVATE = '/Users/josiahm/projects/peaks/private';
const STATES: Record<StateCode, { name: string; slug: string; bbox: Bbox }> = {
  WA: { name: 'Washington', slug: 'washington', bbox: [-124.85, 45.54, -116.91, 49.01] },
  OR: { name: 'Oregon', slug: 'oregon', bbox: [-124.75, 41.95, -116.45, 46.30] },
  CA: { name: 'California', slug: 'california', bbox: [-124.50, 32.40, -114.10, 42.10] },
  ID: { name: 'Idaho', slug: 'idaho', bbox: [-117.30, 41.95, -111.00, 49.05] },
};
export function parseState(value = 'WA'): StateCode {
  const code = value.toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(STATES, code)) throw new Error(`Unsupported state ${value}; expected WA, OR, CA, or ID`);
  return code as StateCode;
}
export function stateConfig(value: string = 'WA'): StateConfig {
  const code = parseState(value), state = STATES[code];
  return { code, ...state, input: code === 'WA' ? `${PRIVATE}/wa-trail-data` : `${PRIVATE}/west-trail-data/${state.slug}`,
    osmSourceUrl: `https://download.geofabrik.de/north-america/us/${state.slug}.html` };
}
export function statePaths(value: string = 'WA', cacheRoot = resolve(__dirname, '../../../../.cache')) {
  const state = stateConfig(value), root = resolve(cacheRoot, state.code.toLowerCase());
  return { input: state.input, root, graph: resolve(root, 'graph'), compose: resolve(root, 'compose') };
}
export const withinBbox = ([lon, lat]: Coord, [west, south, east, north]: Bbox): boolean => lon >= west && lon <= east && lat >= south && lat <= north;
/** Keep a whole source line if its extent touches the state's buffered bounds.
 * Do not cut geometry or invent source nodes at a rectangle edge. */
export function intersectsBbox(coords: Coord[], [west, south, east, north]: Bbox): boolean {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of coords) { minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); }
  return minLon <= east && maxLon >= west && minLat <= north && maxLat >= south;
}
