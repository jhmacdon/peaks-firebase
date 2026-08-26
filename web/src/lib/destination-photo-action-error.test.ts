import assert from "node:assert/strict";
import test from "node:test";
import { destinationPhotoActionErrorMessage } from "./destination-photo-action-error";
import { DestinationPhotoSourceError } from "./destination-photo-storage";

test("photo actions return safe source errors to the reviewer", () => {
  assert.equal(
    destinationPhotoActionErrorMessage(
      new DestinationPhotoSourceError("Photo download failed with HTTP 404"),
      "Could not review this photo. Try again."
    ),
    "Photo download failed with HTTP 404"
  );
});

test("photo actions hide unexpected server errors", () => {
  assert.equal(
    destinationPhotoActionErrorMessage(
      new Error("database password leaked"),
      "Could not review this photo. Try again."
    ),
    "Could not review this photo. Try again."
  );
});
