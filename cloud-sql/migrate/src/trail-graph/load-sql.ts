import type { Statement } from './load-catalog';

export const DEFER_REMATCH_SQL = "SET LOCAL peaks.defer_rematch = 'on'";
export function transactionStart(): Statement[] {
  return [{ kind: 'begin', sql: 'BEGIN', values: [] }, { kind: 'defer_rematch', sql: DEFER_REMATCH_SQL, values: [] }];
}
export interface SegmentLink { id: string; ordinal: number; direction: 'forward' | 'reverse' }
export function segmentLinks(routeId: string, refs: { id: string; direction: 'forward' | 'reverse' }[]): Statement {
  return { kind: 'route_segment_insert', sql: `INSERT INTO route_segments(route_id,segment_id,ordinal,direction)
    SELECT $1,link.id,link.ordinal,link.direction FROM jsonb_to_recordset($2::jsonb) AS link(id text,ordinal integer,direction text)
    ORDER BY link.ordinal ON CONFLICT DO NOTHING`, values: [routeId, JSON.stringify(refs.map((ref, ordinal) => ({ ...ref, ordinal })))] };
}
export function destinationLinks(routeId: string, ids: string[]): Statement {
  return { kind: 'route_destination_insert', sql: `INSERT INTO route_destinations(route_id,destination_id,ordinal)
    SELECT $1,link.id,link.ordinal FROM jsonb_to_recordset($2::jsonb) AS link(id text,ordinal integer)
    ORDER BY link.ordinal ON CONFLICT DO NOTHING`, values: [routeId, JSON.stringify(ids.map((id, ordinal) => ({ id, ordinal })))] };
}
export function plannedSegmentLinks(statements: Statement[]): SegmentLink[] {
  const statement = statements.find(s => s.kind === 'route_segment_insert');
  return statement ? JSON.parse(statement.values[1] as string) : [];
}
