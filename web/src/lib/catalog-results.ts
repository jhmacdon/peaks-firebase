import type { CatalogKind } from "./catalog-search";
import type { SearchAreaResult, SearchDestination, SearchRouteResult } from "./actions/search";
import type { ListRow } from "./actions/lists";

export interface CatalogHit {
  kind: CatalogKind;
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  imageUrl: string | null;
  locationLabel: string | null;
  polyline6?: string | null;
  boundary?: GeoJSON.GeoJsonObject | null;
  bounds?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  destination?: SearchDestination;
  route?: SearchRouteResult;
  area?: SearchAreaResult;
  list?: ListRow;
}
export interface CatalogPage {
  hits: CatalogHit[];
  counts: Record<CatalogKind | "all", number>;
  total: number;
  page: number;
  pageSize: number;
}
export function catalogHitHref(hit: Pick<CatalogHit, "kind" | "id">): string {
  return `/${hit.kind}/${encodeURIComponent(hit.id)}`;
}
