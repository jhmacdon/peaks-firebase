import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { lookupSacScaleWays, parseSegmentSacScaleArgs, resolveSegmentSacScale,
  SAC_SCALES, segmentSacScaleBackfillMain, type SacScale } from '../segment-sac-scale-backfill';

test('grade resolution ignores untagged ways and keeps an agreed grade', () => {
  const ways = new Map<number, SacScale>([[1, 'demanding_mountain_hiking'], [2, 'demanding_mountain_hiking']]);
  assert.deepEqual(resolveSegmentSacScale([1, 2, 3, 1], ways), {
    grade: 'demanding_mountain_hiking', grades: ['demanding_mountain_hiking'], mixed: false,
  });
  assert.deepEqual(resolveSegmentSacScale([3, 4], ways), { grade: null, grades: [], mixed: false });
});

test('mixed ways use the hardest of all six official grades', () => {
  const ways = new Map(SAC_SCALES.map((grade, index) => [index + 1, grade]));
  for (let hardest = 2; hardest <= SAC_SCALES.length; hardest++) {
    const ids = Array.from({ length: hardest }, (_, index) => hardest - index);
    assert.deepEqual(resolveSegmentSacScale(ids, ways), {
      grade: SAC_SCALES[hardest - 1], grades: SAC_SCALES.slice(0, hardest), mixed: true,
    });
  }
});

test('OPL lookup reads only requested ways, decodes tags, and reports invalid grades', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'peaks-sac-scale-'));
  try {
    const extract = join(dir, 'trails.opl');
    await writeFile(extract, [
      'n1 v1 Tsac_scale=difficult_alpine_hiking x-121 y47',
      'w1 v1 Thighway=path,name=Trail%20%One,sac_scale=demanding%5f%mountain_hiking Nn1,n2',
      'w2 v1 Thighway=path,sac_scale=alpine_hiking Nn2,n3',
      'w3 v1 Thighway=path Nn3,n4',
      'w4 v1 Thighway=path,sac_scale=invalid_grade Nn4,n5',
      'w5 v1 Thighway=path,sac_scale=difficult_alpine_hiking Nn5,n6',
      'r1 v1 Troute=hiking,sac_scale=difficult_alpine_hiking Mw1@',
    ].join('\n'));
    const result = await lookupSacScaleWays(extract, new Set([1, 2, 3, 4, 99]));
    assert.deepEqual([...result.grades], [[1, 'demanding_mountain_hiking'], [2, 'alpine_hiking']]);
    assert.equal(result.foundWays, 4);
    assert.deepEqual({ ...result.invalidGrades }, { invalid_grade: 1 });
    assert.deepEqual(resolveSegmentSacScale([1, 2, 3], result.grades), {
      grade: 'alpine_hiking', grades: ['demanding_mountain_hiking', 'alpine_hiking'], mixed: true,
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('arguments require both paths and default to dry run', () => {
  const args = parseSegmentSacScaleArgs(['--extract', '/tmp/trails.opl', '--report', '/tmp/sac-report.json']);
  assert.deepEqual(args, { extract: '/tmp/trails.opl', report: '/tmp/sac-report.json', apply: false });
  assert.equal(parseSegmentSacScaleArgs(['--extract=/tmp/trails.opl', '--report=/tmp/sac-report.json', '--apply']).apply, true);
  assert.throws(() => parseSegmentSacScaleArgs(['--extract', '/tmp/trails.opl']), /Required/);
  assert.throws(() => parseSegmentSacScaleArgs(['--extract', '--apply']), /needs a path/);
  assert.throws(() => parseSegmentSacScaleArgs(['--extract=a', '--extract=b']), /only once/);
  assert.throws(() => parseSegmentSacScaleArgs(['--force']), /Unknown argument/);
});

test('an existing report stops the CLI before any database connection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'peaks-sac-scale-report-'));
  try {
    const report = join(dir, 'report.json');
    await writeFile(report, 'keep this report\n');
    await assert.rejects(segmentSacScaleBackfillMain(['--extract', join(dir, 'missing.opl'), '--report', report]),
      (error: NodeJS.ErrnoException) => error.code === 'EEXIST');
    assert.equal(await readFile(report, 'utf8'), 'keep this report\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
