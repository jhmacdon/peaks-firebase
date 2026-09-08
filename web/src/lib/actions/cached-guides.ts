import "server-only";
import { cache } from "react";
import db from "../db";

export interface GuideDestination {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

export const getWashingtonWaterfalls = cache(async () => {
  const result = await db.query<GuideDestination>(`
    SELECT id, name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
    FROM destinations
    WHERE country_code = $1 AND state_code = $2
      AND features @> ARRAY['waterfall']::destination_feature[]
      AND name IS NOT NULL AND btrim(name) <> ''
    ORDER BY name, id
  `, ["US", "WA"]);
  if (!result.rows.length) throw new Error("Washington waterfall catalog is empty");
  return result.rows;
});

