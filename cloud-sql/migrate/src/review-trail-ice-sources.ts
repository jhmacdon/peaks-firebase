#!/usr/bin/env node
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { haversine, insidePolygon } from "./trail-graph/geo";
import type { Coord } from "./trail-graph/types";
import { staleGlacierOutlines, staleOutline } from "./glaciers/stale-outlines";

// Label evidence only: outside-source edges require terrain review, not a guessed glacier name.
// Gone outlines (data/stale-glacier-outlines.json) count as no ice; remnant outlines report their reviewed label.
async function main(): Promise<void> {
  const [pathsFile,out,...featuresFiles]=process.argv.slice(2);
  if (!pathsFile || !out || !featuresFiles.length) throw new Error("Usage: paths.jsonl output.json features.geojsonseq ...");
  const polygons: Array<{id:string;name:string;status?:"remnant";polygons:Coord[][][];bounds:number[]}> = [];
  const stale=staleGlacierOutlines();
  for (const file of featuresFiles) {
    for await (const line of createInterface({input:createReadStream(file),crlfDelay:Infinity})) {
      const f=JSON.parse(line.replace(/^\x1e/,""));const p=f.properties,g=f.geometry;
      if (p?.natural!=="glacier" || !["Polygon","MultiPolygon"].includes(g?.type)) continue;
      const id=`${p['@type']??'way'}/${p['@id']??f.id}`,listed=staleOutline(id,stale);
      if (listed?.status==="gone") continue;
      const rings:Coord[][][]=g.type==="Polygon"?[g.coordinates]:g.coordinates;
      const coords=rings.flat(2);
      polygons.push({id,name:listed?.remnant_label??p.name?.trim()??"",...(listed?{status:"remnant" as const}:{}),polygons:rings,
        bounds:[Math.min(...coords.map(c=>c[0])),Math.min(...coords.map(c=>c[1])),Math.max(...coords.map(c=>c[0])),Math.max(...coords.map(c=>c[1]))]});
    }
  }
  const rows=readFileSync(pathsFile,"utf8").trim().split("\n").map(l=>JSON.parse(l));
  const results=rows.filter(s=>["glacier","snowfield"].includes(s.kind)).map(s=>{
    const coords:Coord[]=s.path.coordinates;let outside=0,total=0;const covered=new Map<string,{id:string;name:string;meters:number}>();
    for (let i=1;i<coords.length;i++) {
      const a=coords[i-1],b=coords[i],mid:Coord=[(a[0]+b[0])/2,(a[1]+b[1])/2];const meters=haversine(a,b);total+=meters;
      const matches=polygons.filter(p=>mid[0]>=p.bounds[0]&&mid[0]<=p.bounds[2]&&mid[1]>=p.bounds[1]&&mid[1]<=p.bounds[3]&&p.polygons.some(r=>insidePolygon(mid,r)));
      if (!matches.length) outside+=meters;
      for (const p of matches) {const record=covered.get(p.id)??{id:p.id,name:p.name,...(p.status?{status:p.status}:{}),meters:0};record.meters+=meters;covered.set(p.id,record);}
    }
    return {id:s.id,kind:s.kind,total_m:total,outside_m:outside,source_polygons:[...covered.values()].sort((a,b)=>b.meters-a.meters)};
  });
  writeFileSync(out,JSON.stringify({method:"Every stored edge midpoint, with source polygon holes respected. Gone outlines from data/stale-glacier-outlines.json are skipped; remnant outlines carry status remnant and their reviewed label. This checks source labels, not current ice extent or terrain safety.",features_files:featuresFiles.map(f=>f.replace(/^.*\/private\//,"private/")),segments:results},null,2)+"\n",{flag:"wx"});
}
if (require.main===module) main().catch(e=>{console.error(e);process.exitCode=1;});
