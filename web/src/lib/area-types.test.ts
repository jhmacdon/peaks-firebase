import assert from "node:assert/strict";
import test from "node:test";

import {
  areaKindLabel,
  describeAreaIndexDesignation,
  describeDesignation,
  describeManager,
  normalizeAreaKind,
  sortAreasByProminence,
} from "./area-types";

test("describeDesignation expands a known PAD-US code", () => {
  assert.equal(describeDesignation("WA", "wilderness"), "Wilderness Area");
  assert.equal(describeDesignation("NP", "national_park"), "National Park");
  assert.equal(describeDesignation("ACEC", "other_federal_area"), "Area of Critical Environmental Concern");
  assert.equal(describeDesignation("SP", "state_park"), "State Park");
});

test("state parks keep their kind, label, and prominence", () => {
  assert.equal(normalizeAreaKind("state_park"), "state_park");
  assert.equal(areaKindLabel("state_park"), "State park");
  assert.deepEqual(
    sortAreasByProminence([
      { id: "forest", name: "Pisgah National Forest", kind: "national_forest" },
      { id: "state", name: "Mount Mitchell State Park", kind: "state_park" },
    ]).map((area) => area.id),
    ["state", "forest"]
  );
});

test("describeDesignation is case-insensitive", () => {
  assert.equal(describeDesignation("wa", "wilderness"), "Wilderness Area");
});

test("area index calls a named national park a National Park", () => {
  assert.equal(
    describeAreaIndexDesignation(
      "Yosemite National Park",
      "CONE",
      "other_federal_area"
    ),
    "National Park"
  );
  assert.equal(
    describeAreaIndexDesignation("John Muir Wilderness", "WA", "wilderness"),
    "Wilderness Area"
  );
});

test("describeDesignation falls back to the kind label for null or an unmapped code", () => {
  assert.equal(describeDesignation(null, "national_park"), "National park");
  assert.equal(describeDesignation("SDA", "wildlife_refuge"), "Wildlife refuge");
});

test("describeDesignation fails closed: an unmapped value never passes through, even if it looks already spelled out", () => {
  // "Wilderness Study Area" is the friendly text WSA maps to — but as raw
  // input it's still just an unmapped value and must not be echoed back.
  assert.equal(
    describeDesignation("Wilderness Study Area", "wilderness"),
    "Wilderness"
  );
  // A mixed-case, space-containing, unlisted value must also fall back
  // rather than pass through — this is the exact shape a future unlisted
  // PAD-US code could take.
  assert.equal(
    describeDesignation("Some New Designation", "other_federal_area"),
    "Protected area"
  );
});

test("describeManager expands a known PAD-US manager code", () => {
  assert.equal(describeManager("NPS"), "National Park Service");
  assert.equal(describeManager("BLM"), "Bureau of Land Management");
  assert.equal(describeManager("usfs"), "U.S. Forest Service");
  assert.equal(describeManager("SPR"), "State parks and recreation");
});

test("describeManager omits (null) for missing or unmapped codes rather than show a raw code", () => {
  assert.equal(describeManager(null), null);
  assert.equal(describeManager(""), null);
  assert.equal(describeManager("XYZ"), null);
});

test("describeManager fails closed: an unmapped value never passes through, even if it looks already spelled out", () => {
  // "National Park Service" is the friendly text NPS maps to — but as raw
  // input it's still an unmapped value and must be omitted, not echoed.
  assert.equal(describeManager("National Park Service"), null);
  // A mixed-case, space-containing, unlisted value — the shape a future
  // unlisted PAD-US manager code could take — must also be omitted.
  assert.equal(describeManager("Some New Agency"), null);
});
