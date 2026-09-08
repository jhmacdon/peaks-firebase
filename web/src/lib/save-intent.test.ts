import assert from "node:assert/strict";
import test from "node:test";
import { parseSaveIntent } from "./save-intent";
const now = 1_800_000_000_000;
const intent = { destinationId: "rainier", returnPath: "/discover?q=Rainier&page=2", createdAt: now };
test("explicit save intent retains the chosen item and filtered return path", () => {
  assert.deepEqual(parseSaveIntent(JSON.stringify(intent), now), { destinationId: "rainier", returnPath: intent.returnPath });
});
test("save intent rejects expired, future, malformed, or external return values", () => {
  for (const value of [{ ...intent, createdAt: now - 600001 }, { ...intent, createdAt: now + 1 }, { ...intent, returnPath: "//other.site" }, { ...intent, destinationId: "../other" }]) assert.equal(parseSaveIntent(JSON.stringify(value), now), null);
  assert.equal(parseSaveIntent("broken", now), null);
});
