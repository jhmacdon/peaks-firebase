import { readFileSync,writeFileSync,existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { Pool } from "pg";
import db from "../src/db";
import { processPlan,buildPlanPlaceReadQuery } from "../src/processing";
import { buildPlanRepairSnapshotQuery } from "../src/lib/plan-repair";

// Local, serial repair. The snapshot fixes the authorized cohort and preserves
// user fields, goals, route bindings, and manual matches. Never schedules work.
const args=process.argv.slice(2);
function value(name:string) {const i=args.indexOf(name);return i<0?undefined:args[i+1];}

async function main() {
  const uid=value("--uid"),snapshotPath=value("--snapshot");
  const count=Number(value("--expected-count"));
  const apply=args.includes("--apply"),verify=args.includes("--verify");
  if (!uid||!snapshotPath||!Number.isSafeInteger(count)||count<1||count>500)
    throw new Error("Use --uid UID --snapshot FILE --expected-count N [--apply|--verify]");
  if (apply&&verify) throw new Error("Choose apply or verify");
  if (apply&&!/^[a-f0-9]{40}$/.test(value("--deployed-sha")??""))
    throw new Error("Apply requires --deployed-sha with the verified deployed commit");
  if (process.env.TEST_DATABASE_URL) throw new Error("This production repair refuses TEST_DATABASE_URL");
  const password=execFileSync("gcloud",["secrets","versions","access","latest","--secret=peaks-db-password","--project=donner-a8608"],
    {encoding:"utf8",env:{...process.env,CLOUDSDK_PYTHON:"/opt/homebrew/bin/python3.14"}}).trim();
  const pool=new Pool({host:"127.0.0.1",port:5432,user:"peaks-api",database:"peaks",password,max:2,
    statement_timeout:120000,connectionTimeoutMillis:12000,
    ...(!apply?{options:"-c default_transaction_read_only=on"}:{}),application_name:"peaks_plan_place_repair"});
  try {
    const get=async(ids?:string[])=>{const q=buildPlanRepairSnapshotQuery(uid,ids);return(await pool.query(q.text,q.values)).rows;};
    if (!apply&&!verify) {
      if (existsSync(snapshotPath)) throw new Error("Snapshot already exists; use a new path or verify it");
      const plans=await get();
      if (plans.length!==count||plans.some(p=>!p.geometry_complete)) throw new Error(`Cohort count ${plans.length}/${count}; incomplete route geometry: ${plans.filter(p=>!p.geometry_complete).map(p=>p.id).join(",") || "none"}`);
      writeFileSync(snapshotPath,JSON.stringify({uid,capturedAt:new Date().toISOString(),plans},null,2),{flag:"wx",mode:0o600});
      console.log(JSON.stringify({snapshotted:plans.length,geometryComplete:true,productionWrites:0}));
      return;
    }
    const snapshot=JSON.parse(readFileSync(snapshotPath,"utf8"));
    if (snapshot.uid!==uid||snapshot.plans.length!==count) throw new Error("Snapshot owner or cohort count differs");
    const baseline=new Map<string,any>(snapshot.plans.map((p:any)=>[p.id,p]));
    const ids=[...baseline.keys()];
    const validateSource=(row:any)=>{
      const before=baseline.get(row.id);
      if (!before||row.fingerprint!==before.fingerprint||!row.geometry_complete
        ||!isDeepStrictEqual(row.protected,before.protected)||!isDeepStrictEqual(row.goals,before.goals)
        ||!isDeepStrictEqual(row.routes,before.routes)||!isDeepStrictEqual(row.manual,before.manual))
        throw new Error(`Source or protected data changed for plan ${row.id}`);
    };
    const current=await get(ids);
    if(current.length!==count) throw new Error("A snapshotted plan is missing");
    current.forEach(validateSource);
    const results:unknown[]=[];
    if (apply) {
      for (const row of current) {
        if(row.processing_state==="completed"&&row.processed_at&&row.has_path) {
          results.push({id:row.id,alreadyComplete:true});continue;
        }
        try {
          const result=await processPlan(row.id,uid,{pool,expectedSourceFingerprint:row.fingerprint});
          results.push({id:row.id,...result});
        } catch(error) {results.push({id:row.id,error:error instanceof Error?error.message:String(error)});}
        writeFileSync(`${snapshotPath}.results.json`,JSON.stringify({deployedSha:value("--deployed-sha"),results},null,2),{mode:0o600});
        console.log(JSON.stringify({processed:results.length,total:count}));
      }
    }
    const after=await get(ids);
    if(after.length!==count) throw new Error("A repaired plan is missing");
    after.forEach(validateSource);
    const incomplete=after.filter(p=>p.processing_state!=="completed"||!p.processed_at||!p.has_path);
    if(incomplete.length) throw new Error(`${incomplete.length} plans remain incomplete: ${incomplete.map(p=>p.id).join(",")}`);
    const duplicate=await pool.query(`SELECT a.plan_id FROM plan_reached_destinations a
      JOIN plan_reached_destinations b ON b.plan_id=a.plan_id AND b.destination_id>a.destination_id
      JOIN destinations da ON da.id=a.destination_id JOIN destinations db ON db.id=b.destination_id
      WHERE a.plan_id=ANY($1::text[]) AND da.features && ARRAY['campsite','hut']::destination_feature[]
        AND db.features && ARRAY['campsite','hut']::destination_feature[]
        AND lower(btrim(da.name))=lower(btrim(db.name)) AND ST_DWithin(da.location,db.location,50)`,[ids]);
    if(duplicate.rows.length) throw new Error("Duplicate camp records remain in repaired plans");
    for (const id of ids) {
      const q=buildPlanPlaceReadQuery(id);
      const expected=(await pool.query(q.text,q.values)).rows.map(row=>row.id);
      const actual=(await pool.query(`SELECT destination_id,ordinal,source FROM plan_reached_destinations
        WHERE plan_id=$1 ORDER BY ordinal,destination_id`,[id])).rows;
      const manual=baseline.get(id).manual.map((row:any)=>row.destination_id);
      const expectedIds=[...new Set([...expected,...manual])].sort();
      if(!isDeepStrictEqual(actual.map(row=>row.destination_id).sort(),expectedIds)
        ||actual.some(row=>row.source==="auto"&&row.ordinal!==expected.indexOf(row.destination_id)))
        throw new Error(`Place membership or first-visit order differs for plan ${id}`);
    }
    const totals=await pool.query(`SELECT count(*)::int AS matches,count(DISTINCT plan_id)::int AS plans_with_matches
      FROM plan_reached_destinations WHERE plan_id=ANY($1::text[])`,[ids]);
    const report={verified:after.length,protectedDataUnchanged:true,firstVisitOrderVerified:true,
      duplicates:0,...totals.rows[0],verifiedAt:new Date().toISOString()};
    writeFileSync(`${snapshotPath}.verification.json`,JSON.stringify(report,null,2),{mode:0o600});
    console.log(JSON.stringify(report));
  } finally {await pool.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.end());
