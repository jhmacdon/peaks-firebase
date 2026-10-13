import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CandidateRejection, sha256 } from "./graph";

export function readHashedJson(path: string, expectedHash: string, baseDir: string): { value: unknown; body: string } {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new CandidateRejection("invalid_snapshot_hash");
  const bytes = readFileSync(resolve(baseDir, path));
  if (bytes.length > 25_000_000) throw new CandidateRejection("snapshot_too_large");
  if (sha256(bytes) !== expectedHash) throw new CandidateRejection("snapshot_hash_mismatch", path);
  return { value: JSON.parse(bytes.toString("utf8")), body: bytes.toString("utf8") };
}
