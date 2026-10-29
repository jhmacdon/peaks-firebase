import { buildRouteAccessSql } from "./route-access";
import { routeCoverJoinSql, routeCoverSelectSql } from "./route-cover";
import { isoUtcSql } from "./glacier-crossings";

/** Facts contain no geometry. Dates, SI units, source scope and nulls travel
 * with every value; a combined history must never become an individual one.
 * Credits, source links and mountain totals all come from the facts row.
 * The baseline change, history note and surface change are served flat from
 * the builder's provenance keys; a row without them reads null.
 */
export function glacierFactsSql(): string {
  return `(to_jsonb(gf)-'destination_id'-'parent_mountain_id'-'updated_at'-'outline') || jsonb_build_object(
    'parent_mountain',jsonb_build_object('id',pm.id,'name',pm.name),
    'mountain_context',gf.provenance->'mountain_context',
    'change_baseline_year',gf.provenance->'area_change'->'baseline_year',
    'percent_change_since_baseline',gf.provenance->'area_change'->'percent',
    'area_history_note',gf.provenance->'area_history_note'->'text',
    'area_history_note_citation',gf.provenance->'area_history_note'->'citation',
    'surface_change',gf.provenance->'surface_change',
    'description',CASE WHEN NULLIF(btrim(d.description_source_name),'') IS NOT NULL AND NULLIF(btrim(d.description_source_url),'') IS NOT NULL
      AND NULLIF(btrim(d.description_source_license),'') IS NOT NULL THEN d.description END,
    'description_credit',d.description_source_name,'description_source_url',d.description_source_url)`;
}
export function buildGlacierFactsQuery(id: string, uid: string) {
  return { text: `SELECT ${glacierFactsSql()} AS glacier,ST_AsGeoJSON(gf.outline,9)::json AS boundary
    FROM destination_glacier_facts gf
    JOIN destinations d ON d.id=gf.destination_id JOIN destinations pm ON pm.id=gf.parent_mountain_id
    WHERE gf.destination_id=$1 AND 'glacier'=ANY(d.features::text[])
      AND (d.owner='peaks' OR d.owner=$2) AND (pm.owner='peaks' OR pm.owner=$2)`, values:[id,uid] };
}

/** Mirrors area detail: personal totals, a bounded session page and a bounded
 * active-route list. Neither CTE nor route/session JSON copies exact tracks.
 */
export function buildGlacierDetailQuery(id: string, uid: string, limit=25, offset=0) {
  return { text:`WITH glacier_sessions AS MATERIALIZED (
    SELECT s.id,s.user_id,s.name,s.start_time,s.end_time,s.distance,s.gain,s.total_time,s.activity_type,
      s.highest_point,s.ascent_time,s.descent_time,s.still_time,s.pace,s.source,s.external_id,
      s.processing_state,s.processing_error,s.processed_at,s.group_id,s.ended,s.is_public,
      s.updated_at,s.server_updated_at,s.path_preview
    FROM tracking_sessions s WHERE s.user_id=$2 AND $2<>'' AND s.glacier_match_input_hash IS NOT NULL
      AND EXISTS(SELECT 1 FROM session_glacier_crossings c WHERE c.session_id=s.id AND c.destination_id=$1
        AND NOT EXISTS(SELECT 1 FROM session_destination_rejections v WHERE v.session_id=c.session_id AND v.destination_id=c.destination_id))
  ), glacier_routes AS MATERIALIZED (
    SELECT r.id,r.name,r.owner,r.polyline6,r.distance,r.gain,r.gain_loss,r.elevation_string,r.external_links,r.provenance,r.completion,
      r.shape,r.kind,r.slug,r.difficulty,r.terrain_category,r.est_moving_seconds,r.popularity
    FROM routes r WHERE r.status='active' AND r.glacier_match_input_hash IS NOT NULL
      AND ${buildRouteAccessSql("r","$2")}
      AND EXISTS(SELECT 1 FROM route_glacier_crossings c WHERE c.route_id=r.id AND c.destination_id=$1)
  )
  SELECT d.id,d.name,d.type,d.features,d.activities,d.owner,d.country_code,d.state_code,
    gf.kind,ST_Y(d.location::geometry) AS lat,ST_X(d.location::geometry) AS lng,
    d.bbox_min_lat,d.bbox_max_lat,d.bbox_min_lng,d.bbox_max_lng,
    ST_AsGeoJSON(gf.outline,9)::json AS boundary,
    d.description,d.description_source_name,d.description_source_url,d.description_source_license,
    gf.geometry_credit,to_char(gf.outline_observed_at,'YYYY-MM-DD') AS outline_observed_at,${glacierFactsSql()} AS glacier,
    json_build_object('id',pm.id,'name',pm.name) AS parent_mountain,
    0::int AS destination_count,'[]'::json AS destinations,
    (SELECT count(*)::int FROM glacier_routes) AS route_count,
    (SELECT count(*)::int FROM glacier_sessions) AS session_count,
    (SELECT max(start_time) FROM glacier_sessions) AS latest_session_at,
    COALESCE((SELECT sum(distance) FROM glacier_sessions),0)::float8 AS session_distance,
    COALESCE((SELECT sum(gain) FROM glacier_sessions),0)::float8 AS session_gain,
    COALESCE((SELECT sum(total_time) FROM glacier_sessions),0)::float8 AS session_time,
    ((SELECT count(*) FROM glacier_sessions)>$3::int+$4::int) AS sessions_has_more,($3::int+$4::int)::int AS sessions_next_offset,
    COALESCE((SELECT json_agg(item ORDER BY item.start_time DESC,item.id) FROM (
      SELECT s.id,s.user_id,s.name,s.start_time,s.end_time,s.distance,s.gain,s.total_time,s.activity_type,
        s.highest_point AS high_point,s.ascent_time,s.descent_time,s.still_time,s.pace,s.source,s.external_id,
        s.processing_state,s.processing_error,s.processed_at,s.group_id,
        s.ended,s.is_public,s.updated_at,s.server_updated_at,
        ST_AsGeoJSON(s.path_preview,6)::json AS path_preview,
        COALESCE((SELECT json_agg(json_build_object('id',place.id,'name',place.name,'elevation',place.elevation,
          'features',place.features,'lat',ST_Y(place.location::geometry),'lng',ST_X(place.location::geometry)) ORDER BY place.name,place.id)
          FROM session_destinations sd JOIN destinations place ON place.id=sd.destination_id
          WHERE sd.session_id=s.id AND sd.relation='reached'),'[]'::json) AS destinations_reached,
        (SELECT json_agg(json_build_object('pass_index',c.pass_index,'entered_at',${isoUtcSql("c.entered_at")},'exited_at',${isoUtcSql("c.exited_at")},
          'entered_distance_m',c.entered_distance_m,'exited_distance_m',c.exited_distance_m,
          'min_elevation_m',c.min_elevation_m,'max_elevation_m',c.max_elevation_m) ORDER BY c.entered_distance_m,c.pass_index)
          FROM session_glacier_crossings c WHERE c.session_id=s.id AND c.destination_id=$1) AS glacier_crossings
      FROM glacier_sessions s ORDER BY s.start_time DESC,s.id LIMIT $3 OFFSET $4
    ) item),'[]'::json) AS sessions,
    COALESCE((SELECT json_agg(item ORDER BY item.popularity DESC,item.name,item.id) FROM (
      SELECT r.*,${routeCoverSelectSql()}
      FROM glacier_routes r ${routeCoverJoinSql("r","cover","id",!uid)}
      ORDER BY r.popularity DESC,r.name,r.id LIMIT 15
    ) item),'[]'::json) AS routes
  FROM destination_glacier_facts gf JOIN destinations d ON d.id=gf.destination_id
  JOIN destinations pm ON pm.id=gf.parent_mountain_id
  WHERE d.id=$1 AND 'glacier'=ANY(d.features::text[]) AND (d.owner='peaks' OR d.owner=$2)
    AND (pm.owner='peaks' OR pm.owner=$2)`,values:[id,uid,limit,offset] };
}
export function mapGlacierDetailRow(row: any): any {
  for (const key of ["session_count","route_count","sessions_next_offset","session_distance","session_gain","session_time"])
    row[key]=Number(row[key] ?? 0);
  row.sessions=Array.isArray(row.sessions)?row.sessions:[];
  row.routes=Array.isArray(row.routes)?row.routes:[];
  row.sessions_has_more=row.sessions_has_more===true;
  if (!row.description_source_name?.trim() || !row.description_source_url?.trim() || !row.description_source_license?.trim()) {
    row.description=null;
    if (row.glacier) row.glacier.description=null;
  }
  return row;
}
