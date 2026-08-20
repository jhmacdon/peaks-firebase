import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  isFullYearWindow,
  MVUM_VEHICLE_CLASSES,
  normalizeSeasonalFlag,
  parseDateWindows,
  seasonWindowsForClass,
  seasonWindowsForSegment,
} from "../roads/mvum-seasons";

test("the seasonal flag survives the source's mixed case and padding", () => {
  assert.equal(normalizeSeasonalFlag("seasonal"), "seasonal");
  assert.equal(normalizeSeasonalFlag("Seasonal"), "seasonal");
  assert.equal(normalizeSeasonalFlag("seasonal "), "seasonal");
  assert.equal(normalizeSeasonalFlag("yearlong"), "yearlong");
  assert.equal(normalizeSeasonalFlag("YEARLONG"), "yearlong");
});

test("anything that is not one of the two words means no seasonal data", () => {
  assert.equal(normalizeSeasonalFlag(null), null);
  assert.equal(normalizeSeasonalFlag(" "), null);
  // One row holds a date range where the flag belongs. It is not a flag.
  assert.equal(normalizeSeasonalFlag("4/1 - 12/25"), null);
});

test("a single window parses to a padded month-day pair", () => {
  assert.deepEqual(parseDateWindows("04/01-11/30"), [
    { opens: "04-01", closes: "11-30", wrapsYear: false },
  ]);
});

test("single-digit months and spaces around the dash both parse", () => {
  assert.deepEqual(parseDateWindows("06/01-9/30"), [
    { opens: "06-01", closes: "09-30", wrapsYear: false },
  ]);
  assert.deepEqual(parseDateWindows("06/01 - 9/30"), [
    { opens: "06-01", closes: "09-30", wrapsYear: false },
  ]);
  assert.deepEqual(parseDateWindows("7/01-10/11"), [
    { opens: "07-01", closes: "10-11", wrapsYear: false },
  ]);
});

test("several windows in one cell parse, whether split by spaces or commas", () => {
  assert.deepEqual(parseDateWindows("01/01-10/11    10/22-12/31"), [
    { opens: "01-01", closes: "10-11", wrapsYear: false },
    { opens: "10-22", closes: "12-31", wrapsYear: false },
  ]);
  assert.deepEqual(parseDateWindows("04/01-09/27,10/14-11/30"), [
    { opens: "04-01", closes: "09-27", wrapsYear: false },
    { opens: "10-14", closes: "11-30", wrapsYear: false },
  ]);
  assert.equal(parseDateWindows("01/01-01/02,03/13-10/31,11/23-11/28,12/25-12/31").length, 4);
});

test("a window that runs through New Year is flagged, not reordered", () => {
  assert.deepEqual(parseDateWindows("05/16-03/14"), [
    { opens: "05-16", closes: "03-14", wrapsYear: true },
  ]);
});

test("February 29 is kept — there is no year to check it against", () => {
  assert.deepEqual(parseDateWindows("09/01-02/29"), [
    { opens: "09-01", closes: "02-29", wrapsYear: true },
  ]);
});

test("filler and impossible dates yield no window", () => {
  assert.deepEqual(parseDateWindows(null), []);
  assert.deepEqual(parseDateWindows(" "), []);
  assert.deepEqual(parseDateWindows("open"), []);
  assert.deepEqual(parseDateWindows("13/01-14/02"), []);
  assert.deepEqual(parseDateWindows("04/31-11/30"), []);
});

test("only a lone 01/01-12/31 counts as the full-year filler", () => {
  assert.equal(isFullYearWindow(parseDateWindows("01/01-12/31")), true);
  assert.equal(isFullYearWindow(parseDateWindows("04/01-11/30")), false);
  // Nearly the whole year, but with a real eleven-day closure in it.
  assert.equal(isFullYearWindow(parseDateWindows("01/01-10/11    10/22-12/31")), false);
});

test("dates are read only under a seasonal flag", () => {
  assert.equal(seasonWindowsForClass("yearlong", "04/01-11/30"), null);
  assert.equal(seasonWindowsForClass(null, "04/01-11/30"), null);
  assert.deepEqual(seasonWindowsForClass("seasonal", "04/01-11/30"), [
    { opens: "04-01", closes: "11-30", wrapsYear: false },
  ]);
});

test("01/01-12/31 is no seasonal data, even when the row is flagged seasonal", () => {
  // The Mount Adams trap: FR 8040-500 is tagged yearlong, passenger vehicle
  // open, 01/01-12/31 while the same database rates it high-clearance only.
  assert.equal(seasonWindowsForClass("seasonal", "01/01-12/31"), null);
  assert.equal(seasonWindowsForClass("yearlong", "01/01-12/31"), null);
});

test("a missing window is null rather than an empty list", () => {
  // An empty array would read as "closed all year" to a careless caller.
  assert.equal(seasonWindowsForClass("seasonal", null), null);
  assert.equal(seasonWindowsForClass("seasonal", " "), null);
});

test("a segment yields a window per class that has one", () => {
  const row = {
    PASSENGERVEHICLE: "open",
    PASSENGERVEHICLE_DATESOPEN: "05/01-11/30",
    HIGHCLEARANCEVEHICLE_DATESOPEN: "05/01-11/30",
    TRUCK_DATESOPEN: "01/01-12/31",
    BUS_DATESOPEN: null,
    ATV_DATESOPEN: "06/15-09/30",
  };
  const windows = seasonWindowsForSegment("seasonal", row);
  assert.deepEqual(Object.keys(windows).sort(), [
    "atv",
    "high_clearance_vehicle",
    "passenger_vehicle",
  ]);
  assert.deepEqual(windows.passenger_vehicle, [
    { opens: "05-01", closes: "11-30", wrapsYear: false },
  ]);
});

test("a yearlong segment yields nothing at all", () => {
  const windows = seasonWindowsForSegment("yearlong", {
    PASSENGERVEHICLE_DATESOPEN: "05/01-11/30",
  });
  assert.deepEqual(windows, {});
});

test("every vehicle class names two distinct source columns", () => {
  const dateFields = new Set(MVUM_VEHICLE_CLASSES.map((c) => c.datesField));
  const names = new Set(MVUM_VEHICLE_CLASSES.map((c) => c.name));
  assert.equal(dateFields.size, MVUM_VEHICLE_CLASSES.length);
  assert.equal(names.size, MVUM_VEHICLE_CLASSES.length);
  assert.equal(MVUM_VEHICLE_CLASSES.length, 17);
});
