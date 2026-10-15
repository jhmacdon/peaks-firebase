/**
 * Keep every API route object on the same flat cover-photo contract.
 *
 * route_cover_photos prefers the route's own credited cover (routes.cover_*),
 * then the best fully credited linked destination photo
 * (migrations/20261015_route_covers.sql). `cover_image_origin` says which:
 * "route" or "destination". For a route's own cover, cover_destination_id and
 * cover_destination_name still name a place (the objective, else the
 * top-ranked linked place): shipped iOS builds drop a cover without one.
 *
 * The view returns at most one row per route, so these joins do not change the
 * result cardinality. A route with no fully credited cover gets null for every
 * projected field.
 */
export function routeCoverSelectSql(coverAlias = "cover"): string {
  return `${coverAlias}.destination_id AS cover_destination_id,
          ${coverAlias}.destination_name AS cover_destination_name,
          ${coverAlias}.image_url AS cover_image,
          ${coverAlias}.attribution AS cover_image_attribution,
          ${coverAlias}.attribution_url AS cover_image_attribution_url,
          ${coverAlias}.focal_x AS cover_image_focal_x,
          ${coverAlias}.focal_y AS cover_image_focal_y,
          ${routeCoverOriginSql(coverAlias)} AS cover_image_origin`;
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
          'cover_image_focal_y', ${coverAlias}.focal_y,
          'cover_image_origin', ${routeCoverOriginSql(coverAlias)}`;
}

/**
 * `origin` read through the row's JSON so the query still runs on a database
 * where 20261015_route_covers.sql is not applied yet (it yields null there).
 * Without this, deploying the API first would fail every route endpoint, the
 * same way the 09-01 to 09-04 migration drift did.
 */
export function routeCoverOriginSql(coverAlias = "cover"): string {
  return `(to_jsonb(${coverAlias}) ->> 'origin')`;
}
