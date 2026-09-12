import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import db from "../db";
import { FIRE_LOOKOUT_QUERY, type FireLookout } from "../fire-lookouts";

export const getStateLookouts = cache(unstable_cache(async (stateCode: "WA" | "CA"): Promise<FireLookout[]> => {
  const result = await db.query<FireLookout>(FIRE_LOOKOUT_QUERY, ["US", stateCode]);
  // A missing catalog must remain an error, not an indexable empty guide.
  if (result.rows.length === 0) throw new Error(`${stateCode} fire lookout catalog is empty`);
  return result.rows;
}, ["state-fire-lookouts"], { revalidate: 3600 }));
