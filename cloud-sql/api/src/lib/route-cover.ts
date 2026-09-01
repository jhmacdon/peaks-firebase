/**
 * Keep every API route object on the same flat cover-photo contract.
 *
 * The view returns at most one row per route, so these joins do not change the
 * result cardinality. A route without a fully credited linked destination
 * photo gets null for every projected field.
 */
export function routeCoverSelectSql(coverAlias = "cover"): string {
  return `${coverAlias}.destination_id AS cover_destination_id,
          ${coverAlias}.destination_name AS cover_destination_name,
          ${coverAlias}.image_url AS cover_image,
          ${coverAlias}.attribution AS cover_image_attribution,
          ${coverAlias}.attribution_url AS cover_image_attribution_url,
          ${coverAlias}.focal_x AS cover_image_focal_x,
          ${coverAlias}.focal_y AS cover_image_focal_y`;
}

export function routeCoverJoinSql(
  routeAlias = "r",
  coverAlias = "cover",
  routeIdColumn = "id"
): string {
  return `LEFT JOIN route_cover_photos ${coverAlias} ON ${coverAlias}.route_id = ${routeAlias}.${routeIdColumn}`;
}

/** Cover fields for route objects built inside PostgreSQL JSON aggregates. */
export function routeCoverJsonFieldsSql(coverAlias = "cover"): string {
  return `'cover_destination_id', ${coverAlias}.destination_id,
          'cover_destination_name', ${coverAlias}.destination_name,
          'cover_image', ${coverAlias}.image_url,
          'cover_image_attribution', ${coverAlias}.attribution,
          'cover_image_attribution_url', ${coverAlias}.attribution_url,
          'cover_image_focal_x', ${coverAlias}.focal_x,
          'cover_image_focal_y', ${coverAlias}.focal_y`;
}
