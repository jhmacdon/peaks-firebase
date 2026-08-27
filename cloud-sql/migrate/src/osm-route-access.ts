const WALKABLE_HIGHWAYS = new Set([
  "path",
  "footway",
  "steps",
  "pedestrian",
  "track",
  "service",
  "unclassified",
  "residential",
]);

const EXPLICIT_FOOT_HIGHWAYS = new Set(["bridleway", "cycleway"]);
const ALLOWED_FOOT_ACCESS = new Set([
  "yes",
  "designated",
  "permissive",
  "permit",
]);

export function footAccessAllows(tags: Record<string, string>): boolean {
  return ALLOWED_FOOT_ACCESS.has(tags.foot ?? "");
}

export function requiresExplicitFootAccess(
  tags: Record<string, string>
): boolean {
  return EXPLICIT_FOOT_HIGHWAYS.has(tags.highway ?? "");
}

export function isWalkableOsmWay(tags: Record<string, string>): boolean {
  const highway = tags.highway ?? "";
  return WALKABLE_HIGHWAYS.has(highway) ||
    (EXPLICIT_FOOT_HIGHWAYS.has(highway) && footAccessAllows(tags));
}
