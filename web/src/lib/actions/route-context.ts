"use server";

import { parseRoutePlacePage, type RoutePlacePage } from "../route-context";

/** Public catalog route context comes from the same matcher iOS uses. */
export async function getRoutePlacePreview(routeId: string): Promise<RoutePlacePage> {
  return readRoutePlaces(routeId, undefined, true);
}

export async function getRoutePlaces(routeId: string, cursor?: string): Promise<RoutePlacePage> {
  return readRoutePlaces(routeId, cursor, false);
}

async function readRoutePlaces(routeId: string, cursor: string | undefined, cached: boolean): Promise<RoutePlacePage> {
  if (!routeId || routeId.length>200 || (cursor && cursor.length>1024)) throw new Error("Invalid route places request");
  const base=(process.env.PEAKS_API_URL ?? "https://peaks-api-726404093396.us-central1.run.app").replace(/\/+$/,"");
  const url=`${base}/api/routes/${encodeURIComponent(routeId)}/landmarks${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`;
  const response=await fetch(url,{...(cached ? {next:{revalidate:3600}} : {cache:"no-store" as const}),
    signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(response.status===409 ? "This route changed. Reload to see its places." : "Places could not be loaded. Please try again.");
  return parseRoutePlacePage(await response.json());
}
