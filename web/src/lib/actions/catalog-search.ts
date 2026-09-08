"use server";

import db from "../db";
import { CATALOG_PAGE_SIZE, parseCatalogFilters, parseCatalogSelection, type CatalogKind } from "../catalog-search";
import { catalogSearchSql } from "../catalog-search-sql";
import { normalizeAreaKind } from "../area-types";
import { formatRegion, formatRegionList } from "../regions";
import { parseRouteProvenance } from "../route-provenance";
import { routeDoneCoverageSql } from "../route-coverage";
import { areaCoverPhotoSql, distinctAreaCoverPhotosFor } from "../area-cover-photo";
import type { CatalogHit, CatalogPage } from "../catalog-results";
import type { SearchRouteResult } from "./search";
import type { ListRow } from "./lists";

type Row = Record<string, unknown>;
const number = (value: unknown): number | null => value == null ? null : Number(value);
const string = (value: unknown): string | null => typeof value === "string" ? value : null;
const array = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.replace(/^\{|\}$/g, "").split(",").filter(Boolean) : [];

async function loadHits(kind: CatalogKind, ids: string[]): Promise<CatalogHit[]> {
  if (!ids.length) return [];
  if (kind === "destinations") {
    const result = await db.query(`SELECT id,name,elevation,prominence,type,activities,features,state_code,country_code,
      hero_image,hero_image_attribution,hero_image_attribution_url,hero_image_focal_x,hero_image_focal_y,ST_Y(location::geometry) lat,ST_X(location::geometry) lng
      FROM destinations WHERE id=ANY($1::text[]) AND owner='peaks'`, [ids]);
    return result.rows.map((r: Row) => ({
      kind,id:String(r.id),name:string(r.name)??"Unnamed place",lat:number(r.lat),lng:number(r.lng),imageUrl:string(r.hero_image),
      locationLabel:formatRegion(string(r.state_code),string(r.country_code)),
      destination:{id:String(r.id),name:string(r.name),lat:number(r.lat),lng:number(r.lng),elevation:number(r.elevation),prominence:number(r.prominence),type:String(r.type),activities:array(r.activities),features:array(r.features),hero_image:string(r.hero_image),hero_image_attribution:string(r.hero_image_attribution),hero_image_attribution_url:string(r.hero_image_attribution_url),hero_image_focal_x:number(r.hero_image_focal_x)??50,hero_image_focal_y:number(r.hero_image_focal_y)??50},
    }));
  }
  if (kind === "routes") {
    const result = await db.query(`SELECT r.id,r.name,r.distance,r.gain,r.gain_loss,r.completion,r.shape,r.provenance,r.polyline6,
      ST_Y(ST_StartPoint(r.path::geometry)) lat,ST_X(ST_StartPoint(r.path::geometry)) lng,
      cover.destination_id cover_destination_id,cover.destination_name cover_destination_name,cover.image_url cover_image,
      cover.attribution cover_image_attribution,cover.attribution_url cover_image_attribution_url,cover.focal_x cover_image_focal_x,cover.focal_y cover_image_focal_y,
      (SELECT COUNT(*)::int FROM route_destinations rd WHERE rd.route_id=r.id) destination_count,
      (SELECT COUNT(*)::int FROM session_routes sr WHERE sr.route_id=r.id AND ${routeDoneCoverageSql("sr")}) session_count,
      (SELECT d.state_code FROM route_destinations rd JOIN destinations d ON d.id=rd.destination_id WHERE rd.route_id=r.id ORDER BY rd.ordinal LIMIT 1) state_code,
      (SELECT d.country_code FROM route_destinations rd JOIN destinations d ON d.id=rd.destination_id WHERE rd.route_id=r.id ORDER BY rd.ordinal LIMIT 1) country_code
      FROM routes r LEFT JOIN route_cover_photos cover ON cover.route_id=r.id
      WHERE r.id=ANY($1::text[]) AND r.owner='peaks' AND r.status='active'`, [ids]);
    return result.rows.map((r: Row) => ({
      kind,id:String(r.id),name:string(r.name)??"Unnamed route",lat:number(r.lat),lng:number(r.lng),imageUrl:string(r.cover_image),polyline6:string(r.polyline6),
      locationLabel:formatRegion(string(r.state_code),string(r.country_code)),
      route:{...r,distance:number(r.distance),gain:number(r.gain),gain_loss:number(r.gain_loss),session_count:Number(r.session_count),destination_count:Number(r.destination_count),provenance:parseRouteProvenance(r.provenance)} as unknown as SearchRouteResult,
    }));
  }
  if (kind === "areas") {
    const result = await db.query(`WITH ranked AS (
      SELECT a.id,a.name,a.kind,a.designation,a.manager,a.state_codes,a.country_code,ST_Y(a.centroid) lat,ST_X(a.centroid) lng,
      (SELECT COUNT(*)::int FROM destination_areas da JOIN destinations d ON d.id=da.destination_id WHERE da.area_id=a.id AND d.owner='peaks') destination_count,
      (SELECT COUNT(*)::int FROM route_areas ra JOIN routes r ON r.id=ra.route_id WHERE ra.area_id=a.id AND r.owner='peaks' AND r.status='active') route_count
      FROM areas a WHERE a.id=ANY($1::text[]))
      SELECT ranked.*, ${areaCoverPhotoSql()}`, [ids]);
    const photos = distinctAreaCoverPhotosFor(result.rows.map((row: Row)=>({areaId:String(row.id),row})));
    return result.rows.map((r: Row, index: number) => ({
      kind,id:String(r.id),name:String(r.name),lat:number(r.lat),lng:number(r.lng),imageUrl:photos[index]?.imageUrl??null,
      locationLabel:formatRegionList(array(r.state_codes),String(r.country_code)),
      area:{id:String(r.id),name:String(r.name),kind:normalizeAreaKind(r.kind),designation:string(r.designation),manager:string(r.manager),state_codes:array(r.state_codes),destination_count:Number(r.destination_count),route_count:Number(r.route_count),score:0,cover_photo:photos[index]},
    }));
  }
  const result = await db.query(`SELECT l.id,l.name,l.description,l.owner,l.year_established,l.organization,l.source_name,l.source_url,l.region,
    (SELECT COUNT(*)::int FROM list_destinations ld WHERE ld.list_id=l.id) destination_count,
    effective_list_completion_target(l.completion_target,(SELECT COUNT(*)::int FROM list_destinations ld WHERE ld.list_id=l.id)) completion_target,
    COALESCE((SELECT json_agg(json_build_object('url',photo.hero_image,'focalX',photo.hero_image_focal_x,'focalY',photo.hero_image_focal_y,'attribution',photo.hero_image_attribution,'attributionUrl',photo.hero_image_attribution_url)) FROM
      (SELECT d.hero_image,d.hero_image_focal_x,d.hero_image_focal_y,d.hero_image_attribution,d.hero_image_attribution_url FROM list_destinations ld JOIN destinations d ON d.id=ld.destination_id WHERE ld.list_id=l.id AND d.hero_image IS NOT NULL ORDER BY ld.ordinal LIMIT 3) photo),'[]'::json) thumbnails
    FROM lists l WHERE l.id=ANY($1::text[])`,[ids]);
  return result.rows.map((r: Row) => ({kind,id:String(r.id),name:String(r.name),lat:null,lng:null,imageUrl:null,locationLabel:string(r.region),list:r as unknown as ListRow}));
}

export async function searchCatalog(search: string): Promise<CatalogPage> {
  const filters = parseCatalogFilters(search);
  const sql = catalogSearchSql(filters);
  const result = await db.query(sql.text,sql.values);
  const row = result.rows[0] as {counts:CatalogPage["counts"];matches:Array<{kind:CatalogKind;id:string;nearby_m:number|null}>};
  const counts = row.counts;
  const total = counts[filters.scope];
  const matches = row.matches;
  const groups = await Promise.all((["destinations","routes","areas","lists"] as const).map(kind=>loadHits(kind,matches.filter(m=>m.kind===kind).map(m=>m.id))));
  const byId = new Map(groups.flat().map(hit=>[`${hit.kind}:${hit.id}`,hit]));
  const hits = matches.flatMap(match=>{
    const hit = byId.get(`${match.kind}:${match.id}`);
    if (!hit) return [];
    if (hit.destination && match.nearby_m !== null) hit.destination.distance_m = Number(match.nearby_m);
    return [hit];
  });
  return {hits,counts,total,page:filters.page,pageSize:CATALOG_PAGE_SIZE};
}

/** A selected public guide survives pagination, filters, and map panning. */
export async function getCatalogSelection(selection: string): Promise<CatalogHit | null> {
  const parsed = parseCatalogSelection(selection);
  if (!parsed) return null;
  const hit = (await loadHits(parsed.kind,[parsed.id]))[0] ?? null;
  if (hit && parsed.kind === "areas") {
    const result = await db.query(`SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(boundary, 0.001))::json boundary,
      bbox_min_lat,bbox_min_lng,bbox_max_lat,bbox_max_lng FROM areas WHERE id=$1`,[parsed.id]);
    const row = result.rows[0];
    if(row) {
      hit.boundary=row.boundary;
      hit.bounds={minLat:Number(row.bbox_min_lat),minLng:Number(row.bbox_min_lng),maxLat:Number(row.bbox_max_lat),maxLng:Number(row.bbox_max_lng)};
    }
  }
  return hit;
}
