import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildNearbyDestinationsQuery } from "../routes/destinations";

test("apparent nearby query accepts a fractional eye elevation", () => {
  const query = buildNearbyDestinationsQuery({
    lat: 47.64203,
    lng: -122.35107,
    radius: 260_000,
    limit: 500,
    eye: 1840.5,
  });

  assert.match(
    query.text,
    /GREATEST\(\$5::double precision, 0::double precision\)/,
    "the eye placeholder must stay floating point so real GPS altitudes do not fail the query"
  );
  assert.deepEqual(query.values, [
    47.64203,
    -122.35107,
    260_000,
    500,
    1840.5,
  ]);
});

test("distance nearby query keeps the four-parameter path", () => {
  const query = buildNearbyDestinationsQuery({
    lat: 47.64203,
    lng: -122.35107,
    radius: 260_000,
    limit: 500,
  });

  assert.doesNotMatch(query.text, /\$5/);
  assert.deepEqual(query.values, [
    47.64203,
    -122.35107,
    260_000,
    500,
  ]);
});
