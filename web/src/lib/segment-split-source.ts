export interface SplitSourceClient {
  query(sql: string, values: unknown[]): Promise<{ rows: { id: string; requires_source_proof: boolean }[] }>;
}

/** Check every parent before writing any split, retaining its row lock to commit. */
export async function assertSegmentSplitsHaveNoCatalogSource(
  client: SplitSourceClient,
  splits: readonly { originalSegmentId: string }[],
): Promise<void> {
  const ids = [...new Set(splits.map(split => split.originalSegmentId))].sort();
  if (!ids.length) return;
  const result = await client.query(`SELECT s.id,
    (s.provenance IS NOT NULL OR EXISTS (
      SELECT 1 FROM route_segments rs JOIN routes r ON r.id=rs.route_id
      WHERE rs.segment_id=s.id AND r.owner='peaks'
    )) AS requires_source_proof
    FROM segments s WHERE s.id=ANY($1::text[]) ORDER BY s.id FOR UPDATE OF s`, [ids]);
  const found = new Set(result.rows.map(row => row.id));
  const missing = ids.find(id => !found.has(id));
  if (missing) throw new Error(`segment_split_missing:${missing}`);
  const sourced = result.rows.find(row => row.requires_source_proof);
  if (sourced) throw new Error(`catalog_segment_split_requires_source_proof:${sourced.id}: each child needs its own exact contributing sources; catalog splits are not supported`);
}
