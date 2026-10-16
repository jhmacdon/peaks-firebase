import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const files = ['20261016_wa_catalog_activation.sql', '20261017_wa_catalog_source_bundles.sql'];
const migrations = files.map(file => ({ file, sql: readFileSync(resolve(__dirname, '../../../migrations', file), 'utf8') }));

for (const { file, sql } of migrations) {
  test(`${file}: every table and function creation permits replay`, () => {
    const tables = [...sql.matchAll(/^CREATE TABLE\b[^;]+;/gm)];
    const functions = [...sql.matchAll(/^CREATE(?: OR REPLACE)? FUNCTION\s+(\w+)/gm)];
    assert.equal(tables.length, file.startsWith('20261016') ? 2 : 1);
    assert.equal(functions.length, file.startsWith('20261016') ? 5 : 9);
    for (const [statement] of tables) assert.match(statement, /^CREATE TABLE IF NOT EXISTS /);
    for (const [statement] of functions) assert.match(statement, /^CREATE OR REPLACE FUNCTION /);
    for (const [statement] of sql.matchAll(/^ALTER TABLE\b[^;]+\bADD COLUMN\b[^;]+;/gm)) {
      assert.match(statement, /ADD COLUMN IF NOT EXISTS /);
    }
    assert.doesNotMatch(sql, /^DROP (?:TABLE|FUNCTION)\b/gm, 'preserve receipt data and function identities/permissions');
    assert.match(sql, /^BEGIN;/m);
    assert.match(sql, /COMMIT;\s*$/);
  });

  test(`${file}: missing tables can be recreated while functions remain`, () => {
    for (const match of sql.matchAll(/^CREATE TABLE IF NOT EXISTS (\w+)\b/gm)) {
      const name = match[1];
      const grant = new RegExp(`^(?:GRANT|REVOKE) [^;]*\\bON ${name}\\b`, 'm').exec(sql);
      assert.ok(grant && grant.index > match.index!, `${name}: recreate before applying table permissions`);
      assert.doesNotMatch(sql, new RegExp(`RETURNS\\s+(?:SETOF\\s+)?${name}\\b`, 'i'), 'receipt tables are not function return types');
    }
  });
}

test('activation trigger is dropped before recreation on every run', () => {
  const sql = migrations[0].sql;
  const triggers = [...sql.matchAll(/^CREATE TRIGGER (\w+)\b[^;]*? ON (\w+)\b/gm)];
  assert.equal(triggers.length, 1);
  for (const match of triggers) {
    assert.ok(sql.slice(0, match.index).includes(`DROP TRIGGER IF EXISTS ${match[1]} ON ${match[2]};`));
  }
});

test('activation owner access precedes replacement and is removed after transfer', () => {
  const sql = migrations[0].sql;
  const guard = sql.indexOf("IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='peaks-wa-catalog-publisher')");
  const createRole = sql.indexOf('CREATE ROLE "peaks-wa-catalog-publisher"');
  assert.ok(guard >= 0 && createRole > guard);
  assert.match(sql, /WA activation owner must be an isolated NOLOGIN role/);
  const membership = sql.indexOf('GRANT "peaks-wa-catalog-publisher" TO %I');
  const schema = sql.indexOf('GRANT CREATE ON SCHEMA public');
  const replace = sql.indexOf('CREATE OR REPLACE FUNCTION activate_wa_catalog_route');
  const owner = sql.indexOf('ALTER FUNCTION activate_wa_catalog_route(TEXT) OWNER TO "peaks-wa-catalog-publisher"');
  const revokeSchema = sql.indexOf('REVOKE CREATE ON SCHEMA public');
  const execute = sql.indexOf('GRANT EXECUTE ON FUNCTION activate_wa_catalog_route(TEXT) TO %I');
  const revokeMembership = sql.indexOf('REVOKE "peaks-wa-catalog-publisher" FROM %I');
  assert.ok(membership > createRole && schema > membership && replace > schema);
  assert.ok(owner > replace && revokeSchema > owner && execute > owner && revokeMembership > execute);
  assert.match(sql, /REVOKE ALL ON FUNCTION activate_wa_catalog_route\(TEXT\) FROM PUBLIC,"peaks-api"/);
});
