import { CATALOG_PAGE_SIZE, type CatalogFilters } from "./catalog-search";
import { normalizeSearchName } from "./search-utils";

/** Only ids and ranking fields enter the counted set. Photos, route tracks,
 * and linked counts are read for the twelve displayed records afterward. */
export function catalogSearchSql(filters: CatalogFilters): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const q = normalizeSearchName(filters.query);
  const query = q ? bind(q) : "";
  const contains = q ? bind(`%${q.replace(/[\\%_]/g, "\\$&")}%`) : "";
  const center = filters.nearLat !== null && filters.nearLng !== null
    ? `ST_SetSRID(ST_MakePoint(${bind(filters.nearLng)}, ${bind(filters.nearLat)}), 4326)::geography`
    : null;
  const state = filters.state ? bind(filters.state) : null;
  const area = filters.area ? bind(filters.area) : null;
  const activityNames = { hiking: "outdoor-trek", skiing: "ski", motorized: "outdoor-moto" };
  const activity = filters.activity ? bind(activityNames[filters.activity]) : null;
  const routeFilters = Boolean(filters.maxDistance || filters.maxGain || filters.difficulty);
  const match = (column: string) => q ? `(${column} % ${query} OR ${column} ILIKE ${contains})` : "TRUE";
  const score = (column: string) => q ? `similarity(${column}, ${query})` : "0::real";
  const distance = (column: string) => center ? `ST_Distance(${column}, ${center})` : "NULL::float8";
  const nearby = (column: string) => center ? `ST_DWithin(${column}, ${center}, 80467.2)` : "TRUE";
  const place = ["d.owner = 'peaks'", match("d.search_name"), nearby("d.location")];
  if (state) place.push(`d.country_code = 'US' AND d.state_code = ${state}`);
  if (area) place.push(`EXISTS (SELECT 1 FROM destination_areas da WHERE da.destination_id = d.id AND da.area_id = ${area})`);
  if (activity) place.push(`${activity}::activity_type = ANY(d.activities)`);
  if (routeFilters) place.push("FALSE");

  const route = ["r.owner = 'peaks'", "r.status = 'active'", match("lower(r.name)"), nearby("r.path")];
  if (state || activity) route.push(`EXISTS (SELECT 1 FROM route_destinations rd JOIN destinations d ON d.id = rd.destination_id WHERE rd.route_id = r.id ${state ? `AND d.country_code = 'US' AND d.state_code = ${state}` : ""} ${activity ? `AND ${activity}::activity_type = ANY(d.activities)` : ""})`);
  if (area) route.push(`EXISTS (SELECT 1 FROM route_areas ra WHERE ra.route_id = r.id AND ra.area_id = ${area})`);
  const length = "CASE WHEN r.shape = 'out_and_back' THEN r.distance * 2 ELSE r.distance END";
  const gain = "CASE WHEN r.shape = 'out_and_back' THEN CASE WHEN r.gain IS NULL AND r.gain_loss IS NULL THEN NULL ELSE COALESCE(r.gain, 0) + COALESCE(r.gain_loss, 0) END ELSE r.gain END";
  if (filters.maxDistance) route.push(`(${length}) <= ${bind(filters.maxDistance * 1609.344)}`);
  if (filters.maxGain) route.push(`(${gain}) <= ${bind(filters.maxGain / 3.28084)}`);
  if (filters.difficulty) {
    const miles = `((${length}) / 1609.344)`;
    const feet = `((${gain}) * 3.28084)`;
    const effort = `(COALESCE(${miles},0)*0.65 + COALESCE(${feet},0)/1600 + COALESCE(${feet}/NULLIF(${miles},0),0)/2500 + CASE WHEN r.shape='point_to_point' THEN 0.6 WHEN r.shape='out_and_back' THEN 0.4 ELSE 0.2 END + CASE WHEN r.completion='reverse' THEN 0.35 ELSE 0 END)`;
    const [min, max] = { easy: [0,4], moderate: [4,8], hard: [8,12], strenuous: [12,1e9] }[filters.difficulty];
    route.push(`r.distance IS NOT NULL AND (${gain}) IS NOT NULL`, `${effort} >= ${bind(min)} AND ${effort} < ${bind(max)}`);
    if (filters.difficulty === "moderate") route.push(`${feet} <= 3000`);
  }

  const park = [match("a.search_name"), nearby("a.centroid::geography")];
  if (state) park.push(`a.country_code = 'US' AND ${state} = ANY(a.state_codes)`);
  if (area) park.push(`a.id = ${area}`);
  if (activity) park.push(`EXISTS (SELECT 1 FROM destination_areas da JOIN destinations d ON d.id = da.destination_id WHERE da.area_id = a.id AND ${activity}::activity_type = ANY(d.activities))`);
  if (routeFilters) park.push("FALSE");

  const list = [match("lower(l.name)")];
  if (state || area || activity || center) list.push(`EXISTS (SELECT 1 FROM list_destinations ld JOIN destinations d ON d.id = ld.destination_id WHERE ld.list_id = l.id ${state ? `AND d.country_code = 'US' AND d.state_code = ${state}` : ""} ${area ? `AND EXISTS (SELECT 1 FROM destination_areas da WHERE da.destination_id=d.id AND da.area_id=${area})` : ""} ${activity ? `AND ${activity}::activity_type = ANY(d.activities)` : ""} AND ${nearby("d.location")})`);
  if (routeFilters) list.push("FALSE");

  const scopes = filters.scope === "all" ? "TRUE" : `kind = ${bind(filters.scope)}`;
  const order = {
    relevance: `score DESC, ${center ? "nearby_m ASC NULLS LAST," : ""} has_photo DESC, name ASC NULLS LAST, kind, id`,
    nearest: "nearby_m ASC NULLS LAST, score DESC, name ASC NULLS LAST, kind, id",
    distance: "route_distance ASC NULLS LAST, name ASC NULLS LAST, kind, id",
    elevation: "elevation DESC NULLS LAST, name ASC NULLS LAST, kind, id",
    name: "name ASC NULLS LAST, kind, id",
  }[filters.sort];
  const limit = bind(CATALOG_PAGE_SIZE);
  const offset = bind((filters.page - 1) * CATALOG_PAGE_SIZE);
  return {
    values,
    text: `WITH matched AS MATERIALIZED (
      SELECT 'destinations'::text AS kind, d.id, d.name, ${score("d.search_name")} AS score,
        ${distance("d.location")} AS nearby_m, d.elevation, NULL::float8 AS route_distance,
        (d.hero_image IS NOT NULL) AS has_photo
      FROM destinations d WHERE ${place.join(" AND ")}
      UNION ALL
      SELECT 'routes', r.id, r.name, ${score("lower(r.name)")}, ${distance("r.path")}, NULL::float8, (${length}),
        EXISTS (SELECT 1 FROM route_cover_photos cover WHERE cover.route_id=r.id)
      FROM routes r WHERE ${route.join(" AND ")}
      UNION ALL
      SELECT 'areas', a.id, a.name, ${score("a.search_name")}, ${distance("a.centroid::geography")}, NULL::float8, NULL::float8, FALSE
      FROM areas a WHERE ${park.join(" AND ")}
      UNION ALL
      SELECT 'lists', l.id, l.name, ${score("lower(l.name)")}, NULL::float8, NULL::float8, NULL::float8, FALSE
      FROM lists l WHERE ${list.join(" AND ")}
    ), counts AS (
      SELECT COUNT(*)::int AS "all",
        COUNT(*) FILTER (WHERE kind='destinations')::int AS destinations,
        COUNT(*) FILTER (WHERE kind='routes')::int AS routes,
        COUNT(*) FILTER (WHERE kind='areas')::int AS areas,
        COUNT(*) FILTER (WHERE kind='lists')::int AS lists FROM matched
    ), page AS (SELECT * FROM matched WHERE ${scopes} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset})
    SELECT row_to_json(counts) AS counts, COALESCE((SELECT json_agg(page) FROM page), '[]'::json) AS matches FROM counts`,
  };
}
