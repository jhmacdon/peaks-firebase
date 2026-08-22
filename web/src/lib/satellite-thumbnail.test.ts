import { strict as assert } from "node:assert";
import { test } from "node:test";
import { satelliteThumbnailUrl } from "./satellite-thumbnail";

test("satellite thumbnail is centred on a valid destination", () => {
  const value = satelliteThumbnailUrl(47.5102, -121.9821);
  assert.ok(value);

  const url = new URL(value);
  assert.equal(
    url.origin + url.pathname,
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export"
  );
  assert.equal(url.searchParams.get("bboxSR"), "4326");
  assert.equal(url.searchParams.get("size"), "96,96");
  assert.equal(url.searchParams.get("format"), "jpg");
  assert.equal(url.searchParams.get("f"), "image");

  const [minLng, minLat, maxLng, maxLat] = url.searchParams
    .get("bbox")!
    .split(",")
    .map(Number);
  assert.ok(Math.abs((minLng + maxLng) / 2 + 121.9821) < 0.000001);
  assert.ok(Math.abs((minLat + maxLat) / 2 - 47.5102) < 0.000001);
});

test("satellite thumbnail rejects missing or unmappable coordinates", () => {
  assert.equal(satelliteThumbnailUrl(null, -121), null);
  assert.equal(satelliteThumbnailUrl(47, null), null);
  assert.equal(satelliteThumbnailUrl(Number.NaN, -121), null);
  assert.equal(satelliteThumbnailUrl(86, -121), null);
  assert.equal(satelliteThumbnailUrl(47, 181), null);
});
