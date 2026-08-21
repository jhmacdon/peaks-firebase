import assert from "node:assert/strict";
import test from "node:test";

import { buildListToplineFacts } from "./list-stats";

test("buildListToplineFacts returns zeros/nulls for an empty roster", () => {
  const facts = buildListToplineFacts([]);
  assert.deepEqual(facts, {
    count: 0,
    highestFt: null,
    highestName: null,
    states: 0,
  });
});

test("buildListToplineFacts skips null elevations when picking the highest", () => {
  const facts = buildListToplineFacts([
    { name: "Peak A", elevation: null, state_code: "WA" },
    { name: "Peak B", elevation: 1200, state_code: "WA" },
    { name: "Peak C", elevation: null, state_code: "OR" },
  ]);
  assert.equal(facts.count, 3);
  assert.equal(facts.highestName, "Peak B");
  assert.equal(facts.highestFt, 1200 * 3.28084);
});

test("buildListToplineFacts counts distinct states, ignoring nulls", () => {
  const facts = buildListToplineFacts([
    { name: "Peak A", elevation: 1000, state_code: "WA" },
    { name: "Peak B", elevation: 1100, state_code: "WA" },
    { name: "Peak C", elevation: 1200, state_code: "OR" },
    { name: "Peak D", elevation: 1300, state_code: null },
  ]);
  assert.equal(facts.states, 2);
});

test("buildListToplineFacts picks the max elevation and its name", () => {
  const facts = buildListToplineFacts([
    { name: "Low Peak", elevation: 500, state_code: "CA" },
    { name: "High Peak", elevation: 4400, state_code: "CA" },
    { name: "Mid Peak", elevation: 2200, state_code: "NV" },
  ]);
  assert.equal(facts.highestName, "High Peak");
  assert.equal(facts.highestFt, 4400 * 3.28084);
  assert.equal(facts.count, 3);
  assert.equal(facts.states, 2);
});

test("buildListToplineFacts returns null highest fields when every elevation is null", () => {
  const facts = buildListToplineFacts([
    { name: "Peak A", elevation: null, state_code: "WA" },
    { name: "Peak B", elevation: null, state_code: "OR" },
  ]);
  assert.equal(facts.count, 2);
  assert.equal(facts.highestFt, null);
  assert.equal(facts.highestName, null);
  assert.equal(facts.states, 2);
});
