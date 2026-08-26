import assert from "node:assert/strict";
import test from "node:test";
import { formatReportAuthorName } from "./report-author-name";

test("formatReportAuthorName supports current string names", () => {
  assert.equal(formatReportAuthorName("  Avery Peak  "), "Avery Peak");
});

test("formatReportAuthorName supports legacy structured names", () => {
  assert.equal(
    formatReportAuthorName({ first: "Avery", last: "Peak" }),
    "Avery Peak"
  );
  assert.equal(formatReportAuthorName({ first: "Avery" }), "Avery");
});

test("formatReportAuthorName rejects empty and unrelated values", () => {
  assert.equal(formatReportAuthorName({ first: " ", last: null }), null);
  assert.equal(formatReportAuthorName(null), null);
});
