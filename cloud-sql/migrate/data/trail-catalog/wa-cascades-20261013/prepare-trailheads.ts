/** Review-only source trailheads. Fetches public DEM; never opens a database. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256 } from "../../../src/trail-catalog/graph";
import { sampleTerrariumProfile } from "../../../src/lib/terrarium-route-profile";
import { TERRARIUM_REQUIRED_ATTRIBUTION } from "../../../src/lib/terrarium-attribution";

async function main() {
  const base = __dirname;
  const evidence = JSON.parse(readFileSync(resolve(base,"source-evidence.json"),"utf8"));
  const specs = [
    {nodeId:13122759855,path:"sources/osm-skyline-map.json",wayId:439627173,routeSourceUrl:"https://www.nps.gov/mora/planyourvisit/skyline-trail.htm",existingId:"xaMGyHut8CoGCSkCPKh6",existingName:"Paradise",reason:"The named Skyline trail entrance is a distinct source point from the broad Paradise catalog row. The current saved catalog binding is about 150 m away. A live source-ID/name search must confirm no Skyline row already exists."},
    {nodeId:2431576647,path:"sources/osm-relation-5194432-full.json",wayId:235057030,routeSourceUrl:"https://www.nps.gov/mora/planyourvisit/natches-peak-loop.htm",existingId:"ZELAKQAzdxPhff3TZmTS",existingName:"American Lake Trailhead",reason:"The nearby catalog name identifies American Lake, not Tipsoo Lake. A live source-ID/name search must confirm no Tipsoo row already exists."},
  ];
  const nodes = specs.map(spec=>{
    const bytes=readFileSync(resolve(base,spec.path));
    const receipt=evidence.snapshots.find((s:{path:string})=>s.path===spec.path);
    if (!receipt || sha256(bytes)!==receipt.sha256) throw new Error("trailhead_snapshot_hash_mismatch");
    const elements=JSON.parse(bytes.toString()).elements;
    const node=elements.find((e:{type:string;id:number})=>e.type==="node"&&e.id===spec.nodeId);
    const way=elements.find((e:{type:string;id:number})=>e.type==="way"&&e.id===spec.wayId);
    if (!node || node.tags?.highway!=="trailhead" || !node.tags?.name || !way?.nodes.includes(node.id)) throw new Error("trailhead_source_identity_missing");
    return {spec,node,receipt};
  });
  const tiles:{url:string;retrievedAt:string;sha256:string;bytes:number}[]=[];
  const nativeFetch=globalThis.fetch;
  const fetcher:typeof fetch=async(input,init)=>{
    const url=String(input);
    if (!/^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/14\/\d+\/\d+\.png$/.test(url)) throw new Error("unexpected_terrain_request");
    const response=await nativeFetch(input,init);
    if(response.ok){const bytes=Buffer.from(await response.clone().arrayBuffer());tiles.push({url,retrievedAt:new Date().toISOString(),sha256:sha256(bytes),bytes:bytes.length});}
    return response;
  };
  const elevations=await sampleTerrariumProfile(nodes.map(({node})=>({lat:node.lat,lng:node.lon})),{fetcher});
  const retrievedAt=new Date().toISOString();
  const proposals=nodes.map(({spec,node,receipt},i)=>({
    status:"proposed_only_not_inserted",
    requiredBeforeInsert:["live_catalog_source_id_and_name_match_review","operator_review"],
    idDerivation:"First 20 uppercase SHA-256 hex characters of openstreetmap:node:<node ID>; proposed ID only, verify no catalog collision before insert.",
    destination:{
      id:sha256(`openstreetmap:node:${node.id}`).slice(0,20).toUpperCase(),
      name:node.tags.name,search_name:node.tags.name.toLowerCase(),elevation:elevations[i],prominence:null,
      location:{type:"Point",coordinates:[node.lon,node.lat,elevations[i]],srid:4326},geohash:null,type:"point",
      activities:["outdoor-trek"],features:["trailhead"],owner:"peaks",country_code:"US",state_code:"WA",
      external_ids:{osm:String(node.id)},
      metadata:{source:"openstreetmap",source_url:`https://www.openstreetmap.org/node/${node.id}`,source_way_url:`https://www.openstreetmap.org/way/${spec.wayId}`,source_license:"ODbL 1.0",source_license_url:"https://opendatacommons.org/licenses/odbl/1-0/",source_attribution:"© OpenStreetMap contributors",source_snapshot:receipt,route_source_url:spec.routeSourceUrl,catalog_audit:"trail-catalog-wa-2026-10-13",elevation_source:"AWS Open Data Terrain Tiles (Mapzen Terrarium z14)",elevation_source_url:"https://registry.opendata.aws/terrain-tiles/",elevation_license_url:"https://github.com/tilezen/joerd/blob/master/docs/attribution.md",elevation_attribution:TERRARIUM_REQUIRED_ATTRIBUTION,elevation_retrieved_at:retrievedAt,elevation_profile:"terrain",region_source_url:spec.routeSourceUrl,region_basis:"Named trailhead in Mount Rainier National Park, Washington, United States; reviewed from the official NPS route page."},
      created_at:null,updated_at:null,
    },
    timestampsPolicy:"Use the insertion transaction time only after approval; these nulls are not SQL insert values.",
    existingNearbyCatalog:{id:spec.existingId,name:spec.existingName},reason:spec.reason,
    remainingRouteGates:["exact source graph and current access","credited trailhead cover","route stats and terrain review","publication checks"],
  }));
  const output={generatedAt:retrievedAt,scope:"review_only_no_database_access",schemaReference:"cloud-sql/migrations/20260730_standard_route_trailheads.sql",proposals,terrainTiles:tiles,excludedDuplicate:{name:"Rainy Pass Trailhead",catalogId:"b5keGEdwDwFwkodbuwaq",reason:"Existing same-identity trailhead is about 175 m from the mapped route start. Repair the existing location from reviewed evidence; do not create a duplicate."}};
  const path=resolve(base,"../../../../../docs/data-audits/trail-catalog-wa-2026-10-13/proposed-trailheads.json");
  writeFileSync(path,JSON.stringify(output,null,2)+"\n");
  console.log(JSON.stringify({path,proposals:proposals.map(p=>({id:p.destination.id,name:p.destination.name,elevation:p.destination.elevation})),databaseWrites:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
