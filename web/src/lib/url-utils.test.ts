import assert from "node:assert/strict";
import test from "node:test";

import { isExternalHref } from "./url-utils";

test("isExternalHref accepts http and https URLs", () => {
  assert.equal(isExternalHref("https://apps.apple.com/us/app/peaks/id1"), true);
  assert.equal(isExternalHref("http://example.com"), true);
});

test("isExternalHref is case-insensitive on the scheme", () => {
  assert.equal(isExternalHref("HTTPS://example.com"), true);
});

test("isExternalHref rejects internal paths", () => {
  assert.equal(isExternalHref("/discover"), false);
  assert.equal(isExternalHref("about"), false);
  assert.equal(isExternalHref(""), false);
});

test("isExternalHref rejects protocol-relative and other-scheme URLs", () => {
  assert.equal(isExternalHref("//evil.com"), false);
  assert.equal(isExternalHref("mailto:support@getpeaks.app"), false);
});
