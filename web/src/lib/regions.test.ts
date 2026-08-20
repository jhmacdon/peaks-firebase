import assert from "node:assert/strict";
import test from "node:test";

import {
  allUsStateCodes,
  countryName,
  formatRegion,
  formatRegionList,
  subdivisionName,
  usStateCodeFromSlug,
  usStateSlugFromCode,
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

test("usStateCodeFromSlug resolves a known state slug, case-insensitively", () => {
  assert.equal(usStateCodeFromSlug("washington"), "WA");
  assert.equal(usStateCodeFromSlug("North-Carolina".toLowerCase()), "NC");
  assert.equal(usStateCodeFromSlug("new-mexico"), "NM");
});

test("usStateCodeFromSlug returns null for anything unmapped", () => {
  assert.equal(usStateCodeFromSlug("narnia"), null);
  assert.equal(usStateCodeFromSlug(""), null);
  assert.equal(usStateCodeFromSlug(null), null);
  assert.equal(usStateCodeFromSlug(undefined), null);
});

test("usStateSlugFromCode is the inverse of usStateCodeFromSlug", () => {
  for (const code of allUsStateCodes()) {
    const slug = usStateSlugFromCode(code);
    assert.ok(slug, `expected a slug for ${code}`);
    assert.equal(usStateCodeFromSlug(slug), code);
  }
});

test("usStateSlugFromCode returns null for an unmapped code", () => {
  assert.equal(usStateSlugFromCode("ZZ"), null);
  assert.equal(usStateSlugFromCode(null), null);
});

test("allUsStateCodes covers the 50 states plus DC and the mapped territories", () => {
  const codes = allUsStateCodes();
  assert.ok(codes.includes("WA"));
  assert.ok(codes.includes("DC"));
  assert.ok(codes.includes("PR"));
  assert.equal(new Set(codes).size, codes.length);
});
