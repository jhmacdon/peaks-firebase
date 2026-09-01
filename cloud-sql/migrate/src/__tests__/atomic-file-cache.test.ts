import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeAtomicCacheFile } from "../atomic-file-cache";

test("concurrent cache writers expose only complete files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "peaks-cache-"));
  const target = path.join(directory, "tiles", "shared.bin");
  const first = Buffer.alloc(64 * 1024, 0x2a);
  const second = Buffer.alloc(96 * 1024, 0xc7);
  try {
    await writeAtomicCacheFile(target, first);
    let reading = true;
    const observations: Buffer[] = [];
    const reader = (async () => {
      while (reading) {
        observations.push(await readFile(target));
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
    await Promise.all(
      Array.from({ length: 80 }, (_, index) =>
        writeAtomicCacheFile(target, index % 2 === 0 ? first : second)
      )
    );
    reading = false;
    await reader;
    observations.push(await readFile(target));
    assert.ok(observations.length > 0);
    for (const value of observations) {
      assert.ok(
        value.equals(first) || value.equals(second),
        "reader observed a partial or mixed cache file"
      );
    }
    const remaining = await readdir(path.dirname(target));
    assert.deepEqual(remaining, ["shared.bin"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
