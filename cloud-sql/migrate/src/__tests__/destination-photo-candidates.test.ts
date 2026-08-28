import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  deterministicPhotoCandidateId,
  parseDestinationPhotoManifest,
} from "../destination-photo-candidates";

test("candidate ids are stable per destination and source", () => {
  const first = deterministicPhotoCandidateId("rainier", "https://example.com/rainier");
  assert.equal(first, deterministicPhotoCandidateId("rainier", "https://example.com/rainier"));
  assert.notEqual(first, deterministicPhotoCandidateId("hood", "https://example.com/rainier"));
  assert.equal(first.length, 20);
});

test("manifest parser keeps complete source and license records", () => {
  const parsed = parseDestinationPhotoManifest({
    collection: "Cascade Volcanoes",
    researchedAt: "2026-08-21",
    candidates: [{
      destinationId: "rainier",
      destinationName: "Mount Rainier",
      imageUrl: "https://upload.wikimedia.org/rainier.jpg",
      sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Rainier.jpg",
      sourceKind: "wikimedia_commons",
      photographer: "A Photographer",
      licenseName: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      imageWidth: 4000,
      imageHeight: 2600,
      focalX: 50,
      focalY: 25,
      notes: "Clear west-face view.",
    }],
  });
  assert.equal(parsed.candidates[0].licenseName, "CC BY-SA 4.0");
  assert.equal(parsed.candidates[0].imageWidth, 4000);
  assert.equal(parsed.candidates[0].focalY, 25);
});

test("manifest parser allows alternatives but rejects a repeated source", () => {
  const candidate = {
    destinationId: "rainier",
    destinationName: "Mount Rainier",
    imageUrl: "https://upload.wikimedia.org/rainier.jpg",
    sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Rainier.jpg",
    sourceKind: "wikimedia_commons",
    photographer: "A Photographer",
    licenseName: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    imageWidth: 4000,
    imageHeight: 2600,
    focalX: 50,
    focalY: 25,
  };
  const alternatives = parseDestinationPhotoManifest({
    collection: "Cascade Volcanoes",
    researchedAt: "2026-08-21",
    candidates: [candidate, { ...candidate, sourcePageUrl: "https://example.com/other" }],
  });
  assert.equal(alternatives.candidates.length, 2);
  assert.throws(
    () => parseDestinationPhotoManifest({
      collection: "Cascade Volcanoes",
      researchedAt: "2026-08-21",
      candidates: [candidate, candidate],
    }),
    /sourcePageUrl repeats/
  );
});

test("manifest parser rejects non-HTTPS sources", () => {
  const candidate = {
    destinationId: "rainier",
    destinationName: "Mount Rainier",
    imageUrl: "https://upload.wikimedia.org/rainier.jpg",
    sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Rainier.jpg",
    sourceKind: "wikimedia_commons",
    photographer: "A Photographer",
    licenseName: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    imageWidth: 4000,
    imageHeight: 2600,
    focalX: 50,
    focalY: 25,
  };
  assert.throws(
    () => parseDestinationPhotoManifest({
      collection: "Cascade Volcanoes",
      researchedAt: "2026-08-21",
      candidates: [{ ...candidate, imageUrl: "http://example.com/rainier.jpg" }],
    }),
    /must use HTTPS/
  );
});

test("manifest parser rejects candidates below the cover quality bar", () => {
  const candidate = {
    destinationId: "rainier",
    destinationName: "Mount Rainier",
    imageUrl: "https://upload.wikimedia.org/rainier.jpg",
    sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Rainier.jpg",
    sourceKind: "wikimedia_commons",
    photographer: "A Photographer",
    licenseName: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    imageWidth: 4000,
    imageHeight: 2600,
    focalX: 50,
    focalY: 25,
  };
  for (const dimensions of [
    { imageWidth: 1599, imageHeight: 900 },
    { imageWidth: 1600, imageHeight: 899 },
  ]) {
    assert.throws(
      () => parseDestinationPhotoManifest({
        collection: "Cascade Volcanoes",
        researchedAt: "2026-08-21",
        candidates: [{ ...candidate, ...dimensions }],
      }),
      /must be at least/
    );
  }
});

test("manifest parser allows an explicit lower quality bar within the absolute floor", () => {
  const candidate = {
    destinationId: "abernathy",
    destinationName: "Abernathy Peak",
    imageUrl: "https://upload.wikimedia.org/abernathy.jpg",
    sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Abernathy.jpg",
    sourceKind: "wikimedia_commons",
    photographer: "A Photographer",
    licenseName: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    imageWidth: 900,
    imageHeight: 500,
    focalX: 50,
    focalY: 50,
  };
  const parsed = parseDestinationPhotoManifest({
    collection: "Listed mountains missing covers",
    researchedAt: "2026-08-22",
    minimumImageWidth: 900,
    minimumImageHeight: 500,
    candidates: [candidate],
  });
  assert.equal(parsed.minimumImageWidth, 900);
  assert.equal(parsed.minimumImageHeight, 500);
  assert.throws(
    () => parseDestinationPhotoManifest({
      collection: "Listed mountains missing covers",
      researchedAt: "2026-08-22",
      minimumImageWidth: 899,
      minimumImageHeight: 500,
      candidates: [candidate],
    }),
    /minimumImageWidth must be at least 900/
  );
  assert.throws(
    () => parseDestinationPhotoManifest({
      collection: "Listed mountains missing covers",
      researchedAt: "2026-08-22",
      minimumImageWidth: 900,
      minimumImageHeight: 499,
      candidates: [candidate],
    }),
    /minimumImageHeight must be at least 500/
  );
});

test("schema migration makes review final and indexed", () => {
  const migration = readFileSync(
    path.resolve(__dirname, "../../../migrations/20260821_destination_photo_review.sql"),
    "utf8"
  );
  assert.match(migration, /status IN \('pending', 'approved', 'denied'\)/);
  assert.match(migration, /status = 'approved'[\s\S]*final_image_url IS NOT NULL/);
  assert.match(migration, /UNIQUE \(destination_id, source_page_url\)/);
  assert.match(migration, /idx_destination_photo_candidates_review_queue/);
  assert.match(migration, /focal_x[\s\S]*BETWEEN 0 AND 100/);
  const framingMigration = readFileSync(
    path.resolve(__dirname, "../../../migrations/20260821_destination_photo_review_framing.sql"),
    "utf8"
  );
  assert.match(framingMigration, /hero_image_focal_x[\s\S]*BETWEEN 0 AND 100/);
  assert.match(framingMigration, /hero_image_focal_y[\s\S]*BETWEEN 0 AND 100/);
  const commentsMigration = readFileSync(
    path.resolve(__dirname, "../../../migrations/20260826_destination_photo_comments.sql"),
    "utf8"
  );
  assert.match(commentsMigration, /reviewer_comment TEXT/);
  assert.match(commentsMigration, /reviewer_comment_resolved_at TIMESTAMPTZ/);
  assert.match(commentsMigration, /idx_destination_photo_candidates_open_comments/);
  assert.match(commentsMigration, /reviewer_comment_resolved_at IS NULL/);
});

test("reviewed Cascade manifest has one usable candidate for all 20 destinations", () => {
  const manifest = parseDestinationPhotoManifest(JSON.parse(readFileSync(
    path.resolve(__dirname, "../../data/cascade-volcano-photo-candidates.json"),
    "utf8"
  )));
  assert.equal(manifest.candidates.length, 20);
  assert.equal(new Set(manifest.candidates.map((candidate) => candidate.destinationId)).size, 20);
  for (const candidate of manifest.candidates) {
    assert.ok(candidate.imageWidth >= 1600, `${candidate.destinationName} is too narrow`);
    assert.ok(candidate.imageHeight >= 900, `${candidate.destinationName} is too short`);
    assert.ok(candidate.focalX >= 0 && candidate.focalX <= 100);
    assert.ok(candidate.focalY >= 0 && candidate.focalY <= 100);
  }
});

test("reviewed state high point manifest covers the 47 destinations not already reviewed", () => {
  const manifest = parseDestinationPhotoManifest(JSON.parse(readFileSync(
    path.resolve(__dirname, "../../data/us-state-high-point-photo-candidates.json"),
    "utf8"
  )));
  assert.equal(manifest.collection, "US State High Points");
  assert.equal(manifest.candidates.length, 47);
  assert.equal(new Set(manifest.candidates.map((candidate) => candidate.destinationId)).size, 47);

  const previouslyReviewed = new Set([
    "xJywSSofd1SVJkJaGwBe", // Mount Elbert
    "Tg5URBHkVwPA1gGKKB4Q", // Mount Rainier
    "ERm0v7h6iCoEW5lLUUqF", // Mount Hood
  ]);
  for (const candidate of manifest.candidates) {
    assert.equal(candidate.sourceKind, "wikimedia_commons");
    assert.ok(!previouslyReviewed.has(candidate.destinationId));
    assert.ok(candidate.imageWidth >= 1600, `${candidate.destinationName} is too narrow`);
    assert.ok(candidate.imageHeight >= 900, `${candidate.destinationName} is too short`);
    assert.ok(candidate.focalX >= 0 && candidate.focalX <= 100);
    assert.ok(candidate.focalY >= 0 && candidate.focalY <= 100);
  }
});

test("reviewed listed-mountain manifest has one crop-safe candidate for all 929 gaps", () => {
  const manifest = parseDestinationPhotoManifest(JSON.parse(readFileSync(
    path.resolve(__dirname, "../../data/listed-mountain-photo-candidates-2026-08-22.json"),
    "utf8"
  )));
  assert.equal(manifest.collection, "Listed mountains missing covers");
  assert.equal(manifest.candidates.length, 929);
  assert.equal(new Set(manifest.candidates.map((candidate) => candidate.destinationId)).size, 929);

  for (const candidate of manifest.candidates) {
    assert.ok(candidate.imageWidth >= 900, `${candidate.destinationName} is too narrow`);
    assert.ok(candidate.imageHeight >= 500, `${candidate.destinationName} is too short`);
    assert.equal(candidate.focalX, 50);
    assert.equal(candidate.focalY, 50);
    assert.match(candidate.notes ?? "", /Center crop checked at 2:1 and 1:1\./);
  }
});
