import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STATE_CODES } from '../trail-graph/state';

const migrations = resolve(__dirname, '../../../migrations');
const previous = readFileSync(resolve(migrations, '20261018_bulk_catalog_load.sql'), 'utf8');
const current = readFileSync(resolve(migrations, '20261021_us_catalog_states.sql'), 'utf8');
const allStates = STATE_CODES.map(code => `'${code}'`).join(',');
const bulkStates = STATE_CODES.filter(code => code !== 'WA').map(code => `'${code}'`).join(',');

function definition(source: string, name: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  assert.notEqual(start, -1, `${name} starts`);
  const bodyStart = source.indexOf('$$', start), bodyEnd = source.indexOf('$$', bodyStart + 2);
  assert.ok(bodyStart > start && bodyEnd > bodyStart, `${name} has a complete body`);
  return source.slice(start, source.indexOf(';', bodyEnd) + 1);
}

test('US catalog migration changes only the two state lists in current function bodies', () => {
  const oldProvenance = definition(previous, 'wa_catalog_valid_single_provenance');
  const newProvenance = definition(current, 'wa_catalog_valid_single_provenance');
  assert.equal(newProvenance.replace(allStates, "'WA','OR','CA','ID'"), oldProvenance);

  const oldActivation = definition(previous, 'activate_wa_catalog_route');
  const newActivation = definition(current, 'activate_wa_catalog_route');
  assert.equal(newActivation.replace(bulkStates, "'OR','CA','ID'"), oldActivation);
  assert.equal(STATE_CODES.length, 51);
});

test('US catalog migration keeps replay and isolated activation ownership', () => {
  assert.match(current, /^BEGIN;/m);
  assert.match(current, /COMMIT;\s*$/);
  assert.match(current, /ALTER FUNCTION wa_catalog_valid_single_provenance\(JSONB\) OWNER TO postgres/);
  const membership = current.indexOf('GRANT "peaks-wa-catalog-publisher" TO %I');
  const schema = current.indexOf('GRANT CREATE ON SCHEMA public TO "peaks-wa-catalog-publisher"');
  const replace = current.indexOf('CREATE OR REPLACE FUNCTION activate_wa_catalog_route(');
  const owner = current.indexOf('ALTER FUNCTION activate_wa_catalog_route(TEXT) OWNER TO "peaks-wa-catalog-publisher"');
  const revokeSchema = current.indexOf('REVOKE CREATE ON SCHEMA public FROM "peaks-wa-catalog-publisher"');
  const execute = current.indexOf('GRANT EXECUTE ON FUNCTION activate_wa_catalog_route(TEXT) TO %I');
  const revokeMembership = current.indexOf('REVOKE "peaks-wa-catalog-publisher" FROM %I');
  assert.ok(membership >= 0 && schema > membership && replace > schema && owner > replace);
  assert.ok(revokeSchema > owner && execute > owner && revokeMembership > execute);
  assert.match(current, /LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp/);
  assert.match(current, /REVOKE ALL ON FUNCTION activate_wa_catalog_route\(TEXT\) FROM PUBLIC,"peaks-api"/);
});
