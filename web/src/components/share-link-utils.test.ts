import assert from "node:assert/strict";
import test from "node:test";
import { resolveShareUrl } from "./share-link-utils";

test("resolveShareUrl turns a public path into an absolute URL", () => {
  assert.equal(
    resolveShareUrl("/route/saved-route", "https://getpeaks.app"),
    "https://getpeaks.app/route/saved-route"
  );
});

test("resolveShareUrl defaults to the canonical Peaks host", () => {
  assert.equal(
    resolveShareUrl("/log/activity-1"),
    "https://getpeaks.app/log/activity-1"
  );
});

test("resolveShareUrl keeps an absolute URL", () => {
  assert.equal(
    resolveShareUrl("https://getpeaks.app/reports/report-1", "https://example.com"),
    "https://getpeaks.app/reports/report-1"
  );
});
