import assert from "node:assert/strict";
import test from "node:test";
import { expandNameAbbreviations, hasNameAbbreviation } from "../lib/place-names";

// Real catalog names from the 2026-10-13 prod audit
// (migrations/20261014_expand_name_abbreviations.sql).
const cases: [string, string][] = [
  ["Mt. Baker", "Mount Baker"],
  ["Mt Ascutney", "Mount Ascutney"],
  ["mt. SomugiYama", "Mount SomugiYama"],
  ["Mt. Muller Trailhead - Highway 101", "Mount Muller Trailhead - Highway 101"],
  ["Mt. Zion/Sleepy Hollow Trailhead", "Mount Zion/Sleepy Hollow Trailhead"],
  ["Medicine Lake Volcano / Mt Hoffman", "Medicine Lake Volcano / Mount Hoffman"],
  ["Look at Mt Hood", "Look at Mount Hood"],
  ["View of Mt. Hood", "View of Mount Hood"],
  ["Boalsburg & Mt. Nittany Middle School Overlook", "Boalsburg & Mount Nittany Middle School Overlook"],
  ["Mount Columbia Mt. Harvard Columbia Traverse", "Mount Columbia Mount Harvard Columbia Traverse"],
  ["County Road 4, Chimney Mt Trail", "County Road 4, Chimney Mountain Trail"],
  ["Hickory Nut Mt Vista", "Hickory Nut Mountain Vista"],
  ["10th Mt. Div. Outlook", "10th Mountain Div. Outlook"],
  ["Lower Bald MTN Cliffs", "Lower Bald Mountain Cliffs"],
  ["Sumas Mtn. Outpost Cabin", "Sumas Mountain Outpost Cabin"],
  ["Granite Mtn II", "Granite Mountain II"],
  ["Annapurna East Pk.", "Annapurna East Peak"],
  ["Baltistan Pk", "Baltistan Peak"],
  ["紫雲出山 (Mt.Shiude)", "紫雲出山 (Mount Shiude)"],
  ["紫雲出山(Mt.Shiude)", "紫雲出山(Mount Shiude)"],
  ["Bear Mt State Park", "Bear Mountain State Park"],
  ["Eagle Creek, Oregon (Mt. Hood Nf) Wild and Scenic River", "Eagle Creek, Oregon (Mount Hood Nf) Wild and Scenic River"],
];

test("spells out Mt, Mtn and Pk the way the reviewed catalog renames did", () => {
  for (const [input, expected] of cases) {
    assert.equal(expandNameAbbreviations(input), expected, input);
    assert.equal(hasNameAbbreviation(expandNameAbbreviations(input)), false, input);
  }
});

test("leaves full words, St, and lookalike words alone", () => {
  for (const name of ["Helena, MT", "MT Hwy 200", "MT-12", "Lewis and Clark NF, MT", "Mount St. Helens", "St Sunday Crag", "Mountain Loop", "Mtxyz Ridge", "Pkwy Overlook", "Pikes Peak", "Matterhorn"]) {
    assert.equal(expandNameAbbreviations(name), name);
  }
  assert.equal(hasNameAbbreviation("Mount St. Helens"), false);
  assert.equal(hasNameAbbreviation("Mt. Hood"), true);
  assert.equal(hasNameAbbreviation("紫雲出山 (Mt.Shiude)"), true);
  assert.equal(hasNameAbbreviation("Granite Mtn"), true);
  assert.equal(hasNameAbbreviation("Helena, MT"), false);
  assert.equal(hasNameAbbreviation("MT. Hood"), true);
});
