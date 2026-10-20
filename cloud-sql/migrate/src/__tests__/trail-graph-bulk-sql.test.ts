import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const migrationDir = resolve(__dirname, '../../../migrations');
const filename = '20261018_bulk_catalog_load.sql';
const sql = readFileSync(resolve(migrationDir, filename), 'utf8');
const earlier = readdirSync(migrationDir).filter(file => file.endsWith('.sql') && file < filename).sort();
const optOut = "  IF current_setting('peaks.defer_route_derivations', true) = 'on' THEN\n    RETURN NEW;\n  END IF;\n";

/** Keep whitespace and the whole declaration, not just a list of gate names. */
function definition(source: string, name: string): string | undefined {
  const start = new RegExp(`^CREATE OR REPLACE FUNCTION ${name}\\(`, 'm').exec(source);
  if (!start) return undefined;
  const tail = source.slice(start.index);
  const bodyStart = tail.indexOf('$$');
  assert.ok(bodyStart >= 0, `${name}: dollar-quoted body`);
  const bodyEnd = tail.indexOf('$$', bodyStart + 2);
  assert.ok(bodyEnd > bodyStart, `${name}: body terminates`);
  return tail.slice(0, tail.indexOf(';', bodyEnd) + 1);
}
function latestDefinition(name: string): string {
  const latest = [...earlier].reverse().map(file => definition(readFileSync(resolve(migrationDir, file), 'utf8'), name)).find(Boolean);
  assert.ok(latest, `${name}: earlier migration exists`);
  return latest;
}
function currentDefinition(name: string): string {
  const current = definition(sql, name);
  assert.ok(current, `${name}: bulk migration defines it`);
  return current;
}

for (const name of ['refresh_route_catalog_derived_metadata', 'refresh_route_catalog_estimates',
  'refresh_route_area_links_on_path_write', 'materialize_peaks_route_elevation_profile']) {
  test(`bulk derivations: ${name} preserves the latest trigger body apart from the early opt-out`, () => {
    const current = currentDefinition(name);
    assert.equal(current.split(optOut).length, 2, 'exactly one transaction-local opt-out');
    assert.equal(current.replace(optOut, ''), latestDefinition(name));
    assert.match(current, /\$\$\nBEGIN\n  IF current_setting/);
    assert.match(sql, new RegExp(`ALTER FUNCTION ${name}\\(\\) OWNER TO postgres;`));
  });
}

test('replaced trigger and source functions retain attributes changed after their latest definitions', () => {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const names = ['refresh_route_catalog_derived_metadata', 'refresh_route_catalog_estimates',
    'refresh_route_area_links_on_path_write', 'materialize_peaks_route_elevation_profile', 'wa_catalog_valid_single_provenance'];
  const attributes: Record<string, string[]> = {};
  for (const name of names) {
    let changes: string[] = [];
    for (const file of earlier) {
      const source = readFileSync(resolve(migrationDir, file), 'utf8');
      const latest = definition(source, name);
      // The exact declaration/body comparison already covers attributes on
      // CREATE OR REPLACE. Only later ALTER FUNCTION statements need replay.
      const afterDefinition = latest ? source.slice(source.indexOf(latest) + latest.length) : source;
      if (latest) changes = [];
      for (const [statement] of afterDefinition.matchAll(new RegExp(`\\bALTER\\s+FUNCTION\\s+(?:public\\.)?${name}\\s*\\([^;]*?;`, 'gi'))) {
        if (/\)\s+OWNER\s+TO\b/i.test(statement)) continue;
        changes.push(normalize(statement));
      }
    }
    attributes[name] = changes;
    const replacement = sql.indexOf(currentDefinition(name));
    for (const change of changes) {
      assert.ok(normalize(sql.slice(replacement + currentDefinition(name).length)).includes(change),
        `${name}: restore the later attribute statement after replacing its body: ${change}`);
    }
  }
  assert.deepEqual(attributes, {
    refresh_route_catalog_derived_metadata: [],
    refresh_route_catalog_estimates: [],
    refresh_route_area_links_on_path_write: [
      'ALTER FUNCTION refresh_route_area_links_on_path_write() SECURITY DEFINER;',
      'ALTER FUNCTION refresh_route_area_links_on_path_write() SET search_path = pg_catalog, public, pg_temp;',
    ],
    materialize_peaks_route_elevation_profile: [],
    wa_catalog_valid_single_provenance: [],
  }, 'audit every later function attribute change, including config and volatility');
});

test('bulk SQL permits replay without table rewrites or guard changes', () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s'/);
  const creations = [...sql.matchAll(/^CREATE(?: OR REPLACE)? FUNCTION (\w+)\(([^)]*)\)/gm)];
  assert.ok(creations.length >= 7);
  for (const [declaration, name] of creations) {
    assert.match(declaration, /^CREATE OR REPLACE FUNCTION /);
    assert.doesNotMatch(name, /^(?:guard_|check_)/, 'never replace a guard');
  }
  assert.doesNotMatch(sql, /^(?:ALTER TABLE|CREATE TABLE|DROP (?:TABLE|FUNCTION|TRIGGER)|CREATE TRIGGER|TRUNCATE)\b/gm);
  assert.doesNotMatch(sql, /DISABLE TRIGGER|session_replication_role|defer_.*guard|ALTER ROLE|SET ROLE/i);
  assert.equal((sql.match(/current_setting\('peaks\.defer_route_derivations', true\)/g) ?? []).length, 4);
});

test('state provenance extends only the marker key list and its strict optional state check', () => {
  const previous = latestDefinition('wa_catalog_valid_single_provenance');
  const current = currentDefinition('wa_catalog_valid_single_provenance');
  const stateCheck = "      AND (NOT($1->'wa_catalog'?'state_code') OR (jsonb_typeof($1#>'{wa_catalog,state_code}')='string' AND $1#>>'{wa_catalog,state_code}' IN ('WA','OR','CA','ID')))\n";
  assert.equal(current.replace(",\'state_code\'", '').replace(stateCheck, ''), previous);
  assert.equal(current.split(stateCheck).length, 2);
  assert.match(sql, /ALTER FUNCTION wa_catalog_valid_single_provenance\(JSONB\) OWNER TO postgres/);
});

test('state activation preserves the prior owned activation body except state and ID eligibility', () => {
  const previous = latestDefinition('activate_wa_catalog_route');
  const current = currentDefinition('activate_wa_catalog_route');
  const originalGate = "  IF r.id IS NULL OR r.owner<>'peaks' OR r.state_code IS DISTINCT FROM 'WA' OR r.id NOT LIKE 'wa-%'\n";
  const stateGate = "  IF r.id IS NULL OR r.owner<>'peaks' OR NOT COALESCE(\n"
    + "      (r.state_code='WA' AND r.id LIKE 'wa-%')\n"
    + "      OR (r.state_code IN ('OR','CA','ID') AND r.id LIKE lower(r.state_code)||'-%'\n"
    + "          AND r.provenance#>>'{wa_catalog,state_code}'=r.state_code), false)\n";
  assert.equal(current.split(stateGate).length, 2);
  assert.equal(current.replace(stateGate, originalGate), previous);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION guard_/);
});

test('postgres owns all bulk functions except the retained isolated activation primitive', () => {
  const owners = [...sql.matchAll(/^ALTER FUNCTION (\w+)\([^;]+? OWNER TO ([^;]+);/gm)];
  const functions = [...sql.matchAll(/^CREATE OR REPLACE FUNCTION (\w+)\(/gm)].map(m => m[1]);
  assert.deepEqual(owners.map(m => m[1]).sort(), functions.sort());
  assert.deepEqual(owners.filter(m => m[2] !== 'postgres').map(m => [m[1], m[2]]),
    [['activate_wa_catalog_route', '"peaks-wa-catalog-publisher"']]);
  const membership = sql.indexOf('GRANT "peaks-wa-catalog-publisher" TO %I');
  const schema = sql.indexOf('GRANT CREATE ON SCHEMA public TO "peaks-wa-catalog-publisher"');
  const replace = sql.indexOf('CREATE OR REPLACE FUNCTION activate_wa_catalog_route(');
  const owner = sql.indexOf('ALTER FUNCTION activate_wa_catalog_route(TEXT) OWNER TO "peaks-wa-catalog-publisher"');
  const revokeSchema = sql.indexOf('REVOKE CREATE ON SCHEMA public FROM "peaks-wa-catalog-publisher"');
  const execute = sql.indexOf('GRANT EXECUTE ON FUNCTION activate_wa_catalog_route(TEXT) TO %I');
  const revokeMembership = sql.indexOf('REVOKE "peaks-wa-catalog-publisher" FROM %I');
  assert.ok(membership >= 0 && schema > membership && replace > schema && owner > replace);
  assert.ok(revokeSchema > owner && execute > owner && revokeMembership > execute);
  assert.match(sql, /REVOKE ALL ON FUNCTION activate_wa_catalog_route\(TEXT\) FROM PUBLIC,"peaks-api"/);
});

test('bulk refresh restores exactly the derived expressions and the profile owner condition', () => {
  const refresh = currentDefinition('refresh_route_derivations');
  for (const fragment of ['route_ids TEXT[]', 'RETURNS VOID', 'SECURITY INVOKER',
    'ORDER BY r.id FOR UPDATE', 'link_route_to_areas(candidate_route_id, true)',
    "CASE WHEN r.owner = 'peaks' THEN encode_route_elevation_profile(r.path)",
    "search_name = NULLIF(peaks_search_name(r.name), '')",
    "r.slug IS NULL AND NULLIF(peaks_search_name(r.name), '') IS NOT NULL",
    'THEN peaks_route_catalog_slug(r.name, r.id) ELSE r.slug END',
    'difficulty = peaks_route_difficulty(r.distance, r.gain, r.gain_loss,',
    'peaks_route_max_grade(r.path), r.shape)',
    'est_moving_seconds = peaks_route_est_moving_seconds(r.path, r.shape)',
    'WHERE r.id = ANY(route_ids)', "RAISE EXCEPTION 'route_ids contains a NULL or missing route'"]) {
    assert.ok(refresh.includes(fragment), fragment);
  }
  assert.equal((refresh.match(/UPDATE routes/g) ?? []).length, 1, 'one update for the whole chunk');
  assert.doesNotMatch(refresh, /SET\s+(?:path|name|owner|status)\s*=|set_config|DISABLE TRIGGER|EXCEPTION WHEN/);
  assert.ok(refresh.indexOf('link_route_to_areas') < refresh.indexOf('UPDATE routes'));
});

test('terrain difficulty preserves the bulk refresh and wraps only its effort estimate', () => {
  const terrainSql = readFileSync(resolve(migrationDir, '20261020_route_terrain_floor.sql'), 'utf8');
  const refresh = definition(terrainSql, 'refresh_route_derivations');
  assert.ok(refresh, 'terrain migration retains the bulk refresh');
  const original = currentDefinition('refresh_route_derivations');
  const effort = /difficulty = peaks_route_difficulty\(r\.distance, r\.gain, r\.gain_loss,\s*peaks_route_max_grade\(r\.path\), r\.shape\),/.exec(original);
  const floor = /difficulty = peaks_harder_difficulty\(\s*peaks_route_difficulty\(r\.distance, r\.gain, r\.gain_loss,\s*peaks_route_max_grade\(r\.path\), r\.shape\),\s*peaks_route_terrain_floor\(r\.id\)\),/.exec(refresh);
  assert.ok(effort); assert.ok(floor, 'floor combines with the same effort function after segment linking');
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  assert.equal(normalize(refresh.replace(floor[0], effort[0])), normalize(original));
});

test('bulk wrappers preserve independent route failure results and call existing guarded functions', () => {
  for (const [wrapper, primitive] of [['rebuild_route_paths', 'rebuild_route_path'], ['activate_wa_catalog_routes', 'activate_wa_catalog_route']]) {
    const body = currentDefinition(wrapper);
    assert.match(body, /RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER/);
    assert.match(body, /FOREACH candidate_route_id IN ARRAY route_ids LOOP\n    BEGIN/);
    assert.ok(body.includes(`PERFORM ${primitive}(candidate_route_id);`));
    assert.match(body, /EXCEPTION WHEN OTHERS THEN/);
    assert.match(body, /'route_id', candidate_route_id, 'success', true/);
    assert.match(body, /'route_id', candidate_route_id, 'success', false/);
    assert.match(body, /'error', SQLERRM, 'sqlstate', SQLSTATE/);
    assert.doesNotMatch(body, /UPDATE routes|INSERT INTO .*receipts|SECURITY DEFINER|set_config/);
    assert.match(sql, new RegExp(`ALTER FUNCTION ${wrapper}\\(TEXT\\[\\]\\) OWNER TO postgres;`));
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${wrapper}(TEXT[]) FROM PUBLIC, "peaks-api";`));
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION ${wrapper}(TEXT[]) TO %I`));
  }
  assert.match(currentDefinition('activate_wa_catalog_routes'), /IF cardinality\(route_ids\) > 200 THEN/);
  assert.match(currentDefinition('rebuild_route_paths'), /NOT EXISTS \(SELECT 1 FROM routes WHERE id = candidate_route_id\)/);
  assert.match(sql, /ALTER FUNCTION refresh_route_derivations\(TEXT\[\]\) OWNER TO postgres/);
});
