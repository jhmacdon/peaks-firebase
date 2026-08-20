// Intrinsic size of a PNG, read straight from its header.
//
// The landing page frames whatever app screenshots exist under
// web/public/app, and next/image needs real width/height for a local file it
// doesn't statically import. A PNG always opens with the 8-byte signature and
// an IHDR chunk whose first two fields are width and height, so the first 24
// bytes answer the question — no image library, no decode.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_OFFSET = 16;
export const PNG_HEADER_BYTES = 24;

export interface PngSize {
  width: number;
  height: number;
}

/** Returns null for anything that isn't a PNG header, or one claiming a
 * zero dimension — callers skip the file rather than render a broken frame. */
export function readPngSize(header: Buffer): PngSize | null {
  if (header.length < PNG_HEADER_BYTES) return null;
  if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return null;
  if (header.subarray(12, 16).toString("ascii") !== "IHDR") return null;

  const width = header.readUInt32BE(IHDR_OFFSET);
  const height = header.readUInt32BE(IHDR_OFFSET + 4);
  if (width === 0 || height === 0) return null;

  return { width, height };
}
