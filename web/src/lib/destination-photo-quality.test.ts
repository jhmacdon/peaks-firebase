import assert from "node:assert/strict";
import test from "node:test";
import { destinationPhotoDimensionError } from "./destination-photo-quality";

test("photo candidate dimensions require the cover quality bar", () => {
  assert.equal(destinationPhotoDimensionError(1600, 900), null);
  assert.equal(
    destinationPhotoDimensionError(910, 618),
    "Photo is 910×618; covers must be at least 1600×900"
  );
  assert.equal(
    destinationPhotoDimensionError(null, 900),
    "Image width must be a positive whole number"
  );
  assert.equal(
    destinationPhotoDimensionError(1600, null),
    "Image height must be a positive whole number"
  );
});
