import assert from "node:assert/strict";
import test from "node:test";
import { decodeTerrariumElevation } from "../lib/terrarium-elevation";

test("Terrarium decoding keeps its native 1/256-metre fraction", () => {
  assert.equal(decodeTerrariumElevation(128, 93, 133), 93 + 133 / 256);
  assert.equal(decodeTerrariumElevation(127, 255, 255), -1 / 256);
});
