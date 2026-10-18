#!/usr/bin/env node
// Operator-only; preview by default. No raw SQL/driver errors reach logs.
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const root = new URL('./', import.meta.url);
const digest = value => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
for (const [file, expected] of Object.entries(manifest.sha256)) {
  if (digest(readFileSync(new URL(file, root))) !== expected) throw new Error('Pinned setup file changed; review and repin it');
}
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && ['--apply', '--check'].includes(args[0]))) throw new Error('Use no flag for rollback preview, --check for offline checks, or --apply after operator review');
if (args[0] === '--check') {
  console.log(JSON.stringify({mode:'offline-check', pinned_files:Object.keys(manifest.sha256), fixed_monthly_cost_delta_usd:0}));
  process.exit(0);
}
const apply = args[0] === '--apply';
const require = createRequire(new URL('../../../../cloud-sql/migrate/package.json', root));
const { Client } = require('pg');
const secret = randomBytes(48).toString('base64url'); // No quote or SQL metacharacters.
const setup = readFileSync(new URL('setup.sql', root), 'utf8').replace('__MEMORY_PASSWORD__', secret);
const verify = readFileSync(new URL('verify.sql', root), 'utf8');
const target = {host:'127.0.0.1',port:5432,database:'peaks',connectionTimeoutMillis:10000,query_timeout:25000};
let admin, auditId, itemAdded=false, commitAttempted=false, committed=false;
let stage='preflight';
function keychain(action, input='') {
  const result = spawnSync('/usr/bin/python3', [fileURLToPath(new URL('keychain.py', root)), action], {input,encoding:'utf8',timeout:30000,maxBuffer:4096});
  if (result.status !== 0 || result.error) throw new Error('Factory Keychain helper failed');
  const status=JSON.parse(result.stdout);
  if (!status.ok) throw new Error('Factory Keychain operation did not pass');
}
function checkRole(rows) {
  const row=rows[0];
  if (rows.length !== 1 || row.rolname !== 'peaks-route-factory-worker' || !row.rolcanlogin || !row.rolinherit || row.rolsuper || row.rolcreatedb || row.rolcreaterole || row.rolreplication || row.rolbypassrls || JSON.stringify(row.direct_roles)!==JSON.stringify(['peaks-route-factory'])) throw new Error('Factory role flags or membership failed');
  const flags=['no_role_admin','factory','no_reviewer','no_api','read_candidates','insert_candidates','update_candidates','keep_receipts','no_place_writes','no_path_update','no_name_update','no_queue_seed','no_audit_dml','begin_source_run','finish_source_run'];
  if (flags.some(key=>row[key]!==true)) throw new Error('Factory grant checks failed');
}
async function operatorConnection() {
  // This is the documented operator secret, never supplied to the worker login.
  const response=spawnSync('gcloud',['secrets','versions','access','latest','--secret=peaks-db-postgres-password','--project=donner-a8608'], {encoding:'utf8',timeout:30000,maxBuffer:65536});
  if (response.status!==0 || response.error || !response.stdout.trim()) throw new Error('Operator secret lookup failed');
  const connection=new Client({...target,user:'postgres',password:response.stdout.trim(),application_name:'peaks-factory-login-setup'});
  await connection.connect();
  const identity=await connection.query("SELECT session_user='postgres' AND current_user=session_user AND current_database()='peaks' AND (SELECT rolcreaterole FROM pg_roles WHERE rolname=session_user) AS valid");
  if (identity.rows[0]?.valid!==true) {await connection.end();throw new Error('Operator identity failed');}
  return connection;
}
async function finishAudit(status, rowsWritten, note) {
  if (!auditId) return;
  const connection=await operatorConnection();
  try {await connection.query('UPDATE data_source_runs SET status=$2,finished_at=clock_timestamp(),rows_matched=1,rows_written=$3,notes=$4 WHERE id=$1 AND source=$5', [auditId,status,rowsWritten,JSON.stringify(note),'trail-catalog-factory-login-setup']);}
  finally {await connection.end();}
}
try {
  // Exact item absence check requests no password bytes and makes no Keychain write.
  keychain('absent');
  admin=await operatorConnection();
  const existing=await admin.query("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='peaks-route-factory-worker') AS exists");
  if (existing.rows[0]?.exists!==false) throw new Error('Fixed factory login already exists');
  const audit=await admin.query("INSERT INTO data_source_runs(source,run_kind,status,started_at,rows_in,rows_written,notes) VALUES('trail-catalog-factory-login-setup','import','partial',clock_timestamp(),1,0,$1) RETURNING id", [JSON.stringify({mode:apply?'apply':'preview',sql_sha256:manifest.sha256['setup.sql'],fixed_monthly_cost_delta_usd:0})]);
  auditId=audit.rows[0].id;
  stage='transaction';
  await admin.query('BEGIN');
  await admin.query(setup);
  checkRole((await admin.query(verify)).rows);
  if (!apply) {
    await admin.query('ROLLBACK');
    await finishAudit('dry_run',0,{mode:'preview',checks:'passed',login_committed:false,keychain_written:false,sql_sha256:manifest.sha256['setup.sql']});
    console.log(JSON.stringify({mode:'preview',checks:'passed',audit_id:auditId,login_committed:false,keychain_written:false}));
  } else {
    // Adding rather than updating prevents overwriting an item created by another actor.
    stage='keychain-add';
    itemAdded=true; keychain('add',secret);
    stage='commit'; commitAttempted=true;
    await admin.query('COMMIT'); committed=true;
    stage='actual-login-verification';
    const worker=new Client({...target,user:'peaks-route-factory-worker',password:secret,application_name:'peaks-factory-login-verify'});
    try {
      await worker.connect();
      const actual=await worker.query("SELECT session_user='peaks-route-factory-worker' AND current_user=session_user AND current_database()='peaks' AS valid");
      if (actual.rows[0]?.valid!==true) throw new Error('Actual factory identity failed');
      checkRole((await worker.query(verify)).rows);
      await worker.query('SELECT source_key FROM trail_catalog_candidate_jobs LIMIT 0');
    } finally {await worker.end();}
    stage='audit-finish';
    await finishAudit('success',1,{mode:'apply',checks:'passed',actual_login_verified:true,keychain_written:true,sql_sha256:manifest.sha256['setup.sql'],fixed_monthly_cost_delta_usd:0});
    console.log(JSON.stringify({mode:'apply',checks:'passed',audit_id:auditId,login_committed:true,keychain_written:true,actual_login_verified:true}));
  }
} catch {
  let provenAbsent=false, cleanup='none';
  try {await admin?.query('ROLLBACK');} catch {}
  // COMMIT errors may mean the server committed before the connection failed.
  // Only independent readback proving absence permits deletion of our new item.
  try {
    const observer=await operatorConnection();
    try {const seen=await observer.query("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='peaks-route-factory-worker') AS exists");provenAbsent=seen.rows[0]?.exists===false;}
    finally {await observer.end();}
  } catch {}
  if (itemAdded && provenAbsent) {
    try {keychain('remove-own',secret);cleanup='own_item_removed';} catch {cleanup='own_item_retained_cleanup_failed';}
  } else if (itemAdded) {cleanup='item_retained_login_present_or_outcome_unknown';}
  const note={mode:apply?'apply':'preview',stage,commit_attempted:commitAttempted,commit_confirmed:committed,login_proven_absent:provenAbsent,keychain_cleanup:cleanup,recovery:'Inspect the exact login and setup audit. Keep the factory Keychain item unless login absence is proved. Do not reset an existing role or use reviewer credentials.'};
  try {await finishAudit(committed || (commitAttempted && !provenAbsent)?'partial':'failed',committed?1:provenAbsent?0:null,note);} catch {note.audit_finish_failed=true;}
  console.error(JSON.stringify({error:'Factory setup stopped; no raw error or secret logged',audit_id:auditId,...note}));
  process.exitCode=1;
} finally {try {await admin?.end();} catch {}}
