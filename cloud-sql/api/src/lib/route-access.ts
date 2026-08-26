/**
 * SQL predicate for user-owned route geometry. The caller supplies the route
 * alias and an existing UID placeholder (for example `r`, `$2`).
 */
export function buildRouteAccessSql(
  routeAlias: string,
  uidParameter: string
): string {
  return `(
    ${routeAlias}.owner = 'peaks'
    OR ${routeAlias}.owner = ${uidParameter}
    OR EXISTS (
      SELECT 1
      FROM plan_routes access_pr
      JOIN plans access_p ON access_p.id = access_pr.plan_id
      WHERE access_pr.route_id = ${routeAlias}.id
        AND (
          ${routeAlias}.owner = 'peaks'
          OR ${routeAlias}.owner = access_p.user_id
        )
        AND (
          access_p.user_id = ${uidParameter}
          OR EXISTS (
            SELECT 1 FROM plan_party access_pp
            WHERE access_pp.plan_id = access_p.id
              AND access_pp.user_id = ${uidParameter}
          )
        )
    )
  )`;
}
