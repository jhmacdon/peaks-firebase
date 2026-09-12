// Match the catalog feature, not names: a summit called Lookout Mountain
// is not evidence of a fire lookout. Keep country scope explicit.
export const FIRE_LOOKOUT_QUERY = `
  SELECT id, name, elevation::double precision AS elevation,
         ST_Y(location::geometry) AS lat,
         ST_X(location::geometry) AS lng
  FROM destinations
  WHERE country_code = $1 AND state_code = $2
    AND features @> ARRAY['fire-lookout']::destination_feature[]
  ORDER BY name ASC NULLS LAST, id ASC
`;

export interface FireLookout {
  id: string;
  name: string | null;
  elevation: number | null;
  lat: number | null;
  lng: number | null;
}
