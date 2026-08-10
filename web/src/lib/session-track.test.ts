import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionGpx } from "./session-track";

test("GPX export keeps a round-trippable fractional elevation", () => {
  const gpx = buildSessionGpx("Fractional", [{
    lat: 47,
    lng: -121,
    elevation: 1234.567890123,
    time: 1_700_000_000,
    segment_number: 0,
    speed: null,
    azimuth: null,
    hdop: null,
    speed_accuracy: null,
  }]);

  assert.match(gpx, /<ele>1234\.567890123<\/ele>/);
});
