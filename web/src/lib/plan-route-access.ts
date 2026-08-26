export interface SqlQuery {
  text: string;
  values: unknown[];
}

/** Validate and deduplicate route ids while preserving their saved order. */
export function normalizePlanRouteIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Invalid routes");
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > 1_500) {
      throw new Error("Invalid routes");
    }
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

export function buildPlanRouteAccessQuery(
  userId: string,
  routeIds: string[]
): SqlQuery {
  return {
    text: `SELECT r.id
      FROM routes r
      WHERE r.id = ANY($1::text[])
        AND (r.owner = 'peaks' OR r.owner = $2)
      FOR SHARE`,
    values: [routeIds, userId],
  };
}

/** Missing and foreign-owned ids use the same error to avoid enumeration. */
export function assertAllPlanRoutesAccessible(
  routeIds: string[],
  rows: Array<{ id: unknown }>
): void {
  const accessible = new Set(rows.map((row) => String(row.id)));
  if (accessible.size !== routeIds.length
      || routeIds.some((id) => !accessible.has(id))) {
    throw new Error("One or more routes are unavailable");
  }
}
