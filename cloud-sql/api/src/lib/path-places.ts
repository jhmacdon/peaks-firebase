/** Shared placement for route context and planned visits. Original track
 * segments and indexed boundary parts keep lake matching bounded and exact.
 */
export function pathPlacesCtes(options: { nearby: boolean; linked: string; baseMeters?: string }): string {
  const pointRadius = options.nearby
    ? "CASE WHEN d.features && ARRAY['campsite','hut']::destination_feature[] THEN 300 ELSE destination_match_radius(d.features) END"
    : "destination_match_radius(d.features)";
  const boundaryRadius = options.nearby
    ? "CASE WHEN d.features && ARRAY['campsite','hut']::destination_feature[] THEN 300 ELSE destination_boundary_match_radius(d.features) END"
    : "destination_boundary_match_radius(d.features)";
  const owner = options.nearby ? "d.owner='peaks'" : "(d.owner='peaks' OR d.owner=(SELECT user_id FROM source))";
  return `edge_lengths AS MATERIALIZED (
    SELECT line,vertex,geom AS a,lead(geom) OVER (PARTITION BY line ORDER BY vertex) AS b,absolute_m
    FROM track_vertices
  ), measured_edges AS MATERIALIZED (
    SELECT *,ST_Distance(a::geography,b::geography) AS length_m FROM edge_lengths WHERE b IS NOT NULL
  ), edges AS MATERIALIZED (
    SELECT line,vertex,(vertex-1)/31 AS chunk,
      ST_MakeLine(a,b) AS geom,ST_MakeLine(a,b)::geography AS edge,length_m,
      COALESCE(absolute_m,${options.baseMeters ?? "0"}+COALESCE(
        sum(length_m) OVER (ORDER BY line,vertex ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)) AS along_m
    FROM measured_edges
  ), track AS MATERIALIZED (
    SELECT line,(vertex-1)/31 AS chunk,
      ST_MakeLine(array_agg(a ORDER BY vertex) || (array_agg(b ORDER BY vertex DESC))[1])::geography AS piece
    FROM measured_edges GROUP BY line,(vertex-1)/31
    ${options.nearby ? "LIMIT 68" : ""}
  ), place_hits AS MATERIALIZED (
    SELECT d.id,track.line,track.chunk,d.location AS place,${pointRadius} AS radius
    FROM track JOIN destinations d ON ST_DWithin(d.location,track.piece,${options.nearby ? 300 : 200})
    WHERE d.boundary IS NULL AND ${owner}
      AND ST_DWithin(d.location,track.piece,${pointRadius})
      ${options.nearby ? `AND NULLIF(btrim(d.name),'') IS NOT NULL AND (NOT d.features && ARRAY['summit','volcano']::destination_feature[] OR (${options.linked}))` : ""}
    UNION ALL
    SELECT d.id,track.line,track.chunk,bp.boundary_part AS place,${boundaryRadius} AS radius
    FROM track JOIN destination_boundary_parts bp
      ON ST_DWithin(bp.boundary_part,track.piece,${options.nearby ? 300 : 50})
    JOIN LATERAL (SELECT id,name,features,owner,boundary,location FROM destinations
      WHERE id=bp.destination_id OFFSET 0) d ON true
    WHERE d.boundary IS NOT NULL AND ${owner}
      AND ST_DWithin(bp.boundary_part,track.piece,${boundaryRadius})
      ${options.nearby ? `AND NULLIF(btrim(d.name),'') IS NOT NULL AND (NOT d.features && ARRAY['summit','volcano']::destination_feature[] OR (${options.linked}))` : ""}
  ), edge_hits AS MATERIALIZED (
    SELECT DISTINCT ON (h.id,e.line,e.vertex) h.id,e.line,e.vertex,e.along_m,
      ST_Distance(h.place,e.edge) AS offset_m,
      e.along_m+e.length_m*ST_LineLocatePoint(e.geom,
        ST_ClosestPoint(e.geom,ST_Force2D(h.place::geometry))) AS position_m
    FROM place_hits h JOIN edges e ON e.line=h.line AND e.chunk=h.chunk
    WHERE ST_DWithin(h.place,e.edge,h.radius)
    ORDER BY h.id,e.line,e.vertex,offset_m,position_m
  ), encounters AS (
    SELECT *,CASE WHEN lag(vertex) OVER w=vertex-1 THEN 0 ELSE 1 END AS new_visit
    FROM edge_hits WINDOW w AS (PARTITION BY id,line ORDER BY vertex)
  ), visits AS (
    SELECT *,sum(new_visit) OVER (PARTITION BY id ORDER BY line,vertex) AS visit FROM encounters
  ), first_visits AS (
    SELECT *,min(offset_m) OVER (PARTITION BY id) AS closest_m FROM visits WHERE visit=1
  ), positions AS MATERIALIZED (
    SELECT id,min(closest_m) AS route_offset_m,
      min(position_m) FILTER(WHERE offset_m<=closest_m+30) AS distance_along_m
    FROM first_visits GROUP BY id
  ), placed AS MATERIALIZED (
    SELECT d.id,d.name,d.elevation,d.features,d.location,
      ST_Y(d.location::geometry) AS lat,ST_X(d.location::geometry) AS lng,p.route_offset_m,
      CASE WHEN 'trailhead'=ANY(d.features) AND ST_DWithin(d.location,
        (SELECT geom::geography FROM track_vertices ORDER BY line,vertex LIMIT 1),100)
        THEN ${options.baseMeters ?? "0"} ELSE p.distance_along_m END AS distance_along_m,
      (${options.linked}) AS is_linked,
      CASE WHEN d.features && ARRAY['campsite','hut']::destination_feature[] THEN 'camp'
        ELSE array_to_string(d.features,',') END AS family,
      CASE WHEN 'campsite'=ANY(d.features) THEN 0 WHEN 'hut'=ANY(d.features) THEN 1 ELSE 2 END AS feature_rank
    FROM positions p JOIN destinations d ON d.id=p.id
  ), unique_places AS MATERIALIZED (
    SELECT p.* FROM placed p WHERE NOT EXISTS (
      SELECT 1 FROM placed other WHERE NULLIF(btrim(p.name),'') IS NOT NULL
        AND lower(btrim(other.name))=lower(btrim(p.name)) AND other.family=p.family
        AND ST_DWithin(other.location,p.location,50)
        AND (NOT other.is_linked,other.feature_rank,other.route_offset_m,other.id)
          < (NOT p.is_linked,p.feature_rank,p.route_offset_m,p.id)
    )
  )`;
}

/** Separate lines keep their order without connecting disjoint plan routes. */
export const planTrackVerticesSql = `SELECT COALESCE((line.path)[1],1) AS line,(dp).path[1] AS vertex,
  ST_Force2D((dp).geom) AS geom,NULL::float8 AS absolute_m
  FROM source s CROSS JOIN LATERAL ST_Dump(s.path::geometry) line
  CROSS JOIN LATERAL ST_DumpPoints(line.geom) dp WHERE ST_Dimension(line.geom)=1`;
