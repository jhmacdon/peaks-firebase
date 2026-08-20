import assert from "node:assert/strict";
import test from "node:test";

import {
  AVATAR_UPLOAD_LIMITS,
  REPORT_PHOTO_UPLOAD_LIMITS,
  computeDownscaleDimensions,
  resolvedMimeType,
  validateImageFile,
} from "./image-upload";

test("validateImageFile accepts a file within the given limits", () => {
  const result = validateImageFile(
    { type: "image/jpeg", size: 1024 },
    AVATAR_UPLOAD_LIMITS
  );
  assert.deepEqual(result, { ok: true });
});

test("validateImageFile rejects a MIME type outside the accepted list", () => {
  const result = validateImageFile(
    { type: "image/gif", size: 1024 },
    AVATAR_UPLOAD_LIMITS
  );
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /JPG or PNG/);
});

test("validateImageFile enforces the avatar 5MB cap, not the report 10MB cap", () => {
  const sixMb = 6 * 1024 * 1024;
  assert.equal(
    validateImageFile({ type: "image/png", size: sixMb }, AVATAR_UPLOAD_LIMITS).ok,
    false
  );
  assert.equal(
    validateImageFile({ type: "image/png", size: sixMb }, REPORT_PHOTO_UPLOAD_LIMITS)
      .ok,
    true
  );
});

test("validateImageFile rejects a file right over the byte cap and accepts one at it", () => {
  const max = REPORT_PHOTO_UPLOAD_LIMITS.maxBytes;
  assert.equal(
    validateImageFile({ type: "image/webp", size: max }, REPORT_PHOTO_UPLOAD_LIMITS)
      .ok,
    true
  );
  assert.equal(
    validateImageFile({ type: "image/webp", size: max + 1 }, REPORT_PHOTO_UPLOAD_LIMITS)
      .ok,
    false
  );
});

test("validateImageFile rejects an empty (0-byte) file", () => {
  const result = validateImageFile(
    { type: "image/jpeg", size: 0 },
    REPORT_PHOTO_UPLOAD_LIMITS
  );
  assert.equal(result.ok, false);
});

test("validateImageFile accepts HEIC for report photos but not avatars", () => {
  assert.equal(
    validateImageFile({ type: "image/heic", size: 1024 }, REPORT_PHOTO_UPLOAD_LIMITS)
      .ok,
    true
  );
  assert.equal(
    validateImageFile({ type: "image/heic", size: 1024 }, AVATAR_UPLOAD_LIMITS).ok,
    false
  );
});

test("resolvedMimeType falls back to the .heic/.heif extension when type is blank", () => {
  assert.equal(resolvedMimeType({ type: "", size: 1, name: "IMG_0001.HEIC" }), "image/heic");
  assert.equal(resolvedMimeType({ type: "", size: 1, name: "photo.heif" }), "image/heic");
  assert.equal(resolvedMimeType({ type: "", size: 1, name: "photo.jpg" }), "");
});

test("resolvedMimeType prefers the browser-reported type and lowercases it", () => {
  assert.equal(
    resolvedMimeType({ type: "IMAGE/JPEG", size: 1, name: "photo.heic" }),
    "image/jpeg"
  );
});

test("a HEIC file with a blank type only validates once the extension fallback applies", () => {
  const noName = validateImageFile({ type: "", size: 1024 }, REPORT_PHOTO_UPLOAD_LIMITS);
  assert.equal(noName.ok, false);

  const withHeicName = validateImageFile(
    { type: "", size: 1024, name: "IMG_1234.HEIC" },
    REPORT_PHOTO_UPLOAD_LIMITS
  );
  assert.equal(withHeicName.ok, true);
});

test("computeDownscaleDimensions leaves an image already within the cap untouched", () => {
  const result = computeDownscaleDimensions(1200, 800, 2048);
  assert.deepEqual(result, { width: 1200, height: 800, scaled: false });
});

test("computeDownscaleDimensions treats an image exactly at the cap as untouched", () => {
  const result = computeDownscaleDimensions(2048, 1024, 2048);
  assert.equal(result.scaled, false);
});

test("computeDownscaleDimensions shrinks the longest edge to the cap and preserves aspect ratio", () => {
  const result = computeDownscaleDimensions(4096, 2048, 2048);
  assert.deepEqual(result, { width: 2048, height: 1024, scaled: true });
});

test("computeDownscaleDimensions handles a portrait image", () => {
  const result = computeDownscaleDimensions(3000, 6000, 2048);
  assert.equal(result.scaled, true);
  assert.equal(result.height, 2048);
  assert.equal(result.width, 1024);
});

test("computeDownscaleDimensions never rounds a dimension down to 0", () => {
  const result = computeDownscaleDimensions(100000, 1, 2048);
  assert.equal(result.scaled, true);
  assert.ok(result.height >= 1);
});

test("computeDownscaleDimensions is a no-op for invalid input", () => {
  assert.deepEqual(computeDownscaleDimensions(0, 800, 2048), {
    width: 0,
    height: 800,
    scaled: false,
  });
  assert.deepEqual(computeDownscaleDimensions(NaN, 800, 2048), {
    width: NaN,
    height: 800,
    scaled: false,
  });
});
