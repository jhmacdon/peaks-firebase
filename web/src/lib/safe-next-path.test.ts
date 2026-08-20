import assert from "node:assert/strict";
import test from "node:test";
import { safeNextPath } from "./safe-next-path";

test("keeps local paths", () => {
  assert.equal(safeNextPath("/log"), "/log");
  assert.equal(safeNextPath("/destinations/abc?tab=reports"), "/destinations/abc?tab=reports");
  assert.equal(safeNextPath("/"), "/");
});

test("falls back when the parameter is missing or empty", () => {
  assert.equal(safeNextPath(null), "/discover");
  assert.equal(safeNextPath(""), "/discover");
});

test("rejects absolute and protocol-relative URLs", () => {
  assert.equal(safeNextPath("https://evil.example/phish"), "/discover");
  assert.equal(safeNextPath("http://evil.example"), "/discover");
  assert.equal(safeNextPath("//evil.example/phish"), "/discover");
  assert.equal(safeNextPath("/\\evil.example"), "/discover");
  assert.equal(safeNextPath("javascript:alert(1)"), "/discover");
  assert.equal(safeNextPath("evil.example/phish"), "/discover");
});

test("uses the given fallback", () => {
  assert.equal(safeNextPath("//evil.example", "/log"), "/log");
  assert.equal(safeNextPath(null, "/log"), "/log");
});
