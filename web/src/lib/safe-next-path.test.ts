import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_NEXT_PATH, safeNextPath } from "./safe-next-path";

test("safeNextPath honors a valid internal path", () => {
  assert.equal(safeNextPath("/plans/abc123"), "/plans/abc123");
});

test("safeNextPath rejects a protocol-relative path", () => {
  assert.equal(safeNextPath("//evil.com"), DEFAULT_NEXT_PATH);
});

test("safeNextPath rejects an absolute URL", () => {
  assert.equal(safeNextPath("https://evil.com"), DEFAULT_NEXT_PATH);
});

test("safeNextPath falls back on an empty string", () => {
  assert.equal(safeNextPath(""), DEFAULT_NEXT_PATH);
});

test("safeNextPath falls back when the param is missing", () => {
  assert.equal(safeNextPath(null), DEFAULT_NEXT_PATH);
  assert.equal(safeNextPath(undefined), DEFAULT_NEXT_PATH);
});

test("safeNextPath accepts a custom fallback", () => {
  assert.equal(safeNextPath("//evil.com", "/home"), "/home");
});
