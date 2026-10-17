import type { PoolClient } from "pg";
import { performance } from "node:perf_hooks";
import {
  buildRouteCandidateSql, buildRouteCoverageSql, buildRouteContainmentSql,
  buildSessionSegmentCoverageSelectSql,
} from "./processing";
import { dropContainedRouteMatches, selectRouteMatches, type RouteCoverageRow } from "./route-coverage";

type Reporter = (event: Record<string, unknown>) => void;

/** Every session gets a fresh read-only transaction, including after a timeout.
 * The real read-only builders exercise the matching work without its writers.
 */
export async function perfCheckMatching(
  client: Pick<PoolClient, "query">,
  sessionIds: string[],
  report: Reporter = (event) => console.log(JSON.stringify(event))
): Promise<number> {
  let failed = 0;
  for (const sessionId of sessionIds) {
    await client.query("BEGIN READ ONLY");
    try {
      await client.query("SET LOCAL statement_timeout = '30s'");
      const timed = async (name: string, query: { text: string; values: unknown[] }) => {
        const start = performance.now();
        try {
          const result = await client.query(query.text, query.values);
          report({ session_id: sessionId, step: name, ms: Math.round((performance.now() - start) * 10) / 10, rows: result.rows.length });
          return result;
        } catch (error) {
          report({ session_id: sessionId, step: name, ms: Math.round((performance.now() - start) * 10) / 10,
            error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      };
      const candidates = await timed("candidates", buildRouteCandidateSql(sessionId));
      const routeIds = candidates.rows.map((row: { id: string }) => row.id);
      const measured = await timed("coverage", buildRouteCoverageSql(sessionId, routeIds));
      let matches = selectRouteMatches(measured.rows as RouteCoverageRow[]);
      if (matches.length > 1) {
        const contained = await timed("containment", buildRouteContainmentSql(matches));
        matches = dropContainedRouteMatches(matches, contained.rows.map((row: { route_id: string }) => row.route_id));
      } else report({ session_id: sessionId, step: "containment", ms: 0, skipped: true });
      report({ session_id: sessionId, primary: matches.find((match) => match.is_primary)?.route_id ?? null,
        routes: matches.map(({ route_id, coverage, covered_m, is_primary }) => ({ route_id, coverage, covered_m, is_primary })) });
      const segmentSelect = buildSessionSegmentCoverageSelectSql(sessionId, routeIds);
      report({ session_id: sessionId, step: "segment_select_sql", sql: segmentSelect.text, values: segmentSelect.values });
      await timed("segments_select", segmentSelect);
    } catch (error) {
      failed++;
      report({ session_id: sessionId, error: error instanceof Error ? error.message : String(error) });
    } finally {
      await client.query("ROLLBACK");
    }
  }
  return failed;
}
