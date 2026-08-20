import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveActivityDisplayName,
  describeArea,
  describeDestination,
  describeList,
  describeRoute,
  describeSessionActivity,
  describeTripReport,
  formatSessionDuration,
  pickPrimaryRouteDestinationName,
} from "./seo-descriptions";

test("describeDestination matches the brief's worked example", () => {
  assert.equal(
    describeDestination({
      name: "Mount Si",
      elevationMeters: 1270.2,
      featureWord: "summit",
      region: "Washington",
      sessionCount: 312,
    }),
    "Mount Si: 4,167 ft summit in Washington. Routes, conditions, seasonality, and 312 recorded ascents on Peaks."
  );
});

test("describeDestination omits missing facts instead of printing gaps", () => {
  assert.equal(
    describeDestination({
      name: "Unnamed Point",
      elevationMeters: null,
      featureWord: null,
      region: null,
      sessionCount: 0,
    }),
    "Unnamed Point on Peaks. Routes, conditions, and seasonality on Peaks."
  );
  assert.equal(
    describeDestination({
      name: "Crystal Peak",
      elevationMeters: null,
      featureWord: "summit",
      region: null,
      sessionCount: 1,
    }),
    "Crystal Peak: summit. Routes, conditions, seasonality, and 1 recorded ascent on Peaks."
  );
});

test("describeRoute matches the brief's worked example", () => {
  assert.equal(
    describeRoute({
      name: "Camp Muir Route",
      distanceMeters: 6598.2,
      gainMeters: 1425.6,
      primaryDestinationName: "Mount Rainier",
    }),
    "Camp Muir Route: 4.1 mi, 4,677 ft gain on Mount Rainier. Route guide with elevation profile and waypoints."
  );
});

test("describeRoute omits the location clause when no destination resolves", () => {
  assert.equal(
    describeRoute({
      name: "Unnamed Route",
      distanceMeters: null,
      gainMeters: null,
      primaryDestinationName: null,
    }),
    "Unnamed Route on Peaks. Route guide with elevation profile and waypoints."
  );
});

test("pickPrimaryRouteDestinationName picks the highest-elevation named waypoint", () => {
  assert.equal(
    pickPrimaryRouteDestinationName([
      { name: "Camp Muir", elevation: 3105 },
      { name: "Mount Rainier", elevation: 4392 },
      { name: null, elevation: 5000 },
    ]),
    "Mount Rainier"
  );
});

test("pickPrimaryRouteDestinationName falls back to the first named waypoint with no elevation data", () => {
  assert.equal(
    pickPrimaryRouteDestinationName([
      { name: "Trailhead", elevation: null },
      { name: "Overlook", elevation: null },
    ]),
    "Trailhead"
  );
  assert.equal(pickPrimaryRouteDestinationName([]), null);
});

test("describeArea reports counts and region", () => {
  assert.equal(
    describeArea({
      name: "Mount Rainier National Park",
      designationLabel: "National Park",
      region: "Washington",
      destinationCount: 42,
      routeCount: 12,
    }),
    "Mount Rainier National Park: National Park in Washington. 42 destinations and 12 routes on Peaks."
  );
});

test("describeArea falls back when counts are zero", () => {
  assert.equal(
    describeArea({
      name: "Some Wilderness",
      designationLabel: "Wilderness",
      region: null,
      destinationCount: 0,
      routeCount: 0,
    }),
    "Some Wilderness: Wilderness. Boundary and activity on Peaks."
  );
});

test("describeList summarizes a source description", () => {
  assert.equal(
    describeList({
      name: "Seven Summits",
      description: "The tallest peak on each continent.\n\n",
      destinationCount: 7,
    }),
    "Seven Summits: The tallest peak on each continent. 7 destinations on Peaks."
  );
});

test("describeList falls back to a plain lead with no source description", () => {
  assert.equal(
    describeList({ name: "Washington Bulgers", description: null, destinationCount: 100 }),
    "Washington Bulgers: a curated list. 100 destinations on Peaks."
  );
});

test("describeTripReport joins destination and photo counts", () => {
  assert.equal(
    describeTripReport({
      title: "Summit Day",
      authorName: "Jane Doe",
      formattedDate: "Aug 27, 2022",
      destinationCount: 2,
      photoCount: 6,
    }),
    "Summit Day: trip report by Jane Doe, Aug 27, 2022. 2 destinations and 6 photos on Peaks."
  );
});

test("describeTripReport falls back when there are no linked destinations or photos", () => {
  assert.equal(
    describeTripReport({
      title: "Quiet Ridge Walk",
      authorName: "A Peaks member",
      formattedDate: "Jan 1, 2024",
      destinationCount: 0,
      photoCount: 0,
    }),
    "Quiet Ridge Walk: trip report by A Peaks member, Jan 1, 2024. Conditions and route notes on Peaks."
  );
});

test("deriveActivityDisplayName prefers an explicit session name", () => {
  assert.equal(
    deriveActivityDisplayName("Sunset scramble", [
      { name: "Mount Si", elevation: 4167, relation: "reached" },
    ]),
    "Sunset scramble"
  );
});

test("deriveActivityDisplayName falls back to reached destinations sorted highest-first", () => {
  assert.equal(
    deriveActivityDisplayName(null, [
      { name: "Camp Muir", elevation: 3105, relation: "reached" },
      { name: "Mount Rainier", elevation: 4392, relation: "reached" },
    ]),
    "Mount Rainier, Camp Muir"
  );
});

test("deriveActivityDisplayName falls back to goal destinations when nothing was reached", () => {
  assert.equal(
    deriveActivityDisplayName(null, [{ name: "Mount Si", elevation: 1270, relation: "goal" }]),
    "Mount Si"
  );
});

test("deriveActivityDisplayName falls back to Untitled Session with no name or destinations", () => {
  assert.equal(deriveActivityDisplayName(null, []), "Untitled Session");
});

test("formatSessionDuration renders hours and minutes, dropping the hour when zero", () => {
  assert.equal(formatSessionDuration(24000), "6h 40m");
  assert.equal(formatSessionDuration(300), "5m");
});

test("describeSessionActivity matches distance/gain/time summary shape", () => {
  assert.equal(
    describeSessionActivity({
      name: "Mount Si",
      distanceMeters: 6598.2,
      gainMeters: 670.6,
      totalTimeSeconds: 11700,
    }),
    "Mount Si: 4.1 mi, 2,200 ft gain, 3h 15m. Recorded activity on Peaks."
  );
});

test("describeSessionActivity omits missing facts", () => {
  assert.equal(
    describeSessionActivity({
      name: "Untitled activity",
      distanceMeters: null,
      gainMeters: null,
      totalTimeSeconds: null,
    }),
    "Untitled activity: Recorded activity on Peaks."
  );
});
