import type { Request, RequestHandler } from "express";
import db from "../db";
import { getUid } from "../auth";
import { hasGlacierSupport } from "./schema-features";
import { attachGlacierSummaries, collectGlacierSummaryIds } from "./glacier-summary";

export const GLACIER_CAPABILITY = "glaciers-v1";
export function supportsGlaciers(req: Pick<Request,"headers">): boolean {
  const raw = req.headers?.["x-peaks-capabilities"];
  return typeof raw === "string" && raw.split(/[ ,]+/).includes(GLACIER_CAPABILITY);
}
/** Text-array comparison also works before the enum migration is installed. */
export function glacierVisibilitySql(alias: string, allow=true): string {
  return allow ? "TRUE" : `NOT ('glacier'=ANY(${alias}.features::text[]))`;
}
/** The shipping iOS destination parser rejects MultiPolygon boundaries. Keep
 * the guard at the response boundary for nested places on all older readers;
 * search/nearby additionally filter before LIMIT, in their candidate queries.
 */
const glacierLeaves=new Set(["boundary","massif_boundary","path_preview","health_data","source_contributions",
  "metadata","provenance","amenities","external_ids","external_links"]);
const glacierFields=new Set(["glacier","glacier_crossings","glacier_stretches","glacier_crossings_status"]);
export function withoutGlaciers(value: any): any {
  if (Array.isArray(value)) {
    const rows=value.filter(v=>!v?.features?.includes?.("glacier")).map(withoutGlaciers);
    return rows.length===value.length && rows.every((v,i)=>v===value[i]) ? value:rows;
  }
  if (!value || typeof value!=="object" || value instanceof Date) return value;
  let result=value;
  // Skip geometry and health payloads: they contain no destination rows.
  for (const [key,v] of Object.entries(value)) {
    if (glacierFields.has(key)) {
      if (result===value) result={...value};
      delete result[key];
    } else if (!glacierLeaves.has(key)) {
      const next=withoutGlaciers(v);
      if (next!==v) { if (result===value) result={...value}; result[key]=next; }
    }
  }
  return result;
}
export const glacierCapabilityGuard: RequestHandler = (req,res,next) => {
  if (req.method !== "GET") return next();
  res.vary("X-Peaks-Capabilities");
  const json=res.json.bind(res);
  if (supportsGlaciers(req)) {
    // Summary rows gain {kind,parent_mountain} after their query's LIMIT.
    res.json=(body: any) => {
      if (res.statusCode>=300 || !collectGlacierSummaryIds(body).size) return json(body);
      void (async()=>{
        let out=body;
        try {
          if (await hasGlacierSupport())
            out=await attachGlacierSummaries(body,getUid(req),async(text,values)=>(await db.query(text,values)).rows);
        } catch (error) { console.error("Glacier summary lookup failed",error); }
        if (!res.headersSent && !res.destroyed) json(out);
      })();
      return res;
    };
    return next();
  }
  res.json=(body: any) => {
    if (body?.features?.includes?.("glacier")) { res.status(404); return json({error:"Destination not found"}); }
    return json(withoutGlaciers(body));
  };
  next();
};
