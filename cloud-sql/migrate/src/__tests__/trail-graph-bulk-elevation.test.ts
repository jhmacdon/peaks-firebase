import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { sampleBulkSegments } from '../trail-graph/bulk-elevation';
import type { Segment } from '../trail-graph/types';

function segment(id: string, lng = 0): Segment {
  return { id, coords: [[lng, 0], [lng, 0]] } as Segment;
}

async function tile(red = 128, green = 100, blue = 128): Promise<Uint8Array> {
  return new Uint8Array(await sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: red, g: green, b: blue } },
  }).png().toBuffer());
}

async function withCache(run: (cacheDir: string) => Promise<void>): Promise<void> {
  const cacheDir = await mkdtemp(join(tmpdir(), 'peaks-bulk-elevation-'));
  try { await run(cacheDir); }
  finally { await rm(cacheDir, { recursive: true, force: true }); }
}

test('bulk elevation deduplicates shared tiles and uses at most eight workers', async () => {
  await withCache(async cacheDir => {
    const bytes = await tile();
    const rows = Array.from({ length: 20 }, (_, i) => segment(`segment-${i}`, i * 0.03));
    rows.push(segment('shared-tile', 0.001), rows[0]);
    const urls: string[] = [];
    let active = 0;
    let maxActive = 0;
    const profiles = await sampleBulkSegments(rows, {
      cacheDir,
      fetcher: async input => {
        urls.push(String(input));
        maxActive = Math.max(maxActive, ++active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        return new Response(new Uint8Array(bytes), { status: 200 });
      },
    });
    assert.equal(profiles.size, 21);
    assert.deepEqual(profiles.get('segment-0'), [[0, 0, 100.5], [0, 0, 100.5]]);
    assert.deepEqual(profiles.get('shared-tile'), [[0.001, 0, 100.5], [0.001, 0, 100.5]]);
    assert.equal(urls.length, 20);
    assert.equal(new Set(urls).size, 20);
    assert.ok(maxActive > 1);
    assert.ok(maxActive <= 8, `saw ${maxActive} simultaneous requests`);
    await sampleBulkSegments(rows, {
      cacheDir,
      fetcher: async () => { throw new Error('batch cache was not reused'); },
    });
  });
});

test('bulk elevation honours a smaller concurrency limit', async () => {
  await withCache(async cacheDir => {
    const bytes = await tile();
    let active = 0;
    let maxActive = 0;
    await sampleBulkSegments(Array.from({ length: 5 }, (_, i) => segment(`segment-${i}`, i)), {
      cacheDir,
      concurrency: 2,
      fetcher: async () => {
        maxActive = Math.max(maxActive, ++active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        return new Response(new Uint8Array(bytes), { status: 200 });
      },
    });
    assert.equal(maxActive, 2);
  });
});

test('frozen segments keep exact XYZ without fetching or resampling', async () => {
  const row = segment('frozen');
  row.frozen_catalog = { route_ids: ['existing'], coords_xyz: [[0, 0, 101.125], [0, 0, 103.625]] };
  const profiles = await sampleBulkSegments([row], {
    cacheDir: 'unused',
    fetcher: async () => { throw new Error('frozen assets must not fetch tiles'); },
  });
  assert.equal(profiles.get(row.id), row.frozen_catalog.coords_xyz);
});

test('bulk elevation rejects frozen partials, altered XY, missing, zero and nonfinite XYZ', async () => {
  for (const xyz of [
    [[0, 0, 1]],
    [[0.001, 0, 1], [0, 0, 2]],
    [[0, 0, 0], [0, 0, 2]],
    [[0, 0, Number.NaN], [0, 0, 2]],
    [[0, 0, Number.POSITIVE_INFINITY], [0, 0, 2]],
  ]) {
    const row = segment('invalid-frozen');
    row.frozen_catalog = { route_ids: ['existing'], coords_xyz: xyz };
    await assert.rejects(sampleBulkSegments([row], { cacheDir: 'unused' }), /exact XYZ/);
  }
  const partial = segment('partial');
  partial.frozen_partial = { segment_id: 'existing', from_vertex: 0, to_vertex: 1 };
  await assert.rejects(sampleBulkSegments([partial], { cacheDir: 'unused' }), /review-only/);
});

test('bulk elevation rejects a whole batch when a sampled profile is zero or out of range', async () => {
  for (const [red, green] of [[128, 0], [166, 0], [0, 0]]) {
    await withCache(async cacheDir => {
      const bytes = await tile(red, green, 0);
      await assert.rejects(sampleBulkSegments([segment('invalid-sample')], {
        cacheDir, fetcher: async () => new Response(new Uint8Array(bytes), { status: 200 }),
      }), /invalid bulk elevation profile/);
    });
  }
});

test('bulk elevation returns no partial result after a tile failure', async () => {
  await withCache(async cacheDir => {
    const bytes = await tile();
    await assert.rejects(sampleBulkSegments([segment('first'), segment('missing', 1)], {
      cacheDir,
      fetcher: async input => String(input).includes('/8192/')
        ? new Response(new Uint8Array(bytes), { status: 200 })
        : new Response('missing', { status: 404 }),
    }), /tile request failed/);
  });
});

test('bulk elevation validates geometry and concurrency before fetching', async () => {
  await withCache(async cacheDir => {
    const fetcher: typeof fetch = async () => { throw new Error('must validate first'); };
    await assert.rejects(sampleBulkSegments([segment('same'), segment('same', 1)], { cacheDir, fetcher }), /Conflicting/);
    const incomplete = segment('incomplete');
    incomplete.coords = [[0, 0]];
    await assert.rejects(sampleBulkSegments([incomplete], { cacheDir, fetcher }), /invalid elevation profile/);
    for (const concurrency of [0, 1.5, 9, Number.NaN]) {
      await assert.rejects(sampleBulkSegments([segment('valid')], { cacheDir, fetcher, concurrency }), /concurrency/);
    }
    assert.equal((await sampleBulkSegments([], { cacheDir, fetcher })).size, 0);
  });
});
