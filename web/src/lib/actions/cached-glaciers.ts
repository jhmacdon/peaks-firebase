import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import db from "../db";
import {
  GLACIER_FACTS_QUERY,
  GLACIER_MOUNTAINS_QUERY,
  GLACIER_ROUTES_QUERY,
  MOUNTAIN_GLACIERS_QUERY,
  parseGlacierFactsRow,
  parseGlacierMountainRows,
  parseGlacierRouteRow,
  parseGlacierSummaryRow,
  type GlacierFacts,
  type GlacierMountain,
  type GlacierRouteCrossing,
  type GlacierSummary,
} from "../glaciers";

// Direct catalog reads for the public glacier pages, never server actions:
// `server-only` keeps them out of the browser bundle and off the action
// endpoint. Same shape as cached-lookouts.ts — `cache()` dedupes the
// layout/page pair within one request, `unstable_cache` holds the rows for
// the segment's hour so a hub page doesn't re-aggregate on every render.

export const getGlacierFacts = cache(
  unstable_cache(
    async (id: string): Promise<GlacierFacts | null> => {
      const result = await db.query(GLACIER_FACTS_QUERY, [id]);
      return result.rows[0] ? parseGlacierFactsRow(result.rows[0]) : null;
    },
    ["glacier-facts"],
    { revalidate: 3600 }
  )
);

export const getMountainGlaciers = cache(
  unstable_cache(
    async (mountainId: string, withOutlines: boolean): Promise<GlacierSummary[]> => {
      const result = await db.query(MOUNTAIN_GLACIERS_QUERY, [mountainId, withOutlines]);
      return result.rows.map(parseGlacierSummaryRow);
    },
    ["mountain-glaciers"],
    { revalidate: 3600 }
  )
);

export const getGlacierMountains = cache(
  unstable_cache(
    async (): Promise<GlacierMountain[]> => {
      const result = await db.query(GLACIER_MOUNTAINS_QUERY);
      return parseGlacierMountainRows(result.rows);
    },
    ["glacier-mountains"],
    { revalidate: 3600 }
  )
);

export const getGlacierRoutes = cache(
  unstable_cache(
    async (id: string): Promise<GlacierRouteCrossing[]> => {
      const result = await db.query(GLACIER_ROUTES_QUERY, [id]);
      return result.rows.map(parseGlacierRouteRow);
    },
    ["glacier-routes"],
    { revalidate: 3600 }
  )
);

export async function getGlacierMountainBySlug(slug: string): Promise<GlacierMountain | null> {
  const mountains = await getGlacierMountains();
  return mountains.find((mountain) => mountain.slug === slug) ?? null;
}

export async function getGlacierMountainById(id: string): Promise<GlacierMountain | null> {
  const mountains = await getGlacierMountains();
  return mountains.find((mountain) => mountain.id === id) ?? null;
}
