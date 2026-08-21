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
  assert.deepEqual(parsed.held, []);
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
    assert.ok(
      candidate.imageWidth * candidate.imageHeight <= 80_000_000,
      `${candidate.destinationName} is too large to process`
    );
    assert.ok(candidate.focalX >= 0 && candidate.focalX <= 100);
    assert.ok(candidate.focalY >= 0 && candidate.focalY <= 100);
  }
});

test("reviewed Colorado Fourteeners manifest accounts for all 53 destinations", () => {
  const manifest = parseDestinationPhotoManifest(JSON.parse(readFileSync(
    path.resolve(__dirname, "../../data/colorado-fourteener-photo-candidates.json"),
    "utf8"
  )));
  assert.equal(manifest.candidates.length, 52);
  assert.equal(new Set(manifest.candidates.map((candidate) => candidate.destinationId)).size, 52);
  assert.deepEqual(manifest.held, [{
    destinationId: "X6uF7xDeu7tJoKzmNIVE",
    destinationName: "Missouri Mountain",
    reason: "The only exact free-use Commons photo is 1024×768; higher-resolution search results were mislabeled, route graphics, or all-rights-reserved.",
  }]);
  assert.equal(manifest.candidates.length + manifest.held.length, 53);
  for (const candidate of manifest.candidates) {
    assert.ok(candidate.imageWidth >= 1600, `${candidate.destinationName} is too narrow`);
    assert.ok(candidate.imageHeight >= 900, `${candidate.destinationName} is too short`);
    assert.ok(
      candidate.imageWidth * candidate.imageHeight <= 80_000_000,
      `${candidate.destinationName} is too large to process`
    );
    assert.ok(candidate.focalX >= 0 && candidate.focalX <= 100);
    assert.ok(candidate.focalY >= 0 && candidate.focalY <= 100);
  }
});

test("manifest parser keeps holds separate from candidates", () => {
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
      candidates: [candidate],
      held: [{
        destinationId: "rainier",
        destinationName: "Mount Rainier",
        reason: "No usable source.",
      }],
    }),
    /also has a candidate/
  );
});
