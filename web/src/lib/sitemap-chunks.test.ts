import assert from "node:assert/strict";
import test from "node:test";

import {
  DESTINATION_CHUNK_SIZE,
  resolveDestinationChunkCount,
} from "./sitemap-chunks";

test("resolveDestinationChunkCount keeps the successful count path", async () => {
  assert.equal(await resolveDestinationChunkCount(async () => 0), 1);
  assert.equal(
    await resolveDestinationChunkCount(async () => DESTINATION_CHUNK_SIZE * 2 + 1),
    3
  );
});

test("resolveDestinationChunkCount logs and falls back to two chunks", async () => {
  const queryError = new Error("count failed");
  const calls: Array<{ message: string; error: unknown }> = [];

  const count = await resolveDestinationChunkCount(
    async () => {
      throw queryError;
    },
    (message, error) => calls.push({ message, error })
  );

  assert.equal(count, 2);
  assert.deepEqual(calls, [
    {
      message: "[sitemap] Destination count failed; falling back to two chunks.",
      error: queryError,
    },
  ]);
});
