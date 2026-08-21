/**
 * SQL for catalog-wide destination queries that rank by raw `elevation`.
 *
 * These live in one sync module (not inline in the "use server" action file)
 * so tests can pin their shape — the same builder-test pattern as
 * `cloud-sql/api/src/comparisons.ts`. See `search-sql.test.ts`.
 *
 * Why these queries need care: `elevation` is only trustworthy on
 * `summit`-featured destinations. Checked live against prod 2026-08-20:
 * non-summit rows can carry elevations that belong to a different,
 * much higher destination (Washington's "Junction Lake" holds a value from
 * an out-of-state namesake; six states surfaced a lake or viewpoint above
 * their real high point). An unscoped `ORDER BY elevation DESC` over the
 * catalog therefore ranks data-entry errors first.
 */

/** Top-up for getPopularDestinations when too little of the catalog has
 * recorded sessions: photographed destinations, most impressive first.
 * $1 = limit, $2 = ids already in the result. */
export function popularHeroFallbackSql(): string {
  return `SELECT id, name, elevation, prominence, type,
            activities, features,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM destinations
     WHERE hero_image IS NOT NULL
       AND 'summit' = ANY(features)
       AND NOT (id = ANY($2::text[]))
     ORDER BY elevation DESC NULLS LAST, name ASC NULLS LAST
     LIMIT $1`;
}

/** The same top-up scoped by getFilteredPopularDestinations' extra
 * conditions. `whereExtra` is the pre-rendered `AND ...` clause from
 * filteredPopularConditions; `excludeIdx`/`remainingIdx` are 1-based
 * parameter positions for the already-included ids and the row budget. */
export function filteredPopularHeroFallbackSql(
  whereExtra: string,
  excludeIdx: number,
  remainingIdx: number
): string {
  return `SELECT d.id, d.name, d.elevation, d.prominence, d.type,
            d.activities, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng
     FROM destinations d
     WHERE d.hero_image IS NOT NULL
       AND 'summit' = ANY(d.features)
       AND NOT (d.id = ANY($${excludeIdx}::text[]))
       ${whereExtra}
     ORDER BY d.elevation DESC NULLS LAST, d.name ASC NULLS LAST
     LIMIT $${remainingIdx}`;
}

/** /peaks/[state]'s "highest peak" fact (Task 18). $1 = state code. */
export function stateHighestSummitSql(): string {
  return `SELECT id, name, elevation
       FROM destinations
       WHERE state_code = $1 AND country_code = 'US' AND 'summit' = ANY(features)
       ORDER BY elevation DESC NULLS LAST
       LIMIT 1`;
}

/** getUnclimbedDestinations' no-location branch: the most impressive
 * destinations the user hasn't reached. $1 = user id, $2 = limit. */
export function unclimbedHighestSql(): string {
  return `SELECT d.id, d.name, d.elevation, d.prominence, d.type,
              d.activities, d.features,
              ST_Y(d.location::geometry) AS lat,
              ST_X(d.location::geometry) AS lng
       FROM destinations d
       WHERE d.id NOT IN (
         SELECT sd.destination_id FROM session_destinations sd
         JOIN tracking_sessions ts ON ts.id = sd.session_id
         WHERE ts.user_id = $1 AND sd.relation = 'reached'
       )
         AND 'summit' = ANY(d.features)
       ORDER BY d.elevation DESC NULLS LAST
       LIMIT $2`;
}
