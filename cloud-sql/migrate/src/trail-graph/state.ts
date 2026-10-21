import { resolve } from 'node:path';
import type { Coord } from './types';

export type Bbox = readonly [number, number, number, number];
const STATES = {
  AL: { name: 'Alabama', slug: 'alabama', bbox: [-88.60, 30.10, -84.70, 35.10] },
  AK: {
    name: 'Alaska', slug: 'alaska', bbox: [-170.00, 51.00, -129.90, 72.00],
    // Geofabrik and the graph tools use a non-wrapping box. Stop at -170 so
    // the Aleutians do not make this input clip cross the antimeridian.
  },
  AZ: { name: 'Arizona', slug: 'arizona', bbox: [-114.90, 31.20, -108.80, 37.10] },
  AR: { name: 'Arkansas', slug: 'arkansas', bbox: [-94.70, 32.90, -89.50, 36.60] },
  CA: { name: 'California', slug: 'california', bbox: [-124.50, 32.40, -114.10, 42.10] },
  CO: { name: 'Colorado', slug: 'colorado', bbox: [-109.20, 36.90, -101.90, 41.10] },
  CT: { name: 'Connecticut', slug: 'connecticut', bbox: [-73.80, 40.90, -71.70, 42.20] },
  DE: { name: 'Delaware', slug: 'delaware', bbox: [-75.90, 38.30, -74.90, 39.90] },
  DC: { name: 'District of Columbia', slug: 'district-of-columbia', bbox: [-77.20, 38.75, -76.85, 39.05] },
  FL: { name: 'Florida', slug: 'florida', bbox: [-87.80, 24.30, -79.80, 31.10] },
  GA: { name: 'Georgia', slug: 'georgia', bbox: [-85.70, 30.20, -80.70, 35.10] },
  HI: { name: 'Hawaii', slug: 'hawaii', bbox: [-179.00, 18.00, -154.00, 29.00] },
  ID: { name: 'Idaho', slug: 'idaho', bbox: [-117.30, 41.95, -111.00, 49.05] },
  IL: { name: 'Illinois', slug: 'illinois', bbox: [-91.70, 36.90, -87.30, 42.60] },
  IN: { name: 'Indiana', slug: 'indiana', bbox: [-88.20, 37.70, -84.70, 41.90] },
  IA: { name: 'Iowa', slug: 'iowa', bbox: [-96.70, 40.30, -90.00, 43.60] },
  KS: { name: 'Kansas', slug: 'kansas', bbox: [-102.20, 36.90, -94.50, 40.10] },
  KY: { name: 'Kentucky', slug: 'kentucky', bbox: [-89.70, 36.40, -81.80, 39.30] },
  LA: { name: 'Louisiana', slug: 'louisiana', bbox: [-94.10, 28.80, -88.70, 33.10] },
  ME: { name: 'Maine', slug: 'maine', bbox: [-71.20, 42.90, -66.80, 47.60] },
  MD: { name: 'Maryland', slug: 'maryland', bbox: [-79.60, 37.80, -74.90, 39.80] },
  MA: { name: 'Massachusetts', slug: 'massachusetts', bbox: [-73.60, 41.10, -69.80, 42.95] },
  MI: { name: 'Michigan', slug: 'michigan', bbox: [-90.60, 41.60, -82.10, 48.40] },
  MN: { name: 'Minnesota', slug: 'minnesota', bbox: [-97.40, 43.40, -89.40, 49.40] },
  MS: { name: 'Mississippi', slug: 'mississippi', bbox: [-91.80, 30.00, -88.00, 35.10] },
  MO: { name: 'Missouri', slug: 'missouri', bbox: [-95.90, 35.90, -89.00, 40.70] },
  MT: { name: 'Montana', slug: 'montana', bbox: [-116.20, 44.20, -103.90, 49.10] },
  NE: { name: 'Nebraska', slug: 'nebraska', bbox: [-104.20, 39.90, -95.20, 43.10] },
  NV: { name: 'Nevada', slug: 'nevada', bbox: [-120.10, 34.90, -113.90, 42.10] },
  NH: { name: 'New Hampshire', slug: 'new-hampshire', bbox: [-72.70, 42.60, -70.60, 45.40] },
  NJ: { name: 'New Jersey', slug: 'new-jersey', bbox: [-75.70, 38.80, -73.80, 41.40] },
  NM: { name: 'New Mexico', slug: 'new-mexico', bbox: [-109.20, 31.20, -102.80, 37.10] },
  NY: { name: 'New York', slug: 'new-york', bbox: [-80.00, 40.40, -71.70, 45.10] },
  NC: { name: 'North Carolina', slug: 'north-carolina', bbox: [-84.40, 33.70, -75.30, 36.70] },
  ND: { name: 'North Dakota', slug: 'north-dakota', bbox: [-104.20, 45.80, -96.40, 49.10] },
  OH: { name: 'Ohio', slug: 'ohio', bbox: [-84.90, 38.30, -80.40, 42.10] },
  OK: { name: 'Oklahoma', slug: 'oklahoma', bbox: [-103.10, 33.50, -94.30, 37.10] },
  OR: { name: 'Oregon', slug: 'oregon', bbox: [-124.75, 41.95, -116.45, 46.30] },
  PA: { name: 'Pennsylvania', slug: 'pennsylvania', bbox: [-80.60, 39.60, -74.60, 42.60] },
  RI: { name: 'Rhode Island', slug: 'rhode-island', bbox: [-71.95, 41.00, -71.05, 42.10] },
  SC: { name: 'South Carolina', slug: 'south-carolina', bbox: [-83.50, 32.00, -78.40, 35.30] },
  SD: { name: 'South Dakota', slug: 'south-dakota', bbox: [-104.20, 42.40, -96.30, 46.10] },
  TN: { name: 'Tennessee', slug: 'tennessee', bbox: [-90.40, 34.90, -81.50, 36.80] },
  TX: { name: 'Texas', slug: 'texas', bbox: [-106.80, 25.70, -93.40, 36.60] },
  UT: { name: 'Utah', slug: 'utah', bbox: [-114.20, 36.90, -108.90, 42.10] },
  VT: { name: 'Vermont', slug: 'vermont', bbox: [-73.50, 42.70, -71.40, 45.10] },
  VA: { name: 'Virginia', slug: 'virginia', bbox: [-83.80, 36.40, -75.10, 39.60] },
  WA: { name: 'Washington', slug: 'washington', bbox: [-124.85, 45.54, -116.91, 49.01] },
  WV: { name: 'West Virginia', slug: 'west-virginia', bbox: [-82.80, 37.10, -77.60, 40.70] },
  WI: { name: 'Wisconsin', slug: 'wisconsin', bbox: [-93.00, 42.40, -86.70, 47.40] },
  WY: { name: 'Wyoming', slug: 'wyoming', bbox: [-111.20, 40.90, -103.90, 45.10] },
} as const satisfies Record<string, { name: string; slug: string; bbox: Bbox }>;
export type StateCode = keyof typeof STATES;
export type BulkState = Exclude<StateCode, 'WA'>;
export const STATE_CODES = Object.keys(STATES) as StateCode[];
export interface StateConfig { code: StateCode; name: string; slug: string; bbox: Bbox; input: string; osmSourceUrl: string }
const PRIVATE = '/Users/josiahm/projects/peaks/private';
export function parseState(value = 'WA'): StateCode {
  const code = value.toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(STATES, code)) throw new Error(`Unsupported state ${value}; expected a two-letter US state or DC code`);
  return code as StateCode;
}
export function parseBulkState(value: string): BulkState {
  const state = parseState(value);
  if (state === 'WA') throw new Error('--bulk requires a non-WA --state');
  return state;
}
export function stateConfig(value: string = 'WA'): StateConfig {
  const code = parseState(value), state = STATES[code];
  const input = code === 'WA' ? `${PRIVATE}/wa-trail-data`
    : code === 'OR' || code === 'CA' || code === 'ID' ? `${PRIVATE}/west-trail-data/${state.slug}`
      : `${PRIVATE}/us-trail-data/${state.slug}`;
  return { code, ...state, input,
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
