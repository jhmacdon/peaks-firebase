import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNationalParkIndex,
  OFFICIAL_NATIONAL_PARKS,
  officialNationalParkSearchNames,
  type NationalParkAreaCandidate,
} from "./national-park-index";

function allCandidates(): NationalParkAreaCandidate[] {
  return officialNationalParkSearchNames().map((searchName, index) => ({
    id: `area-${index}`,
    searchName,
    boundaryAreaSquareMeters: 1_000_000 + index,
    destinationCount: index,
  }));
}

test("official roster has 63 unique national parks", () => {
  assert.equal(OFFICIAL_NATIONAL_PARKS.length, 63);
  assert.equal(new Set(officialNationalParkSearchNames()).size, 63);
  assert.ok(officialNationalParkSearchNames().includes("haleakala national park"));
  assert.ok(officialNationalParkSearchNames().includes("hawai i volcanoes national park"));
  assert.ok(officialNationalParkSearchNames().includes("wrangell st elias national park"));
});

test("Olympic is listed in Washington regardless of its PAD-US designation", () => {
  const result = buildNationalParkIndex(allCandidates(), {
    statesLimit: 60,
    perStateLimit: 100,
  });
  const olympic = result.areas.find(
    (area) => area.name === "Olympic National Park" && area.stateCode === "WA"
  );

  assert.ok(olympic);
  assert.equal(olympic.designation, "NP");
  assert.equal(result.totalMatching, 63);
});

test("multi-state parks appear in every official state", () => {
  const result = buildNationalParkIndex(allCandidates(), {
    statesLimit: 60,
    perStateLimit: 100,
  });

  assert.deepEqual(
    result.areas
      .filter((area) => area.name === "Yellowstone National Park")
      .map((area) => area.stateCode)
      .sort(),
    ["ID", "MT", "WY"]
  );
  assert.deepEqual(
    result.areas
      .filter((area) => area.name === "Death Valley National Park")
      .map((area) => area.stateCode)
      .sort(),
    ["CA", "NV"]
  );
});

test("largest boundary wins when PAD-US contains duplicate fragments", () => {
  const candidates = allCandidates();
  const olympicSearchName = officialNationalParkSearchNames().find((name) =>
    name.startsWith("olympic ")
  );
  assert.ok(olympicSearchName);
  candidates.push({
    id: "olympic-tiny-easement",
    searchName: olympicSearchName,
    boundaryAreaSquareMeters: 1,
    destinationCount: 500,
  });

  const result = buildNationalParkIndex(candidates, {
    search: "Olympic",
    statesLimit: 60,
    perStateLimit: 100,
  });

  assert.equal(result.totalMatching, 1);
  assert.notEqual(result.areas[0]?.id, "olympic-tiny-easement");
});

test("missing source rows fail the audit", () => {
  assert.throws(
    () =>
      buildNationalParkIndex(allCandidates().slice(1), {
        statesLimit: 60,
        perStateLimit: 100,
      }),
    /Missing PAD-US rows for national parks: Acadia National Park/
  );
});
