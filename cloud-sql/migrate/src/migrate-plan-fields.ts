export function firestorePlanDestinationIds(data: Record<string, any>): string[] {
  const value = data.goals ?? data.destinations;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

export function firestorePlanDate(data: Record<string, any>): unknown {
  return data.plannedDate ?? data.date;
}

/** Missing or malformed visibility stays private during every repair run. */
export function firestorePlanIsPublic(data: Record<string, any>): boolean {
  return data.isPublic === true || data.is_public === true;
}

/**
 * Some early plan documents saved a generated route segment id even though
 * Firestore only retained the parent route document. Prefer an exact route,
 * then recover those stale references through the parent route.
 */
export function resolveMigratedPlanRouteId(
  routeId: string,
  availableRouteIds: ReadonlySet<string>
): string | null {
  if (availableRouteIds.has(routeId)) return routeId;
  const parentId = routeId.replace(/_segment\d+$/, "");
  return parentId !== routeId && availableRouteIds.has(parentId) ? parentId : null;
}
