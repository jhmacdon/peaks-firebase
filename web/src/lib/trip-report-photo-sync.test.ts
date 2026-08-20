import assert from "node:assert/strict";
import test from "node:test";

import { buildPhotoSyncPlan, photoRowToBlock } from "./trip-report-photo-sync";

const VALID_URL_A =
  "https://storage.googleapis.com/peaks-test.appspot.com/trip-reports/uid1/sess1/photo-a.jpg";
const VALID_URL_B =
  "https://storage.googleapis.com/peaks-test.appspot.com/trip-reports/uid1/sess1/photo-b.jpg";
const FOREIGN_URL = "https://images.example.com/tracker.jpg";

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

test("buildPhotoSyncPlan inserts a brand-new photo block (create path)", () => {
  withConfiguredBucket(() => {
    const plan = buildPhotoSyncPlan(
      [],
      [{ content: VALID_URL_A, caption: "Summit view" }],
      () => "generated-id-1"
    );

    assert.equal(plan.upserts.length, 1);
    assert.deepEqual(plan.upserts[0], {
      id: "generated-id-1",
      isNew: true,
      downloadUrl: VALID_URL_A,
      storagePath: "trip-reports/uid1/sess1/photo-a.jpg",
      caption: "Summit view",
      ordinal: 0,
    });
    assert.deepEqual(plan.removedIds, []);
  });
});

test("buildPhotoSyncPlan updates an existing row when the block carries its sourceId", () => {
  withConfiguredBucket(() => {
    const plan = buildPhotoSyncPlan(
      [{ id: "row-1", storagePath: "trip-reports/uid1/sess1/photo-a.jpg" }],
      [{ sourceId: "row-1", content: VALID_URL_A, caption: "Updated caption" }],
      () => "should-not-be-used"
    );

    assert.equal(plan.upserts.length, 1);
    assert.deepEqual(plan.upserts[0], {
      id: "row-1",
      isNew: false,
      downloadUrl: VALID_URL_A,
      storagePath: "trip-reports/uid1/sess1/photo-a.jpg",
      caption: "Updated caption",
      ordinal: 0,
    });
    assert.deepEqual(plan.removedIds, []);
  });
});

test("buildPhotoSyncPlan treats 'Replace photo' (same sourceId, new URL) as an update, not a new row", () => {
  withConfiguredBucket(() => {
    const plan = buildPhotoSyncPlan(
      [{ id: "row-1", storagePath: "trip-reports/uid1/sess1/photo-a.jpg" }],
      [{ sourceId: "row-1", content: VALID_URL_B }],
      () => "should-not-be-used"
    );

    assert.equal(plan.upserts.length, 1);
    assert.equal(plan.upserts[0].isNew, false);
    assert.equal(plan.upserts[0].id, "row-1");
    assert.equal(plan.upserts[0].downloadUrl, VALID_URL_B);
    assert.deepEqual(plan.removedIds, []);
  });
});

test("buildPhotoSyncPlan queues a dropped block's row for deletion", () => {
  withConfiguredBucket(() => {
    const plan = buildPhotoSyncPlan(
      [
        { id: "row-1", storagePath: "trip-reports/uid1/sess1/photo-a.jpg" },
        { id: "row-2", storagePath: "trip-reports/uid1/sess1/photo-b.jpg" },
      ],
      [{ sourceId: "row-1", content: VALID_URL_A }],
      () => "unused"
    );

    assert.equal(plan.upserts.length, 1);
    assert.deepEqual(plan.removedIds, ["row-2"]);
  });
});

test("buildPhotoSyncPlan drops a block whose URL isn't from the configured bucket", () => {
  withConfiguredBucket(() => {
    const plan = buildPhotoSyncPlan([], [{ content: FOREIGN_URL }], () => "unused");
    assert.deepEqual(plan.upserts, []);
    assert.deepEqual(plan.removedIds, []);
  });
});

test("buildPhotoSyncPlan removes the existing row when its block's URL becomes invalid", () => {
  withConfiguredBucket(() => {
    const plan = buildPhotoSyncPlan(
      [{ id: "row-1", storagePath: "trip-reports/uid1/sess1/photo-a.jpg" }],
      [{ sourceId: "row-1", content: FOREIGN_URL }],
      () => "unused"
    );
    assert.deepEqual(plan.upserts, []);
    assert.deepEqual(plan.removedIds, ["row-1"]);
  });
});

test("buildPhotoSyncPlan assigns ordinals by position among photo blocks only", () => {
  withConfiguredBucket(() => {
    const plan = buildPhotoSyncPlan(
      [],
      [{ content: VALID_URL_A }, { content: VALID_URL_B }],
      (() => {
        let n = 0;
        return () => `id-${n++}`;
      })()
    );
    assert.equal(plan.upserts[0].ordinal, 0);
    assert.equal(plan.upserts[1].ordinal, 1);
  });
});

test("buildPhotoSyncPlan returns no upserts and no removals for an empty sync", () => {
  const plan = buildPhotoSyncPlan([], [], () => "unused");
  assert.deepEqual(plan, { upserts: [], removedIds: [] });
});

test("photoRowToBlock converts a stored row back to a photo block", () => {
  assert.deepEqual(
    photoRowToBlock({
      id: "row-1",
      downloadUrl: VALID_URL_A,
      caption: "Summit view",
      createdAt: "2026-08-15T00:00:00.000Z",
    }),
    {
      type: "photo",
      content: VALID_URL_A,
      caption: "Summit view",
      sourceId: "row-1",
      createdAt: "2026-08-15T00:00:00.000Z",
    }
  );
});

test("photoRowToBlock turns a null caption/createdAt into undefined, matching TripReportBlock's optional fields", () => {
  assert.deepEqual(
    photoRowToBlock({ id: "row-1", downloadUrl: VALID_URL_A, caption: null }),
    {
      type: "photo",
      content: VALID_URL_A,
      caption: undefined,
      sourceId: "row-1",
      createdAt: undefined,
    }
  );
});

test("round trip: a new photo block survives create -> read unchanged (content/caption), gaining a sourceId", () => {
  withConfiguredBucket(() => {
    const plan = buildPhotoSyncPlan(
      [],
      [{ content: VALID_URL_A, caption: "Summit view" }],
      () => "generated-id-1"
    );
    const upsert = plan.upserts[0];

    // Simulate what INSERT + a later SELECT would hand back.
    const storedRow = {
      id: upsert.id,
      downloadUrl: upsert.downloadUrl,
      caption: upsert.caption,
    };
    const roundTripped = photoRowToBlock(storedRow);

    assert.equal(roundTripped.content, VALID_URL_A);
    assert.equal(roundTripped.caption, "Summit view");
    assert.equal(roundTripped.sourceId, "generated-id-1");
  });
});

test("round trip: editing a block loaded from a read (sourceId set) updates the same row, not a new one", () => {
  withConfiguredBucket(() => {
    // First sync: creates row "generated-id-1".
    const createPlan = buildPhotoSyncPlan(
      [],
      [{ content: VALID_URL_A, caption: "Summit view" }],
      () => "generated-id-1"
    );
    const created = createPlan.upserts[0];

    // Read it back into a block, as getTripReportForEdit would.
    const loadedBlock = photoRowToBlock({
      id: created.id,
      downloadUrl: created.downloadUrl,
      caption: created.caption,
    });

    // User edits the caption in the editor and saves again.
    const updatePlan = buildPhotoSyncPlan(
      [{ id: created.id, storagePath: created.storagePath }],
      [{ sourceId: loadedBlock.sourceId, content: loadedBlock.content, caption: "New caption" }],
      () => "should-not-be-used"
    );

    assert.equal(updatePlan.upserts.length, 1);
    assert.equal(updatePlan.upserts[0].id, created.id);
    assert.equal(updatePlan.upserts[0].isNew, false);
    assert.equal(updatePlan.upserts[0].caption, "New caption");
    assert.deepEqual(updatePlan.removedIds, []);
  });
});
