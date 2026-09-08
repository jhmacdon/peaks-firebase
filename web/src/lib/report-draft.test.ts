import test from "node:test";
import assert from "node:assert/strict";
import { prepareReportDraft } from "./report-draft";

test("report preview and submission keep the persisted body/photo order and photo identity", () => {
  const photo = { type: "photo" as const, content: "https://example.test/photo", sourceId: "kept", caption: "Snow" };
  const result = prepareReportDraft(" Conditions ", [{ type: "text", content: " First " }, photo, { type: "text", content: "Second" }]);
  assert.deepEqual(result, { title: "Conditions", blocks: [{ type: "text", content: "First\n\nSecond" }, photo] });
});

test("an unfinished photo cannot silently disappear on save", () => {
  assert.throws(() => prepareReportDraft("Snow", [{ type: "text", content: "Conditions" }, { type: "photo", content: "" }]), /Choose a photo or remove/);
});

test("reports require useful text even when they contain a photo", () => {
  assert.throws(() => prepareReportDraft("Snow", [{ type: "photo", content: "photo" }]), /Add a report/);
  assert.throws(() => prepareReportDraft(" ", [{ type: "text", content: "Snow" }]), /title/);
});
