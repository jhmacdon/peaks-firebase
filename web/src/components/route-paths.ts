function encoded(id: string): string {
  return encodeURIComponent(id);
}

/** A Peaks catalog guide, not a user's saved route. */
export function catalogRoutePath(routeId: string): string {
  return `/routes/${encoded(routeId)}`;
}

/** The anonymous URL for a saved route its owner made public. */
export function publicSavedRoutePath(routeId: string): string {
  return `/route/${encoded(routeId)}`;
}

/** The signed-in editor URL for a user's saved route. */
export function myRoutePath(routeId?: string): string {
  return routeId ? `/my-routes/${encoded(routeId)}` : "/my-routes";
}
