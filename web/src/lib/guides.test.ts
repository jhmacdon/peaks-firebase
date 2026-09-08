import assert from "node:assert/strict";
import test from "node:test";
import { GUIDES, guideForArea, guideForList } from "./guides";

test("reviewed list guides keep their existing canonical destination", () => {
  const ids = ["LAZcIKjluO0oT3o9g6MC", "dR9aHGKw3VwBhfsHSwlB", "ULCGhLnsWcYYRqXQ3aOo"];
  for (const id of ids) assert.equal(guideForList(id)?.href, `/lists/${id}`);
  assert.equal(guideForList("unknown"), undefined);
});

test("Alpine Lakes copy does not spill into the study area or namesakes", () => {
  assert.ok(guideForArea("Alpine Lakes Wilderness", "US", ["WA"]));
  assert.equal(guideForArea("Alpine Lakes Wilderness Study Area", "US", ["WA"]), undefined);
  assert.equal(guideForArea("Alpine Lakes Wilderness", "CA", ["WA"]), undefined);
  assert.equal(guideForArea("Alpine Lakes Wilderness", "US", ["CO"]), undefined);
});

test("guide roster has unique routes and source links for each reading section", () => {
  assert.equal(new Set(GUIDES.map((guide) => guide.slug)).size, GUIDES.length);
  assert.equal(new Set(GUIDES.map((guide) => guide.href)).size, GUIDES.length);
  for (const guide of GUIDES) {
    assert.ok(guide.intro && guide.description);
    for (const section of guide.sections) {
      assert.equal(new URL(section.source.url).protocol, "https:");
      assert.ok(section.source.label && section.paragraphs.length);
    }
  }
});
