import type { PoolClient } from "pg";

export type DestinationRouteSummary = {
  id: string;
  name: string;
  status: string;
};

function normalizeRouteName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\bmt\b/gu, "mount")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coreDestinationName(value: string): string {
  return normalizeRouteName(value)
    .replace(/\b(?:mount|mountain|peak)\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function usesUnspacedScript(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u.test(
    value
  );
}

function containsDestinationName(
  routeName: string,
  destinationName: string
): boolean {
  if (!destinationName) return false;
  if (usesUnspacedScript(destinationName)) {
    return routeName.includes(destinationName);
  }
  return ` ${routeName} `.includes(` ${destinationName} `);
}

export function routeNameReferencesDestination(
  routeName: string,
  destinationNames: Iterable<string>
): boolean {
  const normalizedRoute = normalizeRouteName(routeName);
  if (!normalizedRoute) return false;

  return Array.from(destinationNames).some((destinationName) => {
    const normalizedDestination = normalizeRouteName(destinationName);
    const destinationCore = coreDestinationName(destinationName);
    if (
      !normalizedDestination ||
      Array.from(destinationCore).length < 2
    ) return false;
    return (
      containsDestinationName(normalizedRoute, normalizedDestination) ||
      containsDestinationName(normalizedRoute, destinationCore)
    );
  });
}

const LOCK_LIVE_DESTINATION_ROUTES_SQL = `
  SELECT r.id, r.name, r.status
  FROM route_destinations rd
  JOIN routes r ON r.id = rd.route_id
  WHERE rd.destination_id = $1
    AND r.owner = 'peaks'
    AND r.status IN ('active', 'pending')
  FOR UPDATE OF r
`;

/**
 * A destination can have several valid routes, such as a hiking trail and a
 * mountaineering route. Import blocks only another live route with the same
 * name. Explicit replacement ids are ignored because their lifecycle is
 * checked separately.
 */
export function findConflictingLiveRoute(
  routes: DestinationRouteSummary[],
  candidateName: string,
  ignoredRouteIds: Iterable<string>
): DestinationRouteSummary | null {
  const ignored = new Set(ignoredRouteIds);
  const normalizedCandidateName = candidateName.toLowerCase();

  return (
    routes.find(
      (route) =>
        !ignored.has(route.id) &&
        (route.status === "active" || route.status === "pending") &&
        route.name.toLowerCase() === normalizedCandidateName
    ) ?? null
  );
}

export async function lockAndFindConflictingLiveRoute(
  client: PoolClient,
  destinationId: string,
  candidateName: string,
  ignoredRouteIds: Iterable<string>
): Promise<DestinationRouteSummary | null> {
  const routes = await client.query<DestinationRouteSummary>(
    LOCK_LIVE_DESTINATION_ROUTES_SQL,
    [destinationId]
  );
  return findConflictingLiveRoute(
    routes.rows,
    candidateName,
    ignoredRouteIds
  );
}

export default {
  findConflictingLiveRoute,
  lockAndFindConflictingLiveRoute,
  routeNameReferencesDestination,
};
