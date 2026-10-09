// Keep these at least as large as current iOS requests. The viewfinder asks
// for 2,000 peaks within 260 km; map pages use 200 and flyovers use 180.
export const CATALOG_LIMITS = {
  viewport: 200,
  nearbyDestinations: 2_000,
  nearbyDestinationRadius: 260_000,
  nearbyRoutes: 20,
  nearbyRouteRadius: 5_000,
  features: 180,
  popularLists: 10,
  signedOutIds: 2_000,
} as const;

function clampPositive(value: number, fallback: number, max: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback;
}

export function clampCatalogLimit(value: unknown, fallback: number, max: number): number {
  return clampPositive(typeof value === "string" ? Number.parseInt(value, 10) : NaN, fallback, max);
}

export function clampCatalogRadius(value: unknown, fallback: number, max: number): number {
  return clampPositive(typeof value === "string" ? Number.parseFloat(value) : NaN, fallback, max);
}
