#!/usr/bin/env node
import { closeSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { discoverCatalogCandidates, loadDiscoveryPlaces, validateDiscoveryConfig, type DiscoveryConfig, type DiscoveryRecord } from "./trail-catalog/discovery";
import { loadCandidateSnapshots } from "./trail-catalog/candidate-source";
import { CandidateRejection, sha256, stableJson } from "./trail-catalog/graph";
import type { PilotCandidateInput, PilotManifest } from "./trail-catalog/types";

export function parseDiscoveryArgs(argv:string[]):{config:string;manifest:string;report:string} {
  const result={config:"",manifest:"",report:""};
  for (let i=0;i<argv.length;i++) {
    const key=argv[i].slice(2);
    if (!argv[i].startsWith("--") || !["config","manifest","report"].includes(key) || !argv[i+1] || argv[i+1].startsWith("--") || result[key as keyof typeof result]) throw new Error("Usage: routes:discover --config FILE --manifest NEW.json --report NEW.jsonl");
    result[key as keyof typeof result]=argv[++i];
  }
  if (Object.values(result).some(value=>!value) || resolve(result.manifest)===resolve(result.report)) throw new Error("Discovery needs a config and two distinct new output files");
  return result;
}
export function rebaseDiscoveryManifest(manifest:PilotManifest,configDirectory:string,outputDirectory:string):PilotManifest {
  const path=(value:string)=>relative(outputDirectory,resolve(configDirectory,value));
  return {...manifest,candidates:manifest.candidates.map(candidate=>({...candidate,source:{...candidate.source,snapshots:candidate.source.snapshots.map(snapshot=>({...snapshot,path:path(snapshot.path)}))},...(candidate.elevation?{elevation:{...candidate.elevation,path:path(candidate.elevation.path)}}:{})}))};
}
function pool():Pool {
  if (process.env.NODE_ENV==="test") {
    const url=process.env.TEST_DATABASE_URL;
    if (!url || !decodeURIComponent(new URL(url).pathname).endsWith("_test")) throw new Error("Discovery tests require an isolated TEST_DATABASE_URL ending _test");
    return new Pool({connectionString:url,max:1,connectionTimeoutMillis:10_000,statement_timeout:60_000,lock_timeout:5000});
  }
  return new Pool({host:process.env.DB_HOST??"localhost",port:Number(process.env.DB_PORT??5432),database:process.env.DB_NAME??"peaks",user:process.env.DB_USER??"peaks-api",password:process.env.DB_PASS,max:1,connectionTimeoutMillis:10_000,statement_timeout:60_000,lock_timeout:5000});
}
async function main():Promise<void> {
  const args=parseDiscoveryArgs(process.argv.slice(2)),reportFd=openSync(args.report,"wx");
  let manifestFd:number|undefined,database:Pool|undefined,client:PoolClient|undefined,runId:string|undefined;
  let records:DiscoveryRecord[]=[],manifest:PilotManifest|null=null,failure:unknown;
  let summary:Record<string,unknown>={type:"summary",mode:"discovery-dry-run",complete:false,manifestPath:args.manifest};
  try {
    manifestFd=openSync(args.manifest,"wx");
    database=pool();client=await database.connect();
    const started=await client.query("SELECT begin_trail_catalog_source_run($1) AS id",[JSON.stringify({mode:"discovery-dry-run",state:"started",configPath:args.config,reportPath:args.report,manifestPath:args.manifest})]);
    runId=started.rows[0]?.id;
    if (!runId) throw new Error("Mandatory discovery run receipt was not created");
    const bytes=readFileSync(args.config),config=JSON.parse(bytes.toString("utf8")) as DiscoveryConfig,baseDir=dirname(resolve(args.config));
    validateDiscoveryConfig(config);
    const files=config.bundles.flatMap(bundle=>bundle.source.snapshots.map(snapshot=>resolve(baseDir,snapshot.path)));
    if ([...new Set(files)].reduce((sum,path)=>sum+statSync(path).size,0)>100_000_000) throw new CandidateRejection("discovery_source_bytes_limit");
    const sources=config.bundles.map(bundle=>({bundle,snapshots:loadCandidateSnapshots({source:bundle.source} as PilotCandidateInput,baseDir).map(snapshot=>snapshot.value)}));
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    let places;
    try {places=await loadDiscoveryPlaces(client,config);await client.query("COMMIT");} catch(error) {await client.query("ROLLBACK");throw error;}
    const discovered=discoverCatalogCandidates(config,sources,places);
    records=discovered.records;
    manifest=rebaseDiscoveryManifest(discovered.manifest,baseDir,dirname(resolve(args.manifest)));
    const rejectedByReason=records.reduce<Record<string,number>>((counts,record)=>{if(record.reason) counts[record.reason]=(counts[record.reason]??0)+1;return counts;},{});
    summary={...summary,batchKey:config.batchKey,configSha256:sha256(bytes),reviewHash:sha256(stableJson({config,places,records,manifest})),complete:discovered.complete,catalogPlaces:places.length,candidates:manifest.candidates.length,records:records.length,rejectedByReason};
    if (!discovered.complete || !manifest.candidates.length || records.some(record=>record.outcome==="rejected")) process.exitCode=2;
    if (!manifest.candidates.length) summary.error="discovery_has_no_admitted_candidates";
  } catch(error) {failure=error;summary={...summary,error:error instanceof Error?error.message:String(error)};}
  finally {
    try {if(client&&runId) await client.query("SELECT finish_trail_catalog_source_run($1,$2,$3,$4,0,$5)",[runId,failure?"failed":"dry_run",records.length,manifest?.candidates.length??0,JSON.stringify(summary)]);}
    catch(error) {failure??=error;summary={...summary,auditError:error instanceof Error?error.message:String(error)};}
    try {
      writeFileSync(reportFd,[...records,summary].map(row=>JSON.stringify(row)).join("\n")+"\n");
      if(manifestFd!==undefined) writeFileSync(manifestFd,JSON.stringify(manifest??{version:1,batchKey:"incomplete-discovery",candidates:[]},null,2)+"\n");
    } finally {closeSync(reportFd);if(manifestFd!==undefined)closeSync(manifestFd);client?.release();await database?.end();}
  }
  console.log(JSON.stringify(summary));
  if(failure) throw failure;
}
if(require.main===module) main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
