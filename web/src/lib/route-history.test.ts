import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  bestSecondsFromAttempts,
  buildRouteHistoryHeadlineParts,
  latestAttempt,
  ordinalLabel,
  pickFeaturedRoute,
  shapeRouteHistory,
  type RouteAttempt,
  type RouteMatchCandidate,
} from "./route-history";

function attempt(overrides: Partial<RouteAttempt> = {}): RouteAttempt {
  return {
    sessionId: "s1",
    startTime: "2024-01-01T12:00:00.000Z",
    totalTime: 3600,
    ...overrides,
  };
}

test("ordinalLabel handles the teens exception", () => {
  assert.equal(ordinalLabel(1), "1st");
  assert.equal(ordinalLabel(2), "2nd");
  assert.equal(ordinalLabel(3), "3rd");
  assert.equal(ordinalLabel(4), "4th");
  assert.equal(ordinalLabel(11), "11th");
  assert.equal(ordinalLabel(12), "12th");
  assert.equal(ordinalLabel(13), "13th");
  assert.equal(ordinalLabel(21), "21st");
  assert.equal(ordinalLabel(22), "22nd");
  assert.equal(ordinalLabel(23), "23rd");
  assert.equal(ordinalLabel(101), "101st");
});

test("bestSecondsFromAttempts picks the fastest, ignoring nulls", () => {
  assert.equal(
    bestSecondsFromAttempts([
      attempt({ totalTime: 4000 }),
      attempt({ totalTime: null }),
      attempt({ totalTime: 3200 }),
      attempt({ totalTime: 5000 }),
    ]),
    3200
  );
  assert.equal(bestSecondsFromAttempts([attempt({ totalTime: null })]), null);
  assert.equal(bestSecondsFromAttempts([]), null);
});

test("latestAttempt picks the most recent start time", () => {
  const a = attempt({ sessionId: "a", startTime: "2024-01-01T00:00:00.000Z" });
  const b = attempt({ sessionId: "b", startTime: "2024-06-01T00:00:00.000Z" });
  const c = attempt({ sessionId: "c", startTime: "2024-03-01T00:00:00.000Z" });
  assert.equal(latestAttempt([a, b, c])?.sessionId, "b");
  assert.equal(latestAttempt([]), null);
});

test("shapeRouteHistory is absent for a single attempt", () => {
  assert.equal(shapeRouteHistory([attempt()], "s1"), null);
  assert.equal(shapeRouteHistory([], "s1"), null);
});

test("shapeRouteHistory orders entries newest first and ranks chronologically", () => {
  const attempts = [
    attempt({ sessionId: "first", startTime: "2024-01-01T00:00:00.000Z", totalTime: 5000 }),
    attempt({ sessionId: "second", startTime: "2024-02-01T00:00:00.000Z", totalTime: 4000 }),
    attempt({ sessionId: "third", startTime: "2024-03-01T00:00:00.000Z", totalTime: 4500 }),
  ];

  const history = shapeRouteHistory(attempts, "second");
  assert.ok(history);
  assert.equal(history!.totalAttempts, 3);
  assert.equal(history!.bestSeconds, 4000);
  assert.equal(history!.currentRank, 2);
  // The participation sentence is composed by the caller from currentRank +
  // totalAttempts (each numeral gets its own font-mono-num span), not
  // pre-baked into a string here — this is the pair a caller would combine.
  assert.equal(ordinalLabel(history!.currentRank!), "2nd");

  // newest first
  assert.deepEqual(
    history!.entries.map((e) => e.sessionId),
    ["third", "second", "first"]
  );

  const current = history!.entries.find((e) => e.sessionId === "second");
  assert.equal(current?.isCurrent, true);
  assert.equal(current?.isBest, true);

  const others = history!.entries.filter((e) => e.sessionId !== "second");
  assert.ok(others.every((e) => !e.isCurrent && !e.isBest));
});

test("shapeRouteHistory: this session is the Strava-style '3rd of your 5 attempts' example", () => {
  const attempts = [1, 2, 3, 4, 5].map((n) =>
    attempt({ sessionId: `s${n}`, startTime: `2024-0${n}-01T00:00:00.000Z`, totalTime: 3000 + n })
  );
  const history = shapeRouteHistory(attempts, "s3");
  assert.equal(history?.currentRank, 3);
  assert.equal(history?.totalAttempts, 5);
  assert.equal(ordinalLabel(history!.currentRank!), "3rd");
});

test("shapeRouteHistory tolerates a current session absent from the attempts", () => {
  const attempts = [
    attempt({ sessionId: "a", startTime: "2024-01-01T00:00:00.000Z" }),
    attempt({ sessionId: "b", startTime: "2024-02-01T00:00:00.000Z" }),
  ];
  const history = shapeRouteHistory(attempts, "not-in-list");
  assert.ok(history);
  assert.equal(history!.currentRank, null);
  assert.ok(history!.entries.every((e) => !e.isCurrent));
});

test("shapeRouteHistory leaves every entry unmarked when nothing recorded a time", () => {
  const attempts = [
    attempt({ sessionId: "a", totalTime: null, startTime: "2024-01-01T00:00:00.000Z" }),
    attempt({ sessionId: "b", totalTime: null, startTime: "2024-02-01T00:00:00.000Z" }),
  ];
  const history = shapeRouteHistory(attempts, "a");
  assert.equal(history?.bestSeconds, null);
  assert.ok(history!.entries.every((e) => !e.isBest));
});

function candidate(overrides: Partial<RouteMatchCandidate> = {}): RouteMatchCandidate {
  return {
    routeId: "r1",
    routeName: "Route One",
    attempts: [attempt(), attempt({ sessionId: "s2" })],
    ...overrides,
  };
}

test("pickFeaturedRoute ignores routes with fewer than two attempts", () => {
  assert.equal(
    pickFeaturedRoute([candidate({ routeId: "only-one", attempts: [attempt()] })]),
    null
  );
  assert.equal(pickFeaturedRoute([]), null);
});

test("pickFeaturedRoute prefers the richest history, then alphabetical", () => {
  const rich = candidate({
    routeId: "rich",
    routeName: "Zzz Route",
    attempts: [attempt(), attempt({ sessionId: "2" }), attempt({ sessionId: "3" })],
  });
  const thin = candidate({ routeId: "thin", routeName: "Aaa Route" });
  assert.equal(pickFeaturedRoute([thin, rich])?.routeId, "rich");

  const tieA = candidate({ routeId: "tie-a", routeName: "Bravo" });
  const tieB = candidate({ routeId: "tie-b", routeName: "Alpha" });
  assert.equal(pickFeaturedRoute([tieA, tieB])?.routeId, "tie-b");
});

test("buildRouteHistoryHeadlineParts pluralizes and carries the best time separately", () => {
  assert.deepEqual(buildRouteHistoryHeadlineParts(1, null), {
    count: 1,
    timesWord: "time",
    bestLabel: null,
  });
  assert.deepEqual(buildRouteHistoryHeadlineParts(4, 15120), {
    count: 4,
    timesWord: "times",
    bestLabel: "4h 12m",
  });
});

test("buildRouteHistoryHeadlineParts is absent at zero", () => {
  assert.equal(buildRouteHistoryHeadlineParts(0, null), null);
});
