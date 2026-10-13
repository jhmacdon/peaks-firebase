import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const directory=new URL('./',import.meta.url);
const program=readFileSync(new URL('setup.mjs',directory),'utf8')
  .replace(/^#!.*\n/,'').replace(/^import .*;\n/gm,'')
  .replaceAll('import.meta.url',JSON.stringify(new URL('setup.mjs',directory).href));
async function simulate(args=[],fault='') {
  const events=[], output=[];
  let exists=fault==='login-exists', committed=false, roleCreated=false;
  class Client {
    constructor(config) {this.worker=config.user==='peaks-route-factory-worker';}
    async connect() {
      if (fault==='commit-unknown' && committed && !this.worker) throw new Error('network fault with confidential details');
      events.push(this.worker?'worker-connect':'operator-connect');
    }
    async end() {}
    async query(sql,values=[]) {
      if (sql==='BEGIN') {events.push('begin');return {rows:[]};}
      if (sql==='ROLLBACK') {events.push('rollback');if (!committed) exists=false;return {rows:[]};}
      if (sql==='COMMIT') {
        events.push('commit');committed=true;
        if (fault==='commit-unknown') throw new Error('commit acknowledgement lost');
        return {rows:[]};
      }
      if (sql.startsWith('-- Operator-only')) {roleCreated=true;exists=true;events.push('create-role');return {rows:[]};}
      if (sql.startsWith('-- Run first')) {
        events.push(this.worker?'worker-verify':'operator-verify');
        const row={rolname:'peaks-route-factory-worker',rolcanlogin:true,rolinherit:true,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,direct_roles:['peaks-route-factory']};
        for (const key of ['no_role_admin','factory','no_reviewer','no_api','read_candidates','insert_candidates','update_candidates','keep_receipts','no_place_writes','no_path_update','no_name_update','no_queue_seed','no_audit_dml','begin_source_run','finish_source_run']) row[key]=true;
        if (fault==='worker-verification' && this.worker) row.no_reviewer=false;
        return {rows:[row]};
      }
      if (sql.includes('SELECT EXISTS')) return {rows:[{exists}]};
      if (sql.startsWith('INSERT INTO data_source_runs')) {events.push('audit-start');return {rows:[{id:901}]};}
      if (sql.startsWith('UPDATE data_source_runs')) {events.push('audit-'+values[1]);return {rows:[]};}
      if (sql.startsWith('SELECT source_key')) {events.push('worker-read');return {rows:[]};}
      return {rows:[{valid:true}]};
    }
  }
  const context={URL,Buffer,createHash,randomBytes:()=>Buffer.from('generatedFactorySecret'),
    readFileSync, fileURLToPath:value=>value.pathname, createRequire:()=>()=>({Client}),
    spawnSync:(command,argv,options)=> {
      if (command==='gcloud') return {status:0,stdout:'operatorSecret'};
      const action=argv.at(-1);events.push('keychain-'+action);
      assert.equal(options.input===Buffer.from('generatedFactorySecret').toString('base64url'),action!=='absent');
      return {status:0,stdout:JSON.stringify({ok:!((fault==='keychain-add' && action==='add') || (fault==='item-exists' && action==='absent'))})};
    },process:{argv:['node','setup.mjs',...args],exitCode:0,exit(){throw new Error('unexpected exit');}},
    console:{log:value=>output.push(value),error:value=>output.push(value)}};
  await vm.runInNewContext('(async()=>{'+program+'})()',context);
  assert.ok(!output.join('\n').includes('generatedFactorySecret'));
  assert.ok(!output.join('\n').includes(Buffer.from('generatedFactorySecret').toString('base64url')));
  assert.ok(!output.join('\n').includes('operatorSecret'));
  return {events,output,exists,roleCreated,exitCode:context.process.exitCode};
}
test('default preview rolls back and makes no Keychain write',async()=> {
  const result=await simulate();assert.equal(result.exists,false);assert.ok(result.roleCreated);
  assert.ok(result.events.includes('audit-dry_run'));assert.ok(!result.events.includes('commit'));
  assert.deepEqual(result.events.filter(event=>event.startsWith('keychain-')),['keychain-absent']);
});
test('apply saves the new item before commit and verifies the actual login',async()=> {
  const result=await simulate(['--apply']);assert.equal(result.exitCode,0);assert.equal(result.exists,true);
  assert.ok(result.events.indexOf('keychain-add')<result.events.indexOf('commit'));
  assert.ok(result.events.indexOf('worker-verify')>result.events.indexOf('commit'));
  assert.ok(result.events.includes('worker-read'));assert.ok(result.events.includes('audit-success'));
});
test('Keychain failure rolls back; cleanup requires independent absence check',async()=> {
  const result=await simulate(['--apply'],'keychain-add');assert.equal(result.exitCode,1);assert.equal(result.exists,false);
  assert.ok(!result.events.includes('commit'));assert.ok(result.events.includes('keychain-remove-own'));
  assert.ok(result.events.includes('audit-failed'));
});
test('lost commit acknowledgement keeps the new item when readback fails',async()=> {
  const result=await simulate(['--apply'],'commit-unknown');assert.equal(result.exitCode,1);assert.equal(result.exists,true);
  assert.ok(!result.events.includes('keychain-remove-own'));
  assert.match(result.output.join('\n'),/item_retained_login_present_or_outcome_unknown/);
});
test('failed actual-login isolation check keeps committed login and marks audit partial',async()=> {
  const result=await simulate(['--apply'],'worker-verification');assert.equal(result.exitCode,1);assert.equal(result.exists,true);
  assert.ok(!result.events.includes('keychain-remove-own'));assert.ok(result.events.includes('audit-partial'));
});
test('existing login or exact Keychain item stops before creating or overwriting anything',async()=> {
  for (const fault of ['login-exists','item-exists']) {
    const result=await simulate(['--apply'],fault);assert.equal(result.exitCode,1);assert.equal(result.roleCreated,false);
    assert.ok(!result.events.includes('keychain-add'));assert.ok(!result.events.includes('keychain-remove-own'));
    assert.ok(!result.events.includes('commit'));
  }
});
