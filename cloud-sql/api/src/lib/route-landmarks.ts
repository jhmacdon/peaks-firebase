import { glacierCrossingsSql, glacierMatchStatusSql } from "./glacier-crossings";
import { buildRouteAccessSql } from "./route-access";
import { pathPlacesCtes } from "./path-places";

export const ROUTE_PLACE_PAGE_SIZE = 100;
export const ROUTE_PLACE_SEGMENTS = 2048;
const INDEXED = "('triple-crown-pct','triple-crown-at','triple-crown-cdt')";
export interface RoutePlaceCursor { vertex: number; along: number; row: number; version?: string }

export function decodeRoutePlaceCursor(raw: unknown): RoutePlaceCursor {
  if (raw === undefined) return {vertex:1,along:0,row:0};
  if (typeof raw !== "string" || raw.length>1024) throw new Error("Invalid place cursor");
  try {
    const c=JSON.parse(Buffer.from(raw,"base64url").toString("utf8"));
    if (!Number.isSafeInteger(c.vertex) || c.vertex<1 || c.vertex>100000000
      || !Number.isFinite(c.along) || c.along<0 || c.along>100000000
      || !Number.isSafeInteger(c.row) || c.row<0 || c.row>1000000
      || typeof c.version!=="string") throw new Error();
    return c;
  } catch { throw new Error("Invalid place cursor"); }
}

/** Page through original vertices, with a second cursor for dense result sets.
 * Long indexed trails never read their full path. No route-length exclusion.
 */
export function buildRouteLandmarksQuery(id: string,uid: string,cursor=decodeRoutePlaceCursor(undefined), glaciers=false) {
  return {
    text:`WITH source AS MATERIALIZED (
      SELECT r.id,r.path,r.owner,r.owner AS user_id,r.updated_at::text AS version,
        ${glaciers ? "r.glacier_match_input_hash," : ""}
        CASE WHEN r.id IN ${INDEXED} THEN
          (SELECT idx+1 FROM triple_crown_route_points WHERE route_id=r.id ORDER BY idx DESC LIMIT 1)
        ELSE ST_NPoints(r.path::geometry) END AS total_vertices
      FROM routes r WHERE r.id=$1 AND r.status='active' AND r.path IS NOT NULL
        AND ${buildRouteAccessSql("r","$2")}
    ), track_vertices AS MATERIALIZED (
      SELECT 1 AS line,tcp.idx+1 AS vertex,tcp.pt AS geom,tcp.along_m AS absolute_m
      FROM source s JOIN triple_crown_route_points tcp ON tcp.route_id=s.id
      WHERE s.id IN ${INDEXED} AND tcp.idx BETWEEN $3-1 AND $3-1+${ROUTE_PLACE_SEGMENTS}
      UNION ALL
      SELECT 1 AS line,(dp).path[1] AS vertex,ST_Force2D((dp).geom) AS geom,NULL::float8 AS absolute_m
      FROM source s CROSS JOIN LATERAL ST_DumpPoints(
        CASE WHEN s.id NOT IN ${INDEXED} THEN s.path::geometry END) dp
      WHERE (dp).path[1] BETWEEN $3 AND $3+${ROUTE_PLACE_SEGMENTS}
    ), ${pathPlacesCtes({nearby:true,baseMeters:"$4",linked:"EXISTS(SELECT 1 FROM route_destinations rd WHERE rd.route_id=$1 AND rd.destination_id=d.id)"})},
    page AS (
      SELECT id,name,elevation,features,lat,lng,route_offset_m,distance_along_m,is_linked
      FROM unique_places ORDER BY distance_along_m,id LIMIT ${ROUTE_PLACE_PAGE_SIZE+1} OFFSET $5
    )
    SELECT s.version,s.total_vertices,
      ${glaciers ? `${glacierCrossingsSql("route","s")} AS glacier_crossings,
        ${glacierMatchStatusSql("s")} AS glacier_crossings_status,` : ""}
      (SELECT max(vertex) FROM track_vertices) AS last_vertex,
      COALESCE((SELECT max(along_m+length_m) FROM edges),$4) AS end_m,
      COALESCE((SELECT json_agg(page ORDER BY distance_along_m,id) FROM page),'[]'::json) AS items
    FROM source s`,
    values:[id,uid,cursor.vertex,cursor.along,cursor.row],
  };
}

export function routePlacePage(row: any,cursor: RoutePlaceCursor) {
  if (cursor.version && cursor.version!==row.version) throw new Error("Route changed; reload its places");
  if (!Number.isFinite(row.total_vertices) || row.total_vertices<2
    || !Number.isFinite(row.last_vertex) || row.last_vertex<=cursor.vertex)
    throw new Error("Route place geometry is incomplete");
  const all=Array.isArray(row.items)?row.items:[];
  const items=all.slice(0,ROUTE_PLACE_PAGE_SIZE);
  let next: RoutePlaceCursor|null=null;
  if (all.length>ROUTE_PLACE_PAGE_SIZE) next={...cursor,row:cursor.row+ROUTE_PLACE_PAGE_SIZE,version:row.version};
  else if (row.last_vertex<row.total_vertices) next={vertex:row.last_vertex,along:row.end_m,row:0,version:row.version};
  return {...(Object.prototype.hasOwnProperty.call(row,"glacier_crossings")
    ? {glacier_crossings:row.glacier_crossings,glacier_crossings_status:row.glacier_crossings_status}:{}),items,nextCursor:next?Buffer.from(JSON.stringify(next)).toString("base64url"):null,
    distanceThroughMeters:row.end_m};
}
