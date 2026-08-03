import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { sampleTerrariumProfile } from "../lib/terrarium-route-profile";

async function tileWithPixel(
  red: number,
  green: number,
  blue: number,
  pixelX = 0,
  pixelY = 0
): Promise<Buffer> {
  const data = Buffer.alloc(256 * 256 * 3);
  const offset = (pixelY * 256 + pixelX) * 3;
  data[offset] = red;
  data[offset + 1] = green;
  data[offset + 2] = blue;
  return sharp(data, { raw: { width: 256, height: 256, channels: 3 } })
    .png()
    .toBuffer();
}

test("samples z14 Terrarium pixels with the required URL and Peaks user agent", async () => {
  const bytes = await tileWithPixel(128, 1, 128);
  const requests: Array<{ url: string; userAgent: string | null }> = [];
  const elevation = await sampleTerrariumProfile([{ lat: 0, lng: 0 } , { lat: 0, lng: 0 }], {
    fetcher: async (input, init) => {
      requests.push({
        url: String(input),
        userAgent: new Headers(init?.headers).get("user-agent"),
      });
      return new Response(new Uint8Array(bytes), { status: 200 });
    },
  });

  assert.deepEqual(elevation, [1.5, 1.5]);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]?.url,
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/8192/8192.png"
  );
  assert.match(requests[0]?.userAgent ?? "", /Peaks/i);
});

test("uses exact Web Mercator pixels, batches tile requests, and persists decoded tiles", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "terrarium-route-profile-"));
  let calls = 0;
  try {
    const bytes = await tileWithPixel(128, 2, 64);
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 },
    ];
    const fetcher = async () => {
      calls += 1;
      return new Response(new Uint8Array(bytes), { status: 200 });
    };
    assert.deepEqual(
      await sampleTerrariumProfile(points, { cacheDir, fetcher }),
      [2.25, 2.25]
    );
    assert.equal(calls, 1);
    assert.deepEqual(
      await sampleTerrariumProfile(points, {
        cacheDir,
        fetcher: async () => {
          throw new Error("cache was not reused");
        },
      }),
      [2.25, 2.25]
    );
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("rejects partial tile failures and invalid route points before returning samples", async () => {
  await assert.rejects(
    sampleTerrariumProfile([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }], {
      fetcher: async () => new Response("missing", { status: 404 }),
    }),
    /tile|sample/i
  );
  for (const points of [
    [],
    [{ lat: 0, lng: 0 }],
    [{ lat: 86, lng: 0 }, { lat: 0, lng: 0 }],
    [{ lat: 0, lng: Number.NaN }, { lat: 0, lng: 0 }],
  ]) {
    await assert.rejects(sampleTerrariumProfile(points), /two|finite|Mercator/i);
  }
});
