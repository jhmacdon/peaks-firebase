import assert from "node:assert/strict";
import test from "node:test";
import type { AreaDestination } from "./actions/areas";
import { sortAreaDestinations } from "./area-destination-sort";

function destination(
  id: string,
  name: string,
  elevation: number | null,
  prominence: number | null
): AreaDestination {
  return {
    id,
    name,
    elevation,
    prominence,
    type: "point",
    activities: [],
    features: ["summit"],
    country_code: "US",
    state_code: "WA",
    lat: 48,
    lng: -121,
    hero_image: null,
    hero_image_focal_x: 50,
    hero_image_focal_y: 50,
    hero_image_attribution: null,
    hero_image_attribution_url: null,
  };
}

const destinations = [
  destination("lower", "Alpha", 2_500, 700),
  destination("higher", "Zulu", 2_900, 500),
  destination("unknown", "Bravo", null, null),
];

test("area destinations make the default prominence order explicit", () => {
  assert.deepEqual(
    sortAreaDestinations(destinations, "prominence").map((item) => item.id),
    ["lower", "higher", "unknown"]
  );
});

test("area destinations can switch to elevation or name", () => {
  assert.deepEqual(
    sortAreaDestinations(destinations, "elevation").map((item) => item.id),
    ["higher", "lower", "unknown"]
  );
  assert.deepEqual(
    sortAreaDestinations(destinations, "name").map((item) => item.id),
    ["lower", "unknown", "higher"]
  );
});
