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
    countries: 0,
  });
});

test("buildListToplineFacts skips null elevations when picking the highest", () => {
  const facts = buildListToplineFacts([
    { name: "Peak A", elevation: null, state_code: "WA", country_code: "US" },
    { name: "Peak B", elevation: 1200, state_code: "WA", country_code: "US" },
    { name: "Peak C", elevation: null, state_code: "OR", country_code: "US" },
  ]);
  assert.equal(facts.count, 3);
  assert.equal(facts.highestName, "Peak B");
  assert.equal(facts.highestFt, 1200 * 3.28084);
});

test("buildListToplineFacts counts distinct states, ignoring nulls", () => {
  const facts = buildListToplineFacts([
    { name: "Peak A", elevation: 1000, state_code: "WA", country_code: "US" },
    { name: "Peak B", elevation: 1100, state_code: "WA", country_code: "US" },
    { name: "Peak C", elevation: 1200, state_code: "OR", country_code: "US" },
    { name: "Peak D", elevation: 1300, state_code: null, country_code: "US" },
  ]);
  assert.equal(facts.states, 2);
});

test("buildListToplineFacts picks the max elevation and its name", () => {
  const facts = buildListToplineFacts([
    { name: "Low Peak", elevation: 500, state_code: "CA", country_code: "US" },
    { name: "High Peak", elevation: 4400, state_code: "CA", country_code: "US" },
    { name: "Mid Peak", elevation: 2200, state_code: "NV", country_code: "US" },
  ]);
  assert.equal(facts.highestName, "High Peak");
  assert.equal(facts.highestFt, 4400 * 3.28084);
  assert.equal(facts.count, 3);
  assert.equal(facts.states, 2);
});

test("buildListToplineFacts returns null highest fields when every elevation is null", () => {
  const facts = buildListToplineFacts([
    { name: "Peak A", elevation: null, state_code: "WA", country_code: "US" },
    { name: "Peak B", elevation: null, state_code: "OR", country_code: "US" },
  ]);
  assert.equal(facts.count, 2);
  assert.equal(facts.highestFt, null);
  assert.equal(facts.highestName, null);
  assert.equal(facts.states, 2);
});

test("buildListToplineFacts counts distinct countries on a multi-country roster", () => {
  // Seven Summits shape: one country per peak, plus a US state (Denali/AK)
  // and a non-US subdivision code (Everest/P1) that must not be conflated
  // with a country.
  const facts = buildListToplineFacts([
    { name: "Everest", elevation: 8849, state_code: "P1", country_code: "NP" },
    { name: "Aconcagua", elevation: 6961, state_code: null, country_code: "AR" },
    { name: "Denali", elevation: 6190, state_code: "AK", country_code: "US" },
    { name: "Kilimanjaro", elevation: 5895, state_code: null, country_code: "TZ" },
    { name: "Elbrus", elevation: 5642, state_code: null, country_code: null },
    { name: "Vinson Massif", elevation: 4892, state_code: null, country_code: "AQ" },
    { name: "Puncak Jaya", elevation: 4884, state_code: null, country_code: "ID" },
  ]);
  assert.equal(facts.countries, 6);
  assert.equal(facts.states, 2);
});

test("buildListToplineFacts keeps prior states behavior on a single-country roster", () => {
  const facts = buildListToplineFacts([
    { name: "Mount Rainier", elevation: 4392, state_code: "WA", country_code: "US" },
    { name: "Mount Adams", elevation: 3743, state_code: "WA", country_code: "US" },
    { name: "Mount Hood", elevation: 3429, state_code: "OR", country_code: "US" },
  ]);
  assert.equal(facts.countries, 1);
  assert.equal(facts.states, 2);
});

test("buildListToplineFacts ignores null country_codes when counting countries", () => {
  const facts = buildListToplineFacts([
    { name: "Peak A", elevation: 1000, state_code: "WA", country_code: "US" },
    { name: "Peak B", elevation: 1100, state_code: null, country_code: null },
    { name: "Peak C", elevation: 1200, state_code: null, country_code: null },
  ]);
  assert.equal(facts.countries, 1);
});
