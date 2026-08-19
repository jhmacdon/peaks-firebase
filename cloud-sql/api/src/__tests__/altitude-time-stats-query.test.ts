import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  ALTITUDE_TIME_MAX_GAP_SECONDS,
  ALTITUDE_TIME_THRESHOLDS_METERS,
  buildAltitudeTimeStatsQuery,
} from "../routes/sessions";

test("altitude-time stats stay user-scoped and return one row per session", () => {
  const query = buildAltitudeTimeStatsQuery("user-1");

  assert.equal(ALTITUDE_TIME_THRESHOLDS_METERS.feet14000, 4_267.2);
  assert.equal(ALTITUDE_TIME_THRESHOLDS_METERS.feet13000, 3_962.4);
  assert.match(query.text, /JOIN tracking_sessions s ON s\.id = tp\.session_id/);
  assert.match(query.text, /WHERE s\.user_id = \$1/);
  assert.match(query.text, /PARTITION BY tp\.session_id ORDER BY tp\.time/);
  assert.match(query.text, /GROUP BY session_id/);
  assert.deepEqual(query.values, [
    "user-1",
    ALTITUDE_TIME_THRESHOLDS_METERS.feet14000,
    ALTITUDE_TIME_THRESHOLDS_METERS.feet13000,
    4_000,
    3_000,
    ALTITUDE_TIME_MAX_GAP_SECONDS,
  ]);
});

test("altitude-time stats reject pauses and broken clocks", () => {
  const query = buildAltitudeTimeStatsQuery("user-1");

  assert.match(query.text, /next_time > time/);
  assert.match(query.text, /next_time - time <= \$6/);
  assert.match(query.text, /next_segment_number = segment_number/);
  assert.match(query.text, /elevation IS NOT NULL/);
  assert.match(query.text, /next_elevation IS NOT NULL/);
});

test("altitude-time stats interpolate both sides of each threshold crossing", () => {
  const query = buildAltitudeTimeStatsQuery("user-1");

  assert.match(
    query.text,
    /elevation <= \$2 AND next_elevation > \$2[\s\S]*next_elevation - \$2/
  );
  assert.match(
    query.text,
    /elevation > \$2 AND next_elevation <= \$2[\s\S]*elevation - \$2/
  );
  assert.match(query.text, /seconds_above_14000_ft/);
  assert.match(query.text, /seconds_above_13000_ft/);
  assert.match(query.text, /seconds_above_4000_m/);
  assert.match(query.text, /seconds_above_3000_m/);
});
