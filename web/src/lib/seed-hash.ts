// A stable string → number hash, so a page whose identity is a URL slug
// ("washington", "peak-bagging") can still hand ContourArt a numeric seed
// (lib/contour-rings.ts) without maintaining a hand-picked number per page.
// FNV-1a: small, pure, and well-distributed enough that two nearby slugs
// ("colorado" / "colorado-springs" isn't a real case here, but state names
// and activity names are all short strings) don't draw visually similar
// peaks. The generator's no-crossing invariant is fuzz-tested against any
// uint32, so nothing here needs to constrain the output range further.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function hashSeed(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}
