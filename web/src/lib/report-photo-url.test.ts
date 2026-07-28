import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReportPhotoUrl } from "./report-photo-url";

function withConfiguredBucket<T>(run: () => T): T {
  const previous = process.env.FIREBASE_STORAGE_BUCKET;
  process.env.FIREBASE_STORAGE_BUCKET = "peaks-test.appspot.com";
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.FIREBASE_STORAGE_BUCKET;
    } else {
      process.env.FIREBASE_STORAGE_BUCKET = previous;
    }
  }
}

test("accepts supported URLs from the configured Firebase Storage bucket", () => {
  withConfiguredBucket(() => {
    const urls = [
      "https://firebasestorage.googleapis.com/v0/b/peaks-test.appspot.com/o/reports%2Fone.jpg?alt=media",
      "https://storage.googleapis.com/download/storage/v1/b/peaks-test.appspot.com/o/reports%2Ftwo.jpg?alt=media",
      "https://storage.googleapis.com/peaks-test.appspot.com/reports/three.jpg",
    ];

    for (const url of urls) {
      assert.equal(normalizeReportPhotoUrl(url), url);
    }
  });
});

test("rejects photo URLs that could track viewers or escape the configured bucket", () => {
  withConfiguredBucket(() => {
    const urls = [
      "https://images.example.com/tracker.jpg",
      "https://firebasestorage.googleapis.com/v0/b/other.appspot.com/o/reports%2Fone.jpg",
      "http://storage.googleapis.com/peaks-test.appspot.com/reports/one.jpg",
      "https://user:secret@storage.googleapis.com/peaks-test.appspot.com/reports/one.jpg",
      "https://storage.googleapis.com:444/peaks-test.appspot.com/reports/one.jpg",
      "https://firebasestorage.googleapis.com.evil.example/v0/b/peaks-test.appspot.com/o/one.jpg",
    ];

    for (const url of urls) {
      assert.equal(normalizeReportPhotoUrl(url), null);
    }
  });
});

test("rejects all photo URLs when no valid storage bucket is configured", () => {
  const previousBucket = process.env.FIREBASE_STORAGE_BUCKET;
  const previousPublicBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const previousConfig = process.env.FIREBASE_WEBAPP_CONFIG;
  const previousPublicConfig = process.env.NEXT_PUBLIC_FIREBASE_WEBAPP_CONFIG;

  delete process.env.FIREBASE_STORAGE_BUCKET;
  delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  delete process.env.FIREBASE_WEBAPP_CONFIG;
  delete process.env.NEXT_PUBLIC_FIREBASE_WEBAPP_CONFIG;
  try {
    assert.equal(
      normalizeReportPhotoUrl(
        "https://storage.googleapis.com/peaks-test.appspot.com/reports/one.jpg"
      ),
      null
    );
  } finally {
    if (previousBucket !== undefined) {
      process.env.FIREBASE_STORAGE_BUCKET = previousBucket;
    }
    if (previousPublicBucket !== undefined) {
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = previousPublicBucket;
    }
    if (previousConfig !== undefined) {
      process.env.FIREBASE_WEBAPP_CONFIG = previousConfig;
    }
    if (previousPublicConfig !== undefined) {
      process.env.NEXT_PUBLIC_FIREBASE_WEBAPP_CONFIG = previousPublicConfig;
    }
  }
});
