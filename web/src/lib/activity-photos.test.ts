import assert from "node:assert/strict";
import test from "node:test";
import { selectActivityPhotos } from "./activity-photos";

test("a recent outing keeps an even spread rather than only its newest photos", () => {
  const photos = ["start", "forest", "ridge", "summit", "descent", "finish"];
  assert.deepEqual(selectActivityPhotos(photos), ["start", "summit", "finish"]);
  assert.deepEqual(photos, ["start", "forest", "ridge", "summit", "descent", "finish"]);
});

test("short photo groups and a one-photo limit keep their available context", () => {
  assert.deepEqual(selectActivityPhotos([]), []);
  assert.deepEqual(selectActivityPhotos(["start", "finish"]), ["start", "finish"]);
  assert.deepEqual(selectActivityPhotos(["start", "finish"], 1), ["start"]);
  assert.deepEqual(selectActivityPhotos(["start"], 0), []);
});
