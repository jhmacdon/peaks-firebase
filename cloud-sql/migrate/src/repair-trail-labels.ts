#!/usr/bin/env node

// Reviewed display-name changes only. This tool does not decide feature identities.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

export interface RouteLink { route_id: string; ordinal: number; direction: "forward" | "reverse" }
export interface LabelChange {
  id: string;
  before: string | null;
  after: string;
  stable_hash: string;
  links: RouteLink[];
  reason: string;
  evidence: string[];
}
export interface LabelPlan { version: 1; reviewed_by: string; changes: LabelChange[] }

const literal = (value: string) => "'" + value.replace(/'/g, "''") + "'";
const stableHash = "md5((to_jsonb(s) - ARRAY['display_name','updated_at'])::text)";
const linksSql = `SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'route_id', route_id, 'ordinal', ordinal, 'direction', direction)
  ORDER BY route_id COLLATE "C", ordinal), '[]'::jsonb)
  FROM route_segments WHERE segment_id=s.id`;

export function validatePlan(value: unknown): LabelPlan {
  const p = value as LabelPlan;
  if (p?.version !== 1 || typeof p.reviewed_by !== "string" || !p.reviewed_by.trim()
    || !Array.isArray(p.changes) || p.changes.length < 1 || p.changes.length > 1000) {
    throw new Error("A reviewed version-1 plan with 1–1000 changes is required");
  }
  const ids = new Set<string>();
  for (const c of p.changes) {
    if (!c || typeof c.id !== "string" || !/^[\w.:-]+$/.test(c.id) || ids.has(c.id)) throw new Error("Invalid or duplicate segment ID");
    ids.add(c.id);
    if (!(c.before === null || typeof c.before === "string") || typeof c.after !== "string"
      || !c.after.trim() || c.after !== c.after.trim() || c.after.length > 200 || /[\u0000-\u001f]/.test(c.after)
      || c.before === c.after) throw new Error(`Invalid labels for ${c.id}`);
    if (!/^[a-f0-9]{32}$/.test(c.stable_hash)) throw new Error(`Missing stable hash for ${c.id}`);
    if (typeof c.reason !== "string" || !c.reason.trim() || !Array.isArray(c.evidence)
      || !c.evidence.length || c.evidence.some(e => typeof e !== "string" || !e.trim())) throw new Error(`Missing review evidence for ${c.id}`);
    if (!Array.isArray(c.links) || !c.links.length) throw new Error(`Missing route links for ${c.id}`);
    const links = new Set<string>();
    for (const l of c.links) {
      const key = `${l.route_id}:${l.ordinal}`;
      if (typeof l.route_id !== "string" || !/^[\w.:-]+$/.test(l.route_id)
        || !Number.isInteger(l.ordinal) || l.ordinal < 0 || !["forward", "reverse"].includes(l.direction)
        || links.has(key)) throw new Error(`Invalid route links for ${c.id}`);
      links.add(key);
    }
    // PostgreSQL uses the C collation below, not a machine's locale.
    c.links.sort((a,b) => a.route_id < b.route_id ? -1 : a.route_id > b.route_id ? 1 : a.ordinal - b.ordinal);
  }
  p.changes.sort((a,b) => a.id < b.id ? -1 : 1);
  return p;
}

export function snapshotSql(ids: string[]): string {
  if (!ids.length || ids.some(id => !/^[\w.:-]+$/.test(id))) throw new Error("Valid segment IDs required");
  return `SELECT jsonb_build_object('id',s.id,'display_name',s.display_name,
    'name',s.name,'trail_names',s.trail_names,'kind',s.kind,'distance',s.distance,
    'stable_hash',${stableHash},'links',(${linksSql}),
    'catalog_only',NOT EXISTS (SELECT 1 FROM route_segments rs JOIN routes r ON r.id=rs.route_id
      WHERE rs.segment_id=s.id AND (r.owner <> 'peaks' OR r.status NOT IN ('active','pending','superseded'))),
    'protected',EXISTS(SELECT 1 FROM route_segments rs JOIN trail_catalog_review_jobs j ON j.route_id=rs.route_id
      WHERE rs.segment_id=s.id AND j.state IN ('approved','publish_leased','published','verify_leased','verified','rejected')))
    FROM segments s WHERE s.id IN (${ids.map(literal).join(",")}) ORDER BY s.id COLLATE "C";`;
}

export function repairSql(input: LabelPlan, apply: boolean, backupId?: string): string {
  const plan = validatePlan(input);
  if (apply && !/^\d+$/.test(backupId ?? "")) throw new Error("Applying requires a verified successful Cloud SQL backup ID");
  // Standard-conforming strings make backslashes literal; single quotes are escaped.
  const body = literal(JSON.stringify(plan.changes));
  let delimiter = "$repair$";
  while (body.includes(delimiter)) delimiter = delimiter.slice(0,-1) + "x$";
  return `\\set ON_ERROR_STOP on
SET standard_conforming_strings=on;
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL statement_timeout='180s';
SET LOCAL lock_timeout='10s';
DO ${delimiter}
DECLARE c jsonb; current_hash text; current_label text; current_links jsonb; affected integer;
BEGIN
  FOR c IN SELECT value FROM jsonb_array_elements(${body}::jsonb) LOOP
    -- FOR UPDATE blocks new foreign-key references until this transaction ends.
    SELECT ${stableHash}, s.display_name INTO current_hash,current_label
      FROM segments s WHERE s.id=c->>'id' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing segment %',c->>'id'; END IF;
    IF current_hash IS DISTINCT FROM c->>'stable_hash' THEN RAISE EXCEPTION 'Segment changed: %',c->>'id'; END IF;
    IF current_label IS DISTINCT FROM c->>'before' AND current_label IS DISTINCT FROM c->>'after'
      THEN RAISE EXCEPTION 'Label changed: %',c->>'id'; END IF;
    PERFORM 1 FROM route_segments WHERE segment_id=c->>'id' FOR UPDATE;
    PERFORM 1 FROM routes r WHERE EXISTS (SELECT 1 FROM route_segments rs
      WHERE rs.route_id=r.id AND rs.segment_id=c->>'id') FOR SHARE;
    SELECT (${linksSql}) INTO current_links FROM segments s WHERE s.id=c->>'id';
    IF current_links IS DISTINCT FROM c->'links' THEN RAISE EXCEPTION 'Route links changed: %',c->>'id'; END IF;
    IF EXISTS (SELECT 1 FROM route_segments rs JOIN routes r ON r.id=rs.route_id
      WHERE rs.segment_id=c->>'id' AND (r.owner <> 'peaks' OR r.status NOT IN ('active','pending','superseded')))
      THEN RAISE EXCEPTION 'Segment has links outside the reviewed catalog scope: %',c->>'id'; END IF;
    IF ${apply} AND current_label IS DISTINCT FROM c->>'after' THEN
      UPDATE segments SET display_name=c->>'after',updated_at=now() WHERE id=c->>'id';
      GET DIAGNOSTICS affected=ROW_COUNT;
      IF affected <> 1 THEN RAISE EXCEPTION 'Wrong update count for %',c->>'id'; END IF;
    END IF;
    SELECT ${stableHash},s.display_name INTO current_hash,current_label FROM segments s WHERE s.id=c->>'id';
    IF current_hash IS DISTINCT FROM c->>'stable_hash' THEN RAISE EXCEPTION 'Non-label data changed: %',c->>'id'; END IF;
    IF ${apply} AND current_label IS DISTINCT FROM c->>'after' THEN RAISE EXCEPTION 'Label update changed by a trigger: %',c->>'id'; END IF;
  END LOOP;
  -- Check the whole batch again before committing, including any trigger side effects.
  FOR c IN SELECT value FROM jsonb_array_elements(${body}::jsonb) LOOP
    SELECT ${stableHash},s.display_name,(${linksSql}) INTO current_hash,current_label,current_links
      FROM segments s WHERE s.id=c->>'id';
    IF current_hash IS DISTINCT FROM c->>'stable_hash' OR current_links IS DISTINCT FROM c->'links'
      OR (${apply} AND current_label IS DISTINCT FROM c->>'after')
      THEN RAISE EXCEPTION 'Final batch verification failed: %',c->>'id'; END IF;
  END LOOP;
END ${delimiter};
${snapshotSql(plan.changes.map(c => c.id))}
COMMIT;
`;
}

export function runPsql(sql: string): unknown[] {
  const wrapper = resolve(__dirname, "../../scripts/peaks-psql");
  const result = spawnSync(wrapper, ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    input: sql, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 240_000,
  });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
  return result.stdout.split("\n").filter(Boolean).map(line => JSON.parse(line));
}

function main(argv: string[]): void {
  const flags = new Map<string,string>();
  let apply = false;
  for (let i=0;i<argv.length;i++) {
    const flag=argv[i];
    if (flag === "--apply" && !apply) { apply=true; continue; }
    if (!["--plan","--out","--backup-id","--snapshot-ids"].includes(flag) || flags.has(flag)
      || !argv[i+1] || argv[i+1].startsWith("--")) throw new Error(`Invalid flag ${flag}`);
    flags.set(flag,argv[++i]);
  }
  const out=flags.get("--out");
  if (!out) throw new Error("--out is required; use a new output path for every run");
  if (flags.has("--snapshot-ids")) {
    if (apply || flags.has("--plan") || flags.has("--backup-id")) throw new Error("Snapshot mode is read-only");
    const ids=JSON.parse(readFileSync(flags.get("--snapshot-ids")!,"utf8"));
    const rows=runPsql(`BEGIN READ ONLY; SET LOCAL statement_timeout='180s'; ${snapshotSql(ids)} COMMIT;`);
    if (rows.length !== new Set(ids).size) throw new Error("Snapshot is missing segments");
    writeFileSync(out,JSON.stringify(rows,null,2)+"\n",{flag:"wx"});
    return;
  }
  if (!flags.has("--plan")) throw new Error("--plan is required");
  const plan=validatePlan(JSON.parse(readFileSync(flags.get("--plan")!,"utf8")));
  const planHash=createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  // Reserve the receipt path before any writes. A failure leaves the explicit started record.
  const receipt={status:"started",apply,plan_sha256:planHash,backup_id:flags.get("--backup-id")??null,started_at:new Date().toISOString()};
  writeFileSync(out,JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});
  const rows=runPsql(repairSql(plan,apply,flags.get("--backup-id"))) as Array<{id:string;display_name:string|null;stable_hash:string;links:RouteLink[]}>;
  if (rows.length !== plan.changes.length) throw new Error("Incomplete readback; inspect the committed data before retrying");
  for (const change of plan.changes) {
    const row=rows.find(r=>r.id===change.id)!;
    if (!row || row.stable_hash!==change.stable_hash || row.links.length!==change.links.length
      || row.links.some((l,i)=>l.route_id!==change.links[i].route_id || l.ordinal!==change.links[i].ordinal || l.direction!==change.links[i].direction)
      || (apply && row.display_name!==change.after)) throw new Error(`Readback failed for ${change.id}`);
  }
  writeFileSync(out,JSON.stringify({...receipt,status:apply?"committed":"preview",finished_at:new Date().toISOString(),rows},null,2)+"\n");
  console.log(`${apply?"Applied":"Previewed"} ${rows.length} reviewed labels. Receipt: ${out}`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error); process.exitCode=1; }
}
