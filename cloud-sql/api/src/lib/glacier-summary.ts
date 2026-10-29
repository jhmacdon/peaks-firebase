/** Compact glacier facts for destination summaries: kind, checked parent,
 * and the place's own outline credit and dates.
 * Search, nearby, viewport and nested destination arrays omit
 * parent facts, so a capable client could not otherwise name a glacier's
 * mountain or tell a snowfield from a glacier without fetching detail.
 *
 * The lookup runs once per response, on its final rows, after every
 * candidate cap and LIMIT. It never joins into search scoring.
 */
export type GlacierSummary = {
  kind: "glacier"|"snowfield"; parent_mountain: { id: string; name: string };
  geometry_credit?: string; geometry_license?: string; outline_observed_at?: string;
  outline_source_url?: string; outline_provenance?: Record<string, unknown> | null;
};
export type GlacierSummaryQuery = (text: string, values: unknown[]) => Promise<any[]|undefined>;

// Geometry, health and provenance payloads hold no destination rows.
const leaves=new Set(["geometry","boundary","massif_boundary","path_preview","health_data","source_contributions",
  "metadata","provenance","amenities","external_ids","external_links","glacier_crossings","glacier_stretches"]);

/** node-postgres returns enum arrays as their text literal, "{summit,glacier}". */
function hasGlacierFeature(features: unknown): boolean {
  if (Array.isArray(features)) return features.includes("glacier");
  return typeof features==="string" && features.replace(/^\{|\}$/g,"").split(",").map(f=>f.replace(/"/g,"")).includes("glacier");
}

function isGlacierRow(value: any): boolean {
  return typeof value?.id==="string" && hasGlacierFeature(value.features)
    && !Object.prototype.hasOwnProperty.call(value,"glacier");
}

/** Ids of summary rows that lack a `glacier` object; detail rows keep theirs. */
export function collectGlacierSummaryIds(value: any, ids=new Set<string>()): Set<string> {
  if (Array.isArray(value)) { for (const v of value) collectGlacierSummaryIds(v,ids); return ids; }
  if (!value || typeof value!=="object" || value instanceof Date) return ids;
  if (isGlacierRow(value)) ids.add(value.id);
  for (const [key,v] of Object.entries(value)) if (!leaves.has(key)) collectGlacierSummaryIds(v,ids);
  return ids;
}

/** Copy-on-write: shared or cached rows stay untouched. */
export function withGlacierSummaries(value: any, summaries: Map<string,GlacierSummary>): any {
  if (Array.isArray(value)) {
    const rows=value.map(v=>withGlacierSummaries(v,summaries));
    return rows.every((v,i)=>v===value[i]) ? value : rows;
  }
  if (!value || typeof value!=="object" || value instanceof Date) return value;
  let result=value;
  for (const [key,v] of Object.entries(value)) {
    if (leaves.has(key)) continue;
    const next=withGlacierSummaries(v,summaries);
    if (next!==v) { if (result===value) result={...value}; result[key]=next; }
  }
  const summary=isGlacierRow(value) ? summaries.get(value.id) : undefined;
  if (summary) { if (result===value) result={...value}; result.glacier=summary; }
  return result;
}

/** One primary-key lookup on facts plus the parent destination. The parent
 * follows the detail rule: Peaks catalog or the caller's own row.
 */
export function buildGlacierSummaryQuery(ids: string[], uid: string) {
  return { text: `SELECT gf.destination_id AS id,
      jsonb_build_object('kind',gf.kind,'parent_mountain',jsonb_build_object('id',pm.id,'name',pm.name),
        'geometry_credit',gf.geometry_credit,'geometry_license',gf.geometry_license,
        'outline_observed_at',to_char(gf.outline_observed_at,'YYYY-MM-DD'),'outline_source_url',gf.outline_source_url,
        'outline_provenance',gf.provenance->'outline') AS glacier
    FROM destination_glacier_facts gf JOIN destinations pm ON pm.id=gf.parent_mountain_id
    WHERE gf.destination_id=ANY($1::text[]) AND (pm.owner='peaks' OR pm.owner=$2)`, values: [ids,uid] };
}

export async function attachGlacierSummaries(body: any, uid: string, query: GlacierSummaryQuery): Promise<any> {
  const ids=collectGlacierSummaryIds(body);
  if (!ids.size) return body;
  const sql=buildGlacierSummaryQuery([...ids].sort(),uid);
  const rows=await query(sql.text,sql.values);
  if (!rows?.length) return body;
  return withGlacierSummaries(body,new Map(rows.map(r=>[r.id,r.glacier])));
}
