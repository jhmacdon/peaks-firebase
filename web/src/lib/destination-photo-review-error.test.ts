import assert from "node:assert/strict";
import test from "node:test";
import { DestinationPhotoSourceError } from "./destination-photo-storage";
import { destinationPhotoReviewErrorMessage } from "./destination-photo-review-error";

test("photo review returns safe source errors to the reviewer", () => {
  assert.equal(
    destinationPhotoReviewErrorMessage(
      new DestinationPhotoSourceError("Photo download failed with HTTP 404")
    ),
    "Photo download failed with HTTP 404"
  );
});

test("photo review hides unexpected server errors", () => {
  assert.equal(
    destinationPhotoReviewErrorMessage(new Error("database password leaked")),
    "Could not review this photo. Try again."
  );
});
