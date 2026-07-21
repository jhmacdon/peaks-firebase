import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildAreaDescription, formatEnglishList } from "../area-description";

test("area description uses clear agency, place, and peak facts", () => {
  assert.equal(
    buildAreaDescription({
      name: "Mount Rainier National Park",
      kind: "national_park",
      manager: "NPS",
      stateCodes: ["WA"],
      peakNames: ["Mount Rainier", "Liberty Cap", "Little Tahoma Peak"],
    }),
    "The National Park Service manages Mount Rainier National Park, a national park in Washington. Peaks tracks Mount Rainier, Liberty Cap, and Little Tahoma Peak here."
  );
});

test("area description stays useful when no manager or peaks are known", () => {
  assert.equal(
    buildAreaDescription({
      name: "Test Wilderness",
      kind: "wilderness",
      stateCodes: ["OR", "WA", "OR"],
    }),
    "Test Wilderness is a wilderness area in Oregon and Washington."
  );
});

test("area description uses a plural verb for shared management", () => {
  assert.equal(
    buildAreaDescription({
      name: "Example Reserve",
      kind: "national_conservation_area",
      manager: "JNT",
      stateCodes: ["CA"],
    }),
    "Several agencies manage Example Reserve, a national conservation area in California."
  );
});

test("English lists stay short and grammatical", () => {
  assert.equal(formatEnglishList([]), "");
  assert.equal(formatEnglishList(["A"]), "A");
  assert.equal(formatEnglishList(["A", "B"]), "A and B");
  assert.equal(formatEnglishList(["A", "B", "C"]), "A, B, and C");
});
