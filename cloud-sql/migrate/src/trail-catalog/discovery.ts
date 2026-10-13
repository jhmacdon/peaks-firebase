import type { PoolClient } from "pg";
import { osmRouteHaversineMeters } from "../osm-route-geometry";
import { buildCandidate, parseUsfsCandidatePaths } from "./candidate-source";
import { allowedWay, CandidateRejection, normalizeRouteName, placeContact, placePointDistance, sha256, stableJson } from "./graph";
import { chooseCatalogCandidates } from "./reviewed-candidates";
import { sourceCycles } from "./source-cycles";
import type { BuiltCandidate, CatalogPlace, PilotCandidateInput, PilotManifest, Point, UsfsVertex } from "./types";

export interface DiscoveryBundle { id:string; source:PilotCandidateInput["source"]; terrainReviews?:PilotCandidateInput["terrainReviews"] }
export interface DiscoveryEvidence extends Partial<Pick<PilotCandidateInput,"name"|"aliases"|"identity"|"access"|"commonDestinationEvidence"|"variant"|"elevation"|"attestedStats">> {
  bundleId:string; trailheadId:string; objectiveId?:string|null; relationId?:number; loopKey?:string;
}
export interface DiscoveryConfig {
  version:1; batchKey:string; bbox:{west:number;south:number;east:number;north:number};
  bundles:DiscoveryBundle[];
  evidence?:DiscoveryEvidence[];
  objectiveTypeEvidence?:{objectiveId:string;type:"named_pass"|"named_campsite_cluster";name:string;sourceUrl:string;checkedAt:string;note:string}[];
  limits?:{trailheads?:number;objectives?:number;attempts?:number};
}
export interface DiscoveryRecord {
  sourceKey:string; mode:"objective"|"relation"|"loop"|"trailhead"; bundleId:string; trailheadId:string|null; objectiveId:string|null;
  outcome:"admitted"|"rejected"; reason:string|null; detail?:string; keptSourceKey?:string; name?:string;
  geometryHash?:string; distanceM?:number; sourceAttestation?:string; startGapM?:number;
  sourceNodeId?:number; proposedPoint?:Point; matchingCatalogIds?:string[];
}
type Element={type:string;id:number;lat?:number;lon?:number;nodes?:number[];tags?:Record<string,string>;members?:{type:string;ref:number}[]};
type Vertex={key:string;point:Point;nodeId?:number;sourceVertex?:UsfsVertex};
type Relation={id:number;name:string;aliases:string[];wayIds:number[];missingWayIds:number[];vertices:Vertex[];ends:Vertex[];closed:boolean};
type Index={vertices:Vertex[];components:Map<string,string>;wayIds:number[];relations:Relation[];loops:{key:string;vertices:Vertex[];wayIds?:number[];featureIds?:string[]}[];names:string[];rawTrailheads:Element[]};
export type DiscoverySource={bundle:DiscoveryBundle;snapshots:unknown[]};
const OBJECTIVE_FEATURES=["lake","waterfall","viewpoint","hut","summit","campsite","landform"];

export function discoveryLimits(config:DiscoveryConfig):{trailheads:number;objectives:number;attempts:number} {
  const result={trailheads:config.limits?.trailheads??20,objectives:config.limits?.objectives??100,attempts:config.limits?.attempts??500};
  if (Object.values(result).some(value=>!Number.isSafeInteger(value)||value<1) || result.trailheads>20 || result.objectives>100 || result.attempts>500) throw new Error("discovery limits must be positive and at most20 trailheads,100 objectives,500 attempts");
  return result;
}
export function validateDiscoveryConfig(config:DiscoveryConfig):void {
  if (config.version!==1 || !/^[a-z0-9][a-z0-9:_-]{0,119}$/.test(config.batchKey) || !Array.isArray(config.bundles) || !config.bundles.length || config.bundles.length>8) throw new Error("discovery requires version1, a batch key and1–8 source bundles");
  const b=config.bbox;
  if (!b || [b.west,b.south,b.east,b.north].some(value=>!Number.isFinite(value)) || b.west>=b.east || b.south>=b.north || b.west< -125 || b.east> -116 || b.south<45 || b.north>50) throw new Error("discovery bbox must be a valid bounded Washington pilot area");
  if (new Set(config.bundles.map(bundle=>bundle.id)).size!==config.bundles.length || config.bundles.some(bundle=>!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(bundle.id) || !["osm","usfs-nfs-trails"].includes(bundle.source?.type))) throw new Error("discovery bundle IDs must be unique and use approved geometry sources");
  discoveryLimits(config);
}

/** Catalog reads only. Limits fail the run instead of hiding a truncated inventory. */
export async function loadDiscoveryPlaces(client:Pick<PoolClient,"query">,config:DiscoveryConfig):Promise<CatalogPlace[]> {
  validateDiscoveryConfig(config);
  const limits=discoveryLimits(config),b=config.bbox;
  const select=`SELECT id,name,features::text[] AS features,state_code AS "stateCode",country_code AS "countryCode",
    ST_Y(location::geometry) AS lat,ST_X(location::geometry) AS lng,ST_AsGeoJSON(boundary::geometry)::json AS boundary
    FROM destinations WHERE ST_Intersects(location,ST_MakeEnvelope($1,$2,$3,$4,4326)::geography)`;
  const heads=await client.query(`${select} AND features @> ARRAY['trailhead']::destination_feature[] ORDER BY id LIMIT $5`,[b.west,b.south,b.east,b.north,limits.trailheads+1]);
  const objectives=await client.query(`${select} AND features && $5::destination_feature[] AND NOT features @> ARRAY['trailhead']::destination_feature[]
    AND name IS NOT NULL AND btrim(name)<>'' ORDER BY id LIMIT $6`,[b.west,b.south,b.east,b.north,OBJECTIVE_FEATURES,limits.objectives+1]);
  if (heads.rows.length>limits.trailheads || objectives.rows.length>limits.objectives) throw new CandidateRejection("discovery_inventory_limit","split the bbox; catalog inventory was not fully enumerated");
  if (!heads.rows.length) throw new CandidateRejection("discovery_no_catalog_trailheads");
  return [...heads.rows,...objectives.rows] as CatalogPlace[];
}

function sourceIndex(source:DiscoverySource):Index {
  const {bundle,snapshots}=source;
  const vertices=new Map<string,Vertex>(),adjacent=new Map<string,Set<string>>(),edgeSources=new Map<string,Set<string>>();
  const names=new Set<string>(), relations:Relation[]=[],rawTrailheads:Element[]=[];
  const edgeKey=(a:string,b:string)=>[a,b].sort().join("|");
  const edge=(a:Vertex,b:Vertex,id:string)=>{
    if (a.key===b.key) return;
    vertices.set(a.key,a);vertices.set(b.key,b);
    adjacent.set(a.key,new Set([...(adjacent.get(a.key)??[]),b.key]));adjacent.set(b.key,new Set([...(adjacent.get(b.key)??[]),a.key]));
    const key=edgeKey(a.key,b.key);edgeSources.set(key,new Set([...(edgeSources.get(key)??[]),id]));
    if (vertices.size>50_000 || edgeSources.size>100_000) throw new CandidateRejection("discovery_source_graph_limit");
  };
  if (bundle.source.type==="osm") {
    const elements=new Map<string,Element>();
    for (const snapshot of snapshots) {
      if (!snapshot || typeof snapshot!=="object" || !Array.isArray((snapshot as {elements?:unknown}).elements)) throw new CandidateRejection("invalid_osm_snapshot");
      for (const item of (snapshot as {elements:Element[]}).elements) {
        const key=`${item.type}/${item.id}`,prior=elements.get(key);
        if (prior && stableJson({lat:prior.lat,lon:prior.lon,nodes:prior.nodes,tags:prior.tags,members:prior.members})!==stableJson({lat:item.lat,lon:item.lon,nodes:item.nodes,tags:item.tags,members:item.members})) throw new CandidateRejection("conflicting_source_versions",key);
        elements.set(key,item);
      }
    }
    const ways=[...elements.values()].filter(item=>item.type==="way" && allowedWay(item) && (!bundle.source.wayIds || bundle.source.wayIds.includes(item.id)));
    const vertex=(id:number):Vertex=>{const node=elements.get(`node/${id}`);if (!Number.isFinite(node?.lat)||!Number.isFinite(node?.lon)) throw new CandidateRejection("source_node_missing",String(id));return {key:`node:${id}`,nodeId:id,point:{lat:node!.lat!,lng:node!.lon!}};};
    for (const way of ways) {
      for (const name of [way.tags?.name,way.tags?.ref,...(way.tags?.alt_name?.split(";")??[])]) if (name?.trim()) names.add(name);
      for (let i=1;i<(way.nodes?.length??0);i++) edge(vertex(way.nodes![i-1]),vertex(way.nodes![i]),String(way.id));
    }
    for (const relation of [...elements.values()].filter(item=>item.type==="relation" && item.tags?.type==="route" && ["hiking","foot"].includes(item.tags?.route) && item.tags?.name?.trim())) {
      const wayIds=relation.members?.filter(member=>member.type==="way").map(member=>member.ref)??[];
      const degree=new Map<number,number>();
      for (const id of wayIds) for (const nodeId of elements.get(`way/${id}`)?.nodes??[]) { if (!degree.has(nodeId)) degree.set(nodeId,0); }
      for (const id of wayIds) {
        const nodes=elements.get(`way/${id}`)?.nodes??[];
        for (let i=1;i<nodes.length;i++) {degree.set(nodes[i-1],(degree.get(nodes[i-1])??0)+1);degree.set(nodes[i],(degree.get(nodes[i])??0)+1);}
      }
      const entries=[...degree].filter(([id])=>elements.has(`node/${id}`));
      const missingWayIds=wayIds.filter(id=>!elements.get(`way/${id}`)?.nodes?.length);
      relations.push({id:relation.id,name:relation.tags!.name,aliases:relation.tags!.alt_name?.split(";")??[],wayIds,missingWayIds,vertices:entries.map(([id])=>vertex(id)),ends:entries.filter(([,degree])=>degree===1).map(([id])=>vertex(id)),closed:!missingWayIds.length&&entries.length>2 && entries.every(([,degree])=>degree===2)});
    }
    rawTrailheads.push(...[...elements.values()].filter(item=>item.type==="node" && (item.tags?.highway==="trailhead" || item.tags?.trailhead==="yes")));
  } else {
    const paths=parseUsfsCandidatePaths({source:bundle.source} as PilotCandidateInput,snapshots),parts=new Map<string,number>();
    for (const path of paths) {
      const part=parts.get(path.featureId)??0;parts.set(path.featureId,part+1);path.names.forEach(name=>names.add(name));
      const items=path.coordinates.map(([lng,lat],vertex)=>({key:JSON.stringify([lng,lat]),point:{lng,lat},sourceVertex:{featureId:path.featureId,part,vertex}}));
      for (let i=1;i<items.length;i++) edge(items[i-1],items[i],path.featureId);
    }
  }
  if (vertices.size>50_000 || edgeSources.size>100_000 || relations.length>500) throw new CandidateRejection("discovery_source_graph_limit");
  const seen=new Set<string>(),components=new Map<string,string>();
  for (const key of [...vertices.keys()].sort()) {
    if (seen.has(key)) continue;
    const todo=[key],component:string[]=[];seen.add(key);
    while (todo.length) {const id=todo.pop()!;component.push(id);for (const next of adjacent.get(id)??[]) if (!seen.has(next)) {seen.add(next);todo.push(next);}}
    for (const id of component) components.set(id,key);
  }
  const loops=sourceCycles(adjacent).map(cycle=>{
    const ids=[...new Set(cycle.slice(1).flatMap((id,i)=>[...(edgeSources.get(edgeKey(cycle[i],id))??[])]))].sort();
    return {key:sha256(stableJson(cycle)).slice(0,16),vertices:cycle.map(id=>vertices.get(id)!),...(bundle.source.type==="osm"?{wayIds:ids.map(Number)}:{featureIds:ids})};
  });
  return {vertices:[...vertices.values()],components,wayIds:bundle.source.type==="osm"?[...new Set([...edgeSources.values()].flatMap(ids=>[...ids].map(Number)))].sort((a,b)=>a-b):[],relations,loops,names:[...names].sort(),rawTrailheads};
}

function hasSpecialObjectiveEvidence(config:DiscoveryConfig,place:CatalogPlace):boolean {
  if (place.features.some(feature=>["lake","waterfall","viewpoint","hut","summit"].includes(feature))) return true;
  const type=place.features.includes("landform")?"named_pass":place.features.includes("campsite")?"named_campsite_cluster":null;
  if (!type) return true;
  return (config.objectiveTypeEvidence??[]).some(evidence=>{
    try {
      const url=new URL(evidence.sourceUrl),time=Date.parse(evidence.checkedAt);
      return evidence.objectiveId===place.id && evidence.type===type && normalizeRouteName(evidence.name)===normalizeRouteName(place.name)
        && Boolean(evidence.note.trim()) && Number.isFinite(time) && time<=Date.now()+300_000 && url.protocol==="https:" && !url.username && !url.password
        && ["openstreetmap.org","fs.usda.gov"].some(host=>url.hostname===host||url.hostname.endsWith(`.${host}`));
    } catch {return false;}
  });
}
const closest=(vertices:Vertex[],point:Point)=>[...vertices].sort((a,b)=>osmRouteHaversineMeters(a.point,point)-osmRouteHaversineMeters(b.point,point)||a.key.localeCompare(b.key))[0];
const endpoint=(vertex:Vertex)=>vertex.nodeId?{startNodeId:vertex.nodeId}:{startSourceVertex:vertex.sourceVertex};
const failure=(error:unknown)=>({reason:error instanceof CandidateRejection?error.reason:"candidate_discovery_failed",detail:error instanceof Error?error.message:String(error)});

/** Enumerate real catalog identities; every attempt has an explicit outcome. No database writes. */
export function discoverCatalogCandidates(config:DiscoveryConfig,sources:DiscoverySource[],places:CatalogPlace[]):{manifest:PilotManifest;records:DiscoveryRecord[];complete:boolean} {
  validateDiscoveryConfig(config);
  if (sources.length!==config.bundles.length || sources.some(source=>!config.bundles.some(bundle=>stableJson(bundle)===stableJson(source.bundle)))) throw new CandidateRejection("discovery_source_bundle_mismatch");
  const limits=discoveryLimits(config),heads=places.filter(place=>place.features.includes("trailhead")),objectives=places.filter(place=>!place.features.includes("trailhead")&&typeof place.name==="string"&&place.name.trim()&&place.features.some(feature=>OBJECTIVE_FEATURES.includes(feature)));
  if (!heads.length || heads.length>limits.trailheads || objectives.length>limits.objectives) throw new CandidateRejection("discovery_inventory_limit");
  const records:DiscoveryRecord[]=[],built:BuiltCandidate[]=[];
  let attempts=0,searches=0,complete=true;
  const searchCandidate=(...args:Parameters<typeof buildCandidate>):BuiltCandidate=>{
    if (++searches>limits.attempts) {complete=false;throw new CandidateRejection("discovery_attempt_limit");}
    return buildCandidate(...args);
  };
  const attempt=(record:DiscoveryRecord,run:()=>BuiltCandidate)=>{
    records.push(record);attempts++;
    if (attempts>limits.attempts) {complete=false;record.reason="discovery_attempt_limit";return;}
    try {const candidate=run();built.push(candidate);Object.assign(record,{outcome:"admitted",reason:null,name:candidate.input.name,geometryHash:candidate.geometryHash,distanceM:candidate.distanceM,sourceAttestation:candidate.attestation});}
    catch(error){Object.assign(record,failure(error));}
  };
  for (const source of sources) {
    const bundle=source.bundle;
    let index:Index;
    try {index=sourceIndex(source);} catch(error) {
      for (const head of heads) {
        const targets=objectives.filter(objective=>osmRouteHaversineMeters(head,objective)<=20_000);
        for (const objective of targets.length?targets:[null]) records.push({sourceKey:`discover:${bundle.id}:${sha256(stableJson([head.id,objective?.id,"source"])).slice(0,24)}`,mode:objective?"objective":"trailhead",bundleId:bundle.id,trailheadId:head.id,objectiveId:objective?.id??null,outcome:"rejected",...failure(error)});
      }
      complete=false;continue;
    }
    const matchingEvidence=(head:CatalogPlace,objective:CatalogPlace|null,relationId?:number,loopKey?:string)=>{
      const matches=(config.evidence??[]).filter(e=>e.bundleId===bundle.id&&e.trailheadId===head.id&&(e.objectiveId??null)===(objective?.id??null)&&e.relationId===relationId&&e.loopKey===loopKey);
      if (matches.length>1) throw new CandidateRejection("ambiguous_discovery_evidence");return matches[0];
    };
    const makeInput=(record:DiscoveryRecord,head:CatalogPlace,objective:CatalogPlace|null,start:Vertex,evidence:DiscoveryEvidence|undefined):PilotCandidateInput=>({
      sourceKey:record.sourceKey,name:evidence?.name??objective?.name??"",aliases:evidence?.aliases??[],kind:objective?.features.includes("summit")?"summit":objective?"destination":"loop",
      trailheadId:head.id,objectiveId:objective?.id??null,source:{...bundle.source},...endpoint(start),terrainReviews:bundle.terrainReviews,
      ...(evidence?{identity:evidence.identity,access:evidence.access,commonDestinationEvidence:evidence.commonDestinationEvidence,variant:evidence.variant,elevation:evidence.elevation,attestedStats:evidence.attestedStats}:{}),
    });
    for (const head of heads) {
      const before=records.length,start=closest(index.vertices,head);
      for (const objective of objectives.filter(objective=>osmRouteHaversineMeters(head,objective)<=20_000)) {
        const record:DiscoveryRecord={sourceKey:`discover:${bundle.id}:${sha256(stableJson([head.id,objective.id])).slice(0,24)}`,mode:"objective",bundleId:bundle.id,trailheadId:head.id,objectiveId:objective.id,outcome:"rejected",reason:null};
        attempt(record,()=>{
          if (!start || osmRouteHaversineMeters(start.point,head)>125) throw new CandidateRejection("trailhead_source_gap");
          record.startGapM=osmRouteHaversineMeters(start.point,head);
          if (!hasSpecialObjectiveEvidence(config,objective)) throw new CandidateRejection(objective.features.includes("landform")?"pass_source_evidence_missing":"campsite_cluster_evidence_missing");
          const distances=index.vertices.filter(vertex=>vertex.key!==start.key&&index.components.get(vertex.key)===index.components.get(start.key)).map(vertex=>({vertex,distance:placePointDistance(objective,vertex.point)}));
          const nearestDistance=distances.reduce((minimum,entry)=>Math.min(minimum,entry.distance),Infinity);
          const targets=nearestDistance<=(objective.features.includes("summit")?5:250)?distances.filter(entry=>entry.distance<=nearestDistance+0.000001).map(entry=>entry.vertex):[];
          if (!targets.length) throw new CandidateRejection("objective_source_gap");
          const evidence=matchingEvidence(head,objective),base=makeInput(record,head,objective,start,evidence);
          if (bundle.source.type==="usfs-nfs-trails") {
            base.aliases=[...new Set([...(base.aliases??[]),...index.names])];
            return searchCandidate(base,source.snapshots,{trailhead:head,objective},{endSourceVertices:targets.map(vertex=>vertex.sourceVertex!),maxDistanceM:20_000});
          }
          const candidates:BuiltCandidate[]=[],errors:string[]=[];
          const relations=[null,...index.relations.filter(relation=>!relation.missingWayIds.length)];
          for (const relation of relations) try {
            const input={...base,source:{...base.source,relationId:relation?.id,wayIds:bundle.source.wayIds??index.wayIds},aliases:[...(base.aliases??[]),...(relation?[relation.name,...relation.aliases]:[])]};
            // All mapped ways in the source bundle are candidates; relation coverage remains a separate admission check.
            candidates.push(searchCandidate(input,source.snapshots,{trailhead:head,objective},{endNodeIds:targets.map(vertex=>vertex.nodeId!),maxDistanceM:20_000}));
          } catch(error) {if (error instanceof CandidateRejection&&error.reason==="discovery_attempt_limit") throw error;errors.push(failure(error).reason);}
          if (!candidates.length) throw new CandidateRejection(errors[0]??"hike_attestation_missing",[...new Set(errors)].join(","));
          return candidates.sort((a,b)=>a.distanceM-b.distanceM||a.attestation.localeCompare(b.attestation))[0];
        });
      }
      for (const relation of index.relations) {
        const relationStart=closest(relation.closed||relation.missingWayIds.length?relation.vertices:relation.ends,head);
        if (!relationStart || osmRouteHaversineMeters(relationStart.point,head)>300) continue;
        const record:DiscoveryRecord={sourceKey:`discover:${bundle.id}:${sha256(stableJson([head.id,"relation",relation.id])).slice(0,24)}`,mode:"relation",bundleId:bundle.id,trailheadId:head.id,objectiveId:null,outcome:"rejected",reason:null};
        attempt(record,()=>{
          if (relation.missingWayIds.length) throw new CandidateRejection("relation_source_incomplete",relation.missingWayIds.join(","));
          if (!relation.closed&&relation.ends.length!==2) throw new CandidateRejection("relation_endpoints_ambiguous");
          const end=relation.ends.find(vertex=>vertex.key!==relationStart.key);
          const contacts=end?objectives.filter(objective=>hasSpecialObjectiveEvidence(config,objective)&&placeContact(objective,[end.point],objective.features.includes("summit")?5:250)):[];
          const endHeads=end?heads.filter(place=>place.id!==head.id&&osmRouteHaversineMeters(place,end.point)<=125):[];
          if (!relation.closed&&contacts.length+endHeads.length!==1) throw new CandidateRejection(contacts.length+endHeads.length?"relation_objective_ambiguous":"relation_objective_identity_missing");
          const objective=relation.closed?null:contacts[0]??endHeads[0];record.objectiveId=objective?.id??null;
          const evidence=matchingEvidence(head,objective,relation.id),input=makeInput(record,head,objective,relationStart,evidence);
          input.name=evidence?.name??relation.name;input.aliases=[...(evidence?.aliases??[]),...relation.aliases];input.source={...bundle.source,relationId:relation.id,wayIds:relation.wayIds};
          if (end) input.endNodeId=end.nodeId;
          if (objective?.features.includes("trailhead")) {input.kind="traverse";input.endTrailheadId=objective.id;}
          return searchCandidate(input,source.snapshots,{trailhead:head,objective,endTrailhead:input.kind==="traverse"?objective:null});
        });
      }
      for (const loop of index.loops) {
        const loopStart=closest(loop.vertices,head);
        if (!loopStart || osmRouteHaversineMeters(loopStart.point,head)>150) continue;
        const record:DiscoveryRecord={sourceKey:`discover:${bundle.id}:${sha256(stableJson([head.id,"loop",loop.key])).slice(0,24)}`,mode:"loop",bundleId:bundle.id,trailheadId:head.id,objectiveId:null,outcome:"rejected",reason:null};
        attempt(record,()=>{
          const evidence=matchingEvidence(head,null,undefined,loop.key),input=makeInput(record,head,null,loopStart,evidence);
          const relation=index.relations.find(relation=>!relation.missingWayIds.length&&loop.wayIds?.every(id=>relation.wayIds.includes(id)));
          const cycle=loop.vertices.slice(0,-1),offset=cycle.findIndex(vertex=>vertex.key===loopStart.key),ordered=[...cycle.slice(offset),...cycle.slice(0,offset),loopStart];
          if (bundle.source.type==="osm") {input.source={...bundle.source,wayIds:loop.wayIds,relationId:relation?.id};input.loopNodeIds=ordered.map(vertex=>vertex.nodeId!);input.name=evidence?.name??relation?.name??"";input.aliases=[...(input.aliases??[]),...(relation?[relation.name,...relation.aliases]:[])];}
          else {if (!evidence) throw new CandidateRejection("loop_name_attestation_missing");input.loopSourcePoints=ordered.map(vertex=>vertex.point);input.aliases=[...(input.aliases??[]),...index.names];}
          if (!input.name) throw new CandidateRejection("hike_attestation_missing");
          return searchCandidate(input,source.snapshots,{trailhead:head});
        });
      }
      if (records.length===before) records.push({sourceKey:`discover:${bundle.id}:${head.id}:empty`,mode:"trailhead",bundleId:bundle.id,trailheadId:head.id,objectiveId:null,outcome:"rejected",reason:"no_objectives_or_relations_in_scope"});
    }
    for (const node of index.rawTrailheads) {
      const point={lat:node.lat!,lng:node.lon!},b=config.bbox;
      if (!(point.lng>=b.west&&point.lng<=b.east&&point.lat>=b.south&&point.lat<=b.north)) continue;
      const matching=heads.filter(head=>osmRouteHaversineMeters(head,point)<=125);
      records.push({sourceKey:`discover:${bundle.id}:raw-trailhead:${node.id}`,mode:"trailhead",bundleId:bundle.id,trailheadId:null,objectiveId:null,outcome:"rejected",reason:"raw_trailhead_catalog_binding_required",name:node.tags?.name,sourceNodeId:node.id,proposedPoint:point,matchingCatalogIds:matching.map(place=>place.id)});
    }
  }
  const selection=chooseCatalogCandidates(built,{preferShortestPath:true});
  for (const row of selection.rejected) Object.assign(records.find(record=>record.sourceKey===row.sourceKey)!,{outcome:"rejected",reason:row.reason,keptSourceKey:row.keptSourceKey});
  for (const candidate of selection.kept) records.find(record=>record.sourceKey===candidate.input.sourceKey)!.name=candidate.input.name;
  if (!complete) for (const record of records) if (record.outcome==="admitted") Object.assign(record,{outcome:"rejected",reason:"discovery_incomplete_no_manifest"});
  return {manifest:{version:1,batchKey:config.batchKey,candidates:complete?selection.kept.map(candidate=>candidate.input):[]},records,complete};
}
