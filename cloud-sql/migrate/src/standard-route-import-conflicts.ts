import type { PoolClient } from "pg";

export type DestinationRouteSummary = {
  id: string;
  name: string;
  status: string;
};

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
};
