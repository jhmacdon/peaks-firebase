import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  assertRemoteImageUrl,
  renderDestinationPhoto,
} from "./destination-photo-storage";

test("destination cover sources require a public HTTPS host", () => {
  assert.equal(
    assertRemoteImageUrl("https://upload.wikimedia.org/photo.jpg").hostname,
    "upload.wikimedia.org"
  );

  for (const url of [
    "http://upload.wikimedia.org/photo.jpg",
    "https://localhost/photo.jpg",
    "https://metadata.google.internal/photo.jpg",
    "https://127.0.0.1/photo.jpg",
    "https://10.0.0.1/photo.jpg",
    "https://169.254.169.254/photo.jpg",
    "https://[::1]/photo.jpg",
    "https://[::ffff:10.0.0.1]/photo.jpg",
    "https://[fd00::1]/photo.jpg",
  ]) {
    assert.throws(() => assertRemoteImageUrl(url), /HTTPS|public host/, url);
  }
});

test("destination cover renderer keeps the flexible master image", async () => {
  const input = Buffer.from(`
    <svg width="2000" height="1600" xmlns="http://www.w3.org/2000/svg">
      <rect width="2000" height="600" y="0" fill="#ff0000"/>
      <rect width="2000" height="400" y="600" fill="#00ff00"/>
      <rect width="2000" height="600" y="1000" fill="#0000ff"/>
    </svg>`);
  const rendered = await renderDestinationPhoto(input);
  assert.deepEqual([rendered.width, rendered.height], [2000, 1600]);

  const topPixel = await sharp(rendered.data).extract({ left: 10, top: 10, width: 1, height: 1 }).raw().toBuffer();
  const bottomPixel = await sharp(rendered.data).extract({ left: 10, top: 1590, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(topPixel[0] > 240 && topPixel[1] < 20, "top framing should keep the red edge");
  assert.ok(bottomPixel[2] > 240 && bottomPixel[0] < 20, "master should keep the blue edge");
});

test("destination cover renderer caps the longest edge at 2400 pixels", async () => {
  const input = Buffer.from(`
    <svg width="4000" height="2000" xmlns="http://www.w3.org/2000/svg">
      <rect width="4000" height="2000" fill="#445566"/>
    </svg>`);
  const rendered = await renderDestinationPhoto(input);
  assert.deepEqual([rendered.width, rendered.height], [2400, 1200]);
});
