import assert from "node:assert/strict";
import test from "node:test";
import {
  approvedDestinationPhotoFraming,
  requestedDestinationPhotoFraming,
} from "./destination-photo-review";

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
