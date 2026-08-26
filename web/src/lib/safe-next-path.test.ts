import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_NEXT_PATH, safeNextPath } from "./safe-next-path";

test("safeNextPath honors a valid internal path", () => {
  assert.equal(safeNextPath("/my-routes/abc123"), "/my-routes/abc123");
  assert.equal(safeNextPath("/log"), "/log");
  assert.equal(safeNextPath("/"), "/");
});

test("safeNextPath keeps a query string on an internal path", () => {
  assert.equal(
    safeNextPath("/destinations/abc?tab=reports"),
    "/destinations/abc?tab=reports"
  );
});

test("safeNextPath rejects a protocol-relative path", () => {
  assert.equal(safeNextPath("//evil.com"), DEFAULT_NEXT_PATH);
  assert.equal(safeNextPath("//evil.example/phish"), DEFAULT_NEXT_PATH);
});

test("safeNextPath rejects an absolute URL", () => {
  assert.equal(safeNextPath("https://evil.com"), DEFAULT_NEXT_PATH);
  assert.equal(safeNextPath("https://evil.example/phish"), DEFAULT_NEXT_PATH);
  assert.equal(safeNextPath("http://evil.example"), DEFAULT_NEXT_PATH);
});

test("safeNextPath rejects a non-http scheme", () => {
  assert.equal(safeNextPath("javascript:alert(1)"), DEFAULT_NEXT_PATH);
});

test("safeNextPath rejects a bare host with no leading slash", () => {
  assert.equal(safeNextPath("evil.example/phish"), DEFAULT_NEXT_PATH);
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
  assert.equal(safeNextPath("//evil.example", "/log"), "/log");
  assert.equal(safeNextPath(null, "/log"), "/log");
});

test("safeNextPath rejects a leading backslash, which WHATWG URL parsing treats the same as a second leading slash", () => {
  assert.equal(safeNextPath("/\\evil.com"), DEFAULT_NEXT_PATH);
  assert.equal(safeNextPath("/\\evil.example"), DEFAULT_NEXT_PATH);
});

test("safeNextPath rejects an embedded tab, which URL parsing strips before resolving — collapsing \"/\\t/evil.com\" into the protocol-relative \"//evil.com\"", () => {
  assert.equal(safeNextPath("/\t/evil.com"), DEFAULT_NEXT_PATH);
});

test("safeNextPath treats a literal, still-percent-encoded backslash sequence as ordinary path text", () => {
  // searchParams.get() already URL-decodes its value, so this function only
  // ever sees a raw "%5C" sequence if it was double-encoded — in that case
  // it's inert literal text, not a backslash, and is safe to pass through.
  assert.equal(safeNextPath("/%5Cevil.com"), "/%5Cevil.com");
});

test("safeNextPath rejects the decoded backslash that searchParams.get would actually hand us for a real next=%2F%5Cevil.com query value", () => {
  // This documents the assumption behind the test above: by the time a
  // value reaches safeNextPath, percent-encoding has already been decoded,
  // so the dangerous input this function must catch is the plain backslash
  // form below — not the still-encoded "%5C" text.
  assert.equal(safeNextPath("/\\evil.com"), DEFAULT_NEXT_PATH);
});

test("safeNextPath rejects a normal-looking path with an embedded newline", () => {
  assert.equal(safeNextPath("/my-routes/abc\ndef"), DEFAULT_NEXT_PATH);
});
