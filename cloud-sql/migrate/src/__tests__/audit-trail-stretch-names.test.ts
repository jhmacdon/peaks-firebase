import assert from 'node:assert/strict';
import test from 'node:test';
import { auditCatalogStretchNames, auditStretchNames, parseSnapshot, STRETCH_SNAPSHOT_SQL, type StretchRoute, type StretchRow } from '../audit-trail-stretch-names';

const segment = (ordinal: number, name: string | null, kind = 'trail', aliases: string[] = []): StretchRow => ({
  id: `s-${ordinal}`, ordinal, direction: 'forward', display_name: name, trail_names: aliases, kind, distance: 100,
});
const route = (segments: StretchRow[]): StretchRoute => ({ id: 'three-fingers', name: 'Three Fingers Lookout',
  status: 'active', state_code: 'WA', section_count: 0, segments });

test('Three Fingers flags the ice names and the repeated terrain rows', () => {
  const name = 'Three Fingers summit trail';
  const rows = [segment(0, name), segment(1, name, 'glacier'), segment(2, name), segment(3, name, 'glacier'), segment(4, name, 'glacier'), segment(5, 'Summit block and ladders', 'scramble')];
  const findings = auditStretchNames(route(rows));
  assert.equal(findings.filter(f => f.code === 'ice_named_as_trail').length, 3);
  const repeated = findings.find(f => f.code === 'name_repeated_across_kinds')!;
  assert.deepEqual(repeated.ordinals, [0, 1, 2, 3, 4]);
  assert.deepEqual(repeated.kinds, ['trail', 'glacier', 'trail', 'glacier', 'glacier']);
});

test('source splits and later returns to a trail are not duplicate findings', () => {
  assert.deepEqual(auditStretchNames(route([
    segment(0, 'Main Trail'), segment(1, 'Main Trail'), segment(2, 'Branch Trail'),
    { ...segment(3, 'Main Trail'), id: 's-0', direction: 'reverse' },
  ])), []);
  assert.deepEqual(auditStretchNames(route([segment(0, 'Main Trail'), segment(1, null), segment(2, 'Main Trail', 'scramble')])), []);
});

test('known and unnamed ice crossings keep distinct terrain rows', () => {
  assert.deepEqual(auditStretchNames(route([segment(0, 'Approach Trail'), segment(1, 'Cowlitz Glacier', 'glacier'),
    segment(2, 'Glacier crossing', 'glacier'), segment(3, 'Muir Snowfield', 'snowfield')])), []);
  assert.deepEqual(auditStretchNames(route([segment(0, null, 'glacier')])).map(f => f.code), ['unnamed_ice']);
  assert.deepEqual(auditStretchNames(route([segment(0, 'Mountain Approach', 'glacier', ['Mountain Approach'])])).map(f => f.code), ['ice_uses_path_name']);
  assert.deepEqual(auditStretchNames(route([segment(0, 'Cowlitz Glacier', 'glacier', ['Cowlitz Glacier'])])), []);
});

test('adjacent case variants and shared aliases need review; same kind alone is insufficient', () => {
  const rows = [segment(0, 'Summit Trail'), segment(1, 'summit  trail'),
    segment(2, 'Three Fingers/ Saddle Lake', 'trail', ['Trail #641']),
    segment(3, 'Three Fingers-Goat Flats-Saddle Lake Trail #641', 'trail', ['Trail #641']),
    segment(4, 'Different Trail')];
  assert.deepEqual(auditStretchNames(route(rows)).map(f => f.code), ['adjacent_name_variants', 'adjacent_trail_aliases']);
});

test('coverage gaps remain visible, including routes whose sections replace segments', () => {
  const empty = route([]), missing = { ...route([{ ...segment(0, null), kind: null }]), id: 'missing' };
  const report = auditCatalogStretchNames([{ ...empty, section_count: 8 }, missing]);
  assert.equal(report.summary.routes, 2);
  assert.equal(report.summary.routes_with_findings, 2);
  assert.deepEqual(report.summary.findings_by_code, { missing_segments: 1, missing_segment: 1 });
  assert.equal(report.findings[0].section_count, 8);
  assert.throws(() => auditCatalogStretchNames([empty, empty]), /Duplicate snapshot route/);
});

test('snapshot rejects malformed or duplicated links instead of silently skipping them', () => {
  const r = route([segment(0, 'Trail')]);
  assert.deepEqual(parseSnapshot(JSON.stringify(r) + '\n'), [r]);
  assert.throws(() => parseSnapshot(JSON.stringify({ ...r, status: 'superseded' })), /Invalid route/);
  assert.throws(() => parseSnapshot(JSON.stringify({ ...r, segments: [r.segments[0], r.segments[0]] })), /Invalid segment/);
  assert.throws(() => parseSnapshot(JSON.stringify({ ...r, segments: [{ ...r.segments[0], trail_names: [null] }] })), /Invalid segment/);
  assert.match(STRETCH_SNAPSHOT_SQL, /REPEATABLE READ READ ONLY/);
  assert.match(STRETCH_SNAPSHOT_SQL, /owner = 'peaks' AND status IN \('active', 'pending'\)/);
});

test('flat database snapshot assembles every link without database JSON aggregation', () => {
  const r = route([]), s = segment(0, 'Approach Trail');
  const text = [JSON.stringify(r), JSON.stringify({ record: 'segment', route_id: r.id, ...s })].join('\n');
  assert.deepEqual(parseSnapshot(text), [{ ...r, segments: [s] }]);
  assert.throws(() => parseSnapshot(JSON.stringify({ record: 'segment', route_id: 'absent', ...s })), /Segment without route/);
});
