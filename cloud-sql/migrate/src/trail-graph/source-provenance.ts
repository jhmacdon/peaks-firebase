import type { Provenance } from './types';
export const PEAKS_ORIGIN = 'https://peaks.app'; // web uses NEXT_PUBLIC_SITE_URL; no fixed public origin there.
export function peaksLegacyProvenance(createdAt?: string): Provenance {
  return {source_kind:'peaks-legacy',source_url:PEAKS_ORIGIN,license_name:'Peaks',license_url:PEAKS_ORIGIN,attribution:'Peaks',retrieved_at:createdAt ?? '',osm_way_ids:[],osm_way_urls:[],contains_osm_geometry:false};
}
export function sourceLeaves(value: Provenance): Provenance[] {
  if (value.sources) return value.sources.flatMap(sourceLeaves);
  const {wa_catalog, ...source} = value as Provenance & {wa_catalog?: unknown}; return [source];
}
export const sourceKey = (p: Provenance): string => JSON.stringify([p.source_kind,p.license_name,p.license_url,p.attribution,p.contains_osm_geometry,p.contains_osm_geometry?null:p.source_url,(p as any).elevation_source ?? null,(p as any).elevation_profile ?? null]);
/** Includes every rights group. An offline missing created_at remains empty;
 * the loader binds it to the locked route's timestamp instead of inventing it. */
export function unionProvenance(values: Provenance[]): Provenance {
  const groups = new Map<string,Provenance[]>();for(const p of values.flatMap(sourceLeaves)){const key=sourceKey(p);groups.set(key,[...(groups.get(key)??[]),p]);}
  if (!groups.size) throw new Error('No source provenance');
  const sources=[...groups].sort(([a,x],[b,y])=>Number(y[0].contains_osm_geometry)-Number(x[0].contains_osm_geometry)||a.localeCompare(b)).map(([,g])=>{
    const first=[...g].sort((a,b)=>b.retrieved_at.localeCompare(a.retrieved_at)||a.source_url.localeCompare(b.source_url))[0],ids=[...new Set(g.flatMap(s=>s.osm_way_ids))].sort((a,b)=>a-b);
    return {...first,osm_way_ids:ids,osm_way_urls:ids.map(id=>`https://www.openstreetmap.org/way/${id}`)};
  });
  const ids=[...new Set(sources.flatMap(s=>s.osm_way_ids))].sort((a,b)=>a-b),top={...sources[0],osm_way_ids:ids,osm_way_urls:ids.map(id=>`https://www.openstreetmap.org/way/${id}`)};
  return sources.length===1?top:{...top,sources};
}
export function validSource(p: Provenance): boolean {
  const base=(s:Provenance):boolean=>{
    if(!s||typeof s!=='object'||Array.isArray(s))return false;
    const has=(key:string)=>Object.prototype.hasOwnProperty.call(s,key);
    const keys=Object.keys(s),required=['source_kind','source_url','license_name','license_url','attribution','retrieved_at','osm_way_ids','osm_way_urls','contains_osm_geometry'];
    if(!required.every(has)||keys.some(k=>![...required,'elevation_source','elevation_profile'].includes(k))||!['source_kind','source_url','license_name','license_url','attribution','retrieved_at'].every(k=>typeof (s as any)[k]==='string')||typeof s.contains_osm_geometry!=='boolean')return false;
    if(has('elevation_source')!==has('elevation_profile'))return false;
    if(has('elevation_source')&&(typeof(s as any).elevation_source!=='string'||!(s as any).elevation_source.trim()||!['terrain','monotonic_ascent'].includes((s as any).elevation_profile)))return false;
    if(!/^[a-z0-9][a-z0-9_-]*$/.test(s.source_kind)||!/^https?:\/\/\S+$/.test(s.source_url)||!s.license_name?.trim()||!/^https?:\/\/\S+$/.test(s.license_url)||!s.attribution?.trim()||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(s.retrieved_at))return false;
    if(!Array.isArray(s.osm_way_ids)||!Array.isArray(s.osm_way_urls)||s.osm_way_ids.length!==s.osm_way_urls.length||s.contains_osm_geometry!==(s.osm_way_ids.length>0))return false;
    if(s.osm_way_ids.some((id,i)=>!Number.isSafeInteger(id)||id<=0||s.osm_way_urls[i]!==`https://www.openstreetmap.org/way/${id}`))return false;
    return !s.contains_osm_geometry||(s.source_kind==='openstreetmap'&&s.license_name==='Open Data Commons Open Database License (ODbL) 1.0'&&s.license_url==='https://opendatacommons.org/licenses/odbl/1-0/'&&s.attribution==='© OpenStreetMap contributors');
  };
  if(!p||typeof p!=='object')return false;
  const {sources,wa_catalog,...header}=p as Provenance&{wa_catalog?:unknown};if(!base(header))return false;
  if(sources===undefined)return true;
  if(!Array.isArray(sources)||sources.length<2||sources.length>128||!sources.every(base)||new Set(sources.map(s=>JSON.stringify(s))).size!==sources.length)return false;
  const omitIds=(s:Provenance)=>JSON.stringify(Object.entries(s).filter(([k])=>!['osm_way_ids','osm_way_urls'].includes(k)).sort(([a],[b])=>a.localeCompare(b)));
  const ids=[...new Set(sources.flatMap(s=>s.osm_way_ids))].sort((a,b)=>a-b);
  return omitIds(header)===omitIds(sources[0])&&header.contains_osm_geometry===sources.some(s=>s.contains_osm_geometry)&&JSON.stringify([...new Set(header.osm_way_ids)].sort((a,b)=>a-b))===JSON.stringify(ids);
}
export function sourceCompatible(segment:Provenance,route:Provenance):boolean {
  return validSource(segment)&&validSource(route)&&sourceLeaves(segment).every(s=>sourceLeaves(route).some(r=>sourceKey(s)===sourceKey(r)&&s.osm_way_ids.every(id=>r.osm_way_ids.includes(id))));
}
export function sourcesCovered(segments:Provenance[],route:Provenance):boolean {
  return !!segments.length&&validSource(route)&&segments.every(s=>sourceCompatible(s,route))&&sourceLeaves(route).every(claim=>{
    const actual=segments.flatMap(sourceLeaves).filter(s=>sourceKey(s)===sourceKey(claim)&&s.osm_way_ids.every(id=>claim.osm_way_ids.includes(id)));
    return !!actual.length&&claim.osm_way_ids.every(id=>actual.some(s=>s.osm_way_ids.includes(id)));
  });
}
