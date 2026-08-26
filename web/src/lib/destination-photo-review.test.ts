import assert from "node:assert/strict";
import test from "node:test";
import {
  approvedDestinationPhotoFraming,
  destinationPhotoPageBounds,
  destinationPhotoQueueAfterReview,
  requestedDestinationPhotoFraming,
} from "./destination-photo-review";

test("a completed review leaves the rest of the visible queue in place", () => {
  const queue = {
    candidates: [{ id: "first" }, { id: "second" }, { id: "third" }],
    total: 15,
  };

  assert.deepEqual(destinationPhotoQueueAfterReview(queue, "second"), {
    candidates: [{ id: "first" }, { id: "third" }],
    total: 14,
  });
  assert.equal(destinationPhotoQueueAfterReview(queue, "missing"), queue);
});

test("photo review pages stay small and clamp after the queue shrinks", () => {
  assert.deepEqual(destinationPhotoPageBounds(936, 0), {
    page: 0,
    pageSize: 12,
    pageCount: 78,
    offset: 0,
  });
  assert.deepEqual(destinationPhotoPageBounds(13, 8), {
    page: 1,
    pageSize: 12,
    pageCount: 2,
    offset: 12,
  });
  assert.deepEqual(destinationPhotoPageBounds(0, 4), {
    page: 0,
    pageSize: 12,
    pageCount: 0,
    offset: 0,
  });
});

test("photo review pagination rejects unbounded inputs", () => {
  assert.throws(() => destinationPhotoPageBounds(-1, 0), /Photo total/);
  assert.throws(() => destinationPhotoPageBounds(10, -1), /Photo page/);
  assert.throws(() => destinationPhotoPageBounds(10, 0, 51), /Photo page size/);
});

test("approval sends the current slider framing without a separate save", () => {
  const requested = requestedDestinationPhotoFraming("approve", 75, 20);
  assert.deepEqual(requested, { focalX: 75, focalY: 20 });
  assert.deepEqual(
    approvedDestinationPhotoFraming(
      "approve",
      requested,
      { focalX: 50, focalY: 50 }
    ),
    { focalX: 75, focalY: 20 }
  );
});

test("approval falls back to saved framing only when no framing was sent", () => {
  assert.deepEqual(
    approvedDestinationPhotoFraming(
      "approve",
      undefined,
      { focalX: 35, focalY: 60 }
    ),
    { focalX: 35, focalY: 60 }
  );
});

test("denial never changes framing", () => {
  assert.equal(requestedDestinationPhotoFraming("deny", 75, 20), undefined);
  assert.equal(
    approvedDestinationPhotoFraming(
      "deny",
      { focalX: 75, focalY: 20 },
      { focalX: 50, focalY: 50 }
    ),
    null
  );
});
