import assert from "node:assert/strict";
import test from "node:test";

import {
  isBoilerplateListDescription,
  listOwnerLabel,
  parseListDescription,
} from "./list-content";

test("listOwnerLabel labels the peaks owner as curated", () => {
  assert.equal(listOwnerLabel("peaks"), "Peaks curated");
});

test("listOwnerLabel labels any other owner as a community list", () => {
  assert.equal(listOwnerLabel("some-user-id"), "Community list");
});

test("isBoilerplateListDescription flags missing and placeholder text", () => {
  assert.equal(isBoilerplateListDescription(null), true);
  assert.equal(isBoilerplateListDescription(undefined), true);
  assert.equal(isBoilerplateListDescription("  "), true);
  assert.equal(
    isBoilerplateListDescription(
      "A public checklist for planning, progress, and route research."
    ),
    true
  );
  assert.equal(isBoilerplateListDescription("The 15 California fourteeners."), false);
});

test("parseListDescription omits boilerplate and empty descriptions", () => {
  assert.deepEqual(parseListDescription(null), {
    paragraphs: [],
    sourceUrl: null,
    sourceLabel: null,
  });
  assert.deepEqual(
    parseListDescription(
      "A public checklist for planning, progress, and route research."
    ),
    { paragraphs: [], sourceUrl: null, sourceLabel: null }
  );
});

test("parseListDescription turns literal \\n escapes into paragraph breaks", () => {
  const raw =
    "The Seven Summits are the highest mountains of each of the seven continents.\\n\\nThere are multiple variations of the list.";
  const result = parseListDescription(raw);
  assert.deepEqual(result.paragraphs, [
    "The Seven Summits are the highest mountains of each of the seven continents.",
    "There are multiple variations of the list.",
  ]);
  assert.equal(result.sourceUrl, null);
});

test("parseListDescription also normalizes real newline characters", () => {
  const result = parseListDescription("First paragraph.\n\nSecond paragraph.");
  assert.deepEqual(result.paragraphs, ["First paragraph.", "Second paragraph."]);
});

test("parseListDescription pulls a trailing Source: URL out of body copy", () => {
  const result = parseListDescription(
    "The 15 California fourteeners in the Porcella/Burns list. Source: https://www.peakbagger.com/list.aspx?lid=50081"
  );
  assert.deepEqual(result.paragraphs, [
    "The 15 California fourteeners in the Porcella/Burns list.",
  ]);
  assert.equal(result.sourceUrl, "https://www.peakbagger.com/list.aspx?lid=50081");
  assert.equal(result.sourceLabel, "peakbagger.com");
});

test("parseListDescription strips www from the source label", () => {
  const result = parseListDescription("Body text. Source: https://www.example.com/x");
  assert.equal(result.sourceLabel, "example.com");
});

test("parseListDescription collapses single newlines within a paragraph to spaces", () => {
  const result = parseListDescription("Line one.\nLine two still one paragraph.");
  assert.deepEqual(result.paragraphs, ["Line one. Line two still one paragraph."]);
});
