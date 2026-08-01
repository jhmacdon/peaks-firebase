export type DestinationRouteSummary = {
  id: string;
  name: string;
  status: string;
};

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
