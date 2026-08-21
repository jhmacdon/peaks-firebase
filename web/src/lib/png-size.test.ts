import assert from "node:assert/strict";
import test from "node:test";

import { PNG_HEADER_BYTES, readPngSize } from "./png-size";

function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(PNG_HEADER_BYTES);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8); // IHDR chunk length
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

test("reads width and height from a PNG header", () => {
  assert.deepEqual(readPngSize(pngHeader(1290, 2796)), {
    width: 1290,
    height: 2796,
  });
});

test("rejects anything that isn't a usable PNG header", () => {
  assert.equal(readPngSize(Buffer.alloc(0)), null);
  assert.equal(readPngSize(pngHeader(1290, 2796).subarray(0, 12)), null);
  assert.equal(readPngSize(Buffer.from("GIF89a not a png at all")), null);
  assert.equal(readPngSize(pngHeader(0, 2796)), null);
  assert.equal(readPngSize(pngHeader(1290, 0)), null);

  const wrongChunk = pngHeader(1290, 2796);
  wrongChunk.write("IDAT", 12, "ascii");
  assert.equal(readPngSize(wrongChunk), null);
});
