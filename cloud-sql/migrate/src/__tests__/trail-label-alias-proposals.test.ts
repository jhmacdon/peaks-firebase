import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const segment=(id:string,ordinal:number,name:string,kind="trail",route_id="r")=>({record:"segment",id,ordinal,display_name:name,kind,route_id});
function propose(rows:ReturnType<typeof segment>[]) {
  const dir=mkdtempSync(join(tmpdir(),"peaks-label-proposals-"));
  try {
    writeFileSync(join(dir,"snapshot.jsonl"),rows.map(row=>JSON.stringify(row)).join("\n"));
    execFileSync("python3",[resolve(__dirname,"../../scripts/propose-trail-label-aliases.py"),"--snapshot",join(dir,"snapshot.jsonl"),"--out",join(dir,"out.json")]);
    return JSON.parse(readFileSync(join(dir,"out.json"),"utf8")) as {id:string;before:string;after:string}[];
  } finally {rmSync(dir,{recursive:true,force:true});}
}

test("repairs every inner segment, then reaches a fixed point",()=>{
  const rows=[segment("a",0,"Lake"),segment("b",1,"Lake"),segment("c",2,"Lake"),segment("d",3,"Lake Trail"),segment("e",4,"Lake Trail")];
  const changes=propose(rows);assert.deepEqual(changes.map(c=>c.id),["a","b","c"]);
  const after=rows.map(row=>({...row,display_name:changes.find(c=>c.id===row.id)?.after??row.display_name}));
  assert.deepEqual(propose(after),[]);
});

test("follows shared segments but does not rename isolated namesakes",()=>{
  const rows=[segment("a",0,"Lake"),segment("b",1,"Lake"),segment("b",0,"Lake","trail","r2"),segment("c",1,"Lake Trail","trail","r2"),segment("isolated",0,"Lake","trail","r3")];
  assert.deepEqual(propose(rows).map(c=>c.id),["a","b"]);
});

test("preserves different identities, terrain boundaries, and unreviewed source codes",()=>{
  assert.deepEqual(propose([segment("a",0,"Pinhoti Trail"),segment("b",1,"Chinnabee Trail")]),[]);
  assert.deepEqual(propose([segment("a",0,"Lake"),segment("b",1,"Lake Trail","road")]),[]);
  assert.deepEqual(propose([segment("a",0,"BUF_"),segment("b",1,"Buf-")]),[]);
});

test("prefers clean existing source labels",()=>{
  assert.deepEqual(propose([segment("a",0,"- Norway Ridge Pathway"),segment("b",1,"Norway Ridge Pathway")]).map(c=>c.after),["Norway Ridge Pathway"]);
  assert.deepEqual(propose([segment("a",0,"Thunder Bird Falls Trail"),segment("b",1,"Thunderbird Falls Trail")]).map(c=>c.after),["Thunderbird Falls Trail"]);
});
