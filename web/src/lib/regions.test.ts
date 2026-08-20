import assert from "node:assert/strict";
import test from "node:test";

import {
  countryName,
  formatRegion,
  formatRegionList,
  subdivisionName,
} from "./regions";

test("countryName expands a known ISO 3166-1 code, case-insensitively", () => {
  assert.equal(countryName("US"), "United States");
  assert.equal(countryName("pl"), "Poland");
});

test("countryName returns null for an unmapped or missing code", () => {
  assert.equal(countryName("ZZ"), null);
  assert.equal(countryName(null), null);
  assert.equal(countryName(undefined), null);
});

test("subdivisionName expands a known US state code", () => {
  assert.equal(subdivisionName("US", "WA"), "Washington");
  assert.equal(subdivisionName("us", "ca"), "California");
});

test("subdivisionName returns null outside the mapped countries", () => {
  assert.equal(subdivisionName("IT", "TN"), null);
  assert.equal(subdivisionName(null, "WA"), null);
  assert.equal(subdivisionName("US", null), null);
});

test("formatRegion joins state and country when both resolve", () => {
  assert.equal(formatRegion("WA", "US"), "Washington, United States");
});

test("formatRegion falls back to whichever half resolves — never a raw code", () => {
  assert.equal(formatRegion(null, "PL"), "Poland");
  assert.equal(formatRegion("TN", "IT"), "Italy");
});

test("formatRegion returns null when nothing resolves", () => {
  assert.equal(formatRegion("TN", "ZZ"), null);
  assert.equal(formatRegion(null, null), null);
});

test("formatRegionList joins multiple resolved states for a multi-state area", () => {
  assert.equal(formatRegionList(["WA", "OR"], "US"), "Washington, Oregon");
});

test("formatRegionList drops unresolved codes and falls back to the country", () => {
  assert.equal(formatRegionList(["ZZ"], "US"), "United States");
  assert.equal(formatRegionList([], "US"), "United States");
  assert.equal(formatRegionList(null, "US"), "United States");
});
