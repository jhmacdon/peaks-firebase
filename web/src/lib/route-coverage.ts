// What a session_routes row means, for the web app's queries.
//
// A sync module, not a server action: "use server" files may export only async
// functions, so shared SQL fragments live here alongside search-sql.ts.
//
// This is a deliberate copy of the same two definitions in
// cloud-sql/api/src/route-coverage.ts — the two packages share no code — and
// scripts/check-cross-refs.sh fails the build if the bodies ever differ.

export const ROUTE_DONE_COVERAGE = 0.7;
export function routeDoneCoverageSql(alias: string): string {
  return `(${alias}.coverage IS NULL OR ${alias}.coverage >= ${ROUTE_DONE_COVERAGE})`;
}
