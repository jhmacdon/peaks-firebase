import assert from "node:assert/strict";
import test from "node:test";

import { describeDesignation, describeManager } from "./area-types";

test("describeDesignation expands a known PAD-US code", () => {
  assert.equal(describeDesignation("WA", "wilderness"), "Wilderness Area");
  assert.equal(describeDesignation("NP", "national_park"), "National Park");
  assert.equal(describeDesignation("ACEC", "other_federal_area"), "Area of Critical Environmental Concern");
});

test("describeDesignation is case-insensitive", () => {
  assert.equal(describeDesignation("wa", "wilderness"), "Wilderness Area");
});

test("describeDesignation passes through already-spelled-out text", () => {
  assert.equal(
    describeDesignation("Wilderness Study Area", "wilderness"),
    "Wilderness Study Area"
  );
});

test("describeDesignation falls back to the kind label for null or an unmapped code", () => {
  assert.equal(describeDesignation(null, "national_park"), "National park");
  assert.equal(describeDesignation("SDA", "wildlife_refuge"), "Wildlife refuge");
});

test("describeManager expands a known PAD-US manager code", () => {
  assert.equal(describeManager("NPS"), "National Park Service");
  assert.equal(describeManager("BLM"), "Bureau of Land Management");
  assert.equal(describeManager("usfs"), "U.S. Forest Service");
});

test("describeManager passes through already-spelled-out text", () => {
  assert.equal(describeManager("National Park Service"), "National Park Service");
});

test("describeManager omits (null) for missing or unmapped codes rather than show a raw code", () => {
  assert.equal(describeManager(null), null);
  assert.equal(describeManager(""), null);
  assert.equal(describeManager("XYZ"), null);
});
