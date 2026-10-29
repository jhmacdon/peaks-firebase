import { test } from "node:test";
import assert from "node:assert/strict";
import { areaChangeSinceBaseline, areaHistoryNote, checkLowAccuracySurveys, markAccuracy } from "../glaciers/area-history";

const surveys = { years: [1900], text: "The 1900 map is rough.", citation: "Author (2020), p.1", source_quote: "The 1900 map is rough" };
const rows = [
  { year: 1900, area_km2: 5, uncertainty_km2: null },
  { year: 1950, area_km2: null, uncertainty_km2: null },
  { year: 1970, area_km2: 10, uncertainty_km2: .5 },
  { year: 2020, area_km2: 8, uncertainty_km2: .4 },
];

test("low-accuracy years need the source's own sentence naming each year", () => {
  assert.equal(checkLowAccuracySurveys("Intro.\nThe 1900 map\nis rough in places.", surveys), surveys);
  assert.throws(() => checkLowAccuracySurveys("No such warning.", surveys), /not found/);
  assert.throws(() => checkLowAccuracySurveys("The 1900 map is rough", { ...surveys, years: [1900, 1910] }), /1910/);
  assert.throws(() => checkLowAccuracySurveys("x", { ...surveys, years: [] }), /Empty/);
});

test("the headline skips low-accuracy and missing rows; the note lists measured low years only", () => {
  const history = markAccuracy(rows, surveys);
  assert.deepEqual(history.map(o => o.accuracy), ["low", null, null, null]);
  const change = areaChangeSinceBaseline(history)!;
  assert.equal(change.baseline_year, 1970);
  assert.equal(change.end_year, 2020);
  assert.ok(Math.abs(change.percent - -20) < 1e-12, "sign follows the data: 5 → 8 would read as growth");
  assert.deepEqual(areaHistoryNote(history, surveys)?.low_accuracy_years, [1900]);
  assert.equal(areaHistoryNote(markAccuracy(rows, null), null), null);
  assert.equal(areaHistoryNote(markAccuracy([{ ...rows[0], area_km2: null }, rows[2]], surveys), surveys), null);
  assert.equal(areaChangeSinceBaseline(markAccuracy([rows[0], rows[2]], surveys)), null, "one reliable row gives no change");
  assert.equal(areaChangeSinceBaseline([]), null);
});
