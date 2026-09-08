import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import db from "../db";
import { WASHINGTON_LOOKOUT_QUERY, type WashingtonLookout } from "../washington-lookouts";

export const getWashingtonLookouts = cache(unstable_cache(async (): Promise<WashingtonLookout[]> => {
  const result = await db.query<WashingtonLookout>(WASHINGTON_LOOKOUT_QUERY, ["US", "WA"]);
  // A missing catalog must remain an error, not an indexable empty guide.
  if (result.rows.length === 0) throw new Error("Washington fire lookout catalog is empty");
  return result.rows;
}, ["washington-fire-lookouts"], { revalidate: 3600 }));
