import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildAreaDescription,
  formatEnglishList,
  selectSourceDescription,
} from "../area-description";

test("area fallback describes the land instead of its manager", () => {
  assert.equal(
    buildAreaDescription({
      name: "Mount Rainier National Park",
      kind: "national_park",
      manager: "NPS",
      stateCodes: ["WA"],
      peakNames: ["Mount Rainier", "Liberty Cap", "Little Tahoma Peak"],
    }),
    "Mount Rainier National Park protects a nationally important landscape in Washington. Notable high points include Mount Rainier, Liberty Cap, and Little Tahoma Peak."
  );
});

test("area description stays useful when no manager or peaks are known", () => {
  assert.equal(
    buildAreaDescription({
      name: "Test Wilderness",
      kind: "wilderness",
      stateCodes: ["OR", "WA", "OR"],
    }),
    "Test Wilderness preserves undeveloped wild country in Oregon and Washington."
  );
});

test("area fallback handles conservation land without manager copy", () => {
  assert.equal(
    buildAreaDescription({
      name: "Example Reserve",
      kind: "national_conservation_area",
      manager: "JNT",
      stateCodes: ["CA"],
    }),
    "Example Reserve protects public land valued for its wildlife, scenery, and history in California."
  );
});

test("source description keeps the opening fact and best landscape sentence", () => {
  const extract = "Mount Rainier National Park ( ray-NEER) is a national park in Washington. "
    + "The park was established in 1899 by Congress. "
    + "Mount Rainier is surrounded by valleys, waterfalls, alpine meadows, and old-growth forest. "
    + "It had more than one million visitors in 2024.";

  assert.equal(
    selectSourceDescription(extract),
    "Mount Rainier National Park is a national park in Washington. Mount Rainier is surrounded by valleys, waterfalls, alpine meadows, and old-growth forest."
  );
});

test("source description drops an opening abbreviation", () => {
  assert.equal(
    selectSourceDescription("Boundary Waters Canoe Area Wilderness (BWCAW or BWCA) is a wilderness in Minnesota."),
    "Boundary Waters Canoe Area Wilderness is a wilderness in Minnesota."
  );
});

test("English lists stay short and grammatical", () => {
  assert.equal(formatEnglishList([]), "");
  assert.equal(formatEnglishList(["A"]), "A");
  assert.equal(formatEnglishList(["A", "B"]), "A and B");
  assert.equal(formatEnglishList(["A", "B", "C"]), "A, B, and C");
});
