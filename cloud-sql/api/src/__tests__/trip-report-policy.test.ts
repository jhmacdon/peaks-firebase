import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  decodeTripReportCursor,
  encodeTripReportCursor,
  parseTripReportConditions,
  parseTripReportPhotos,
  TRIP_REPORT_CONDITION_CODES,
} from "../routes/trip-reports";

test("condition taxonomy is restrained and covers the supported field signals", () => {
  assert.deepEqual(TRIP_REPORT_CONDITION_CODES, [
    "snow",
    "ice",
    "washout",
    "downed_trees",
    "water",
    "bugs",
    "smoke",
    "closure",
    "route_finding",
  ]);
  assert.deepEqual(
    parseTripReportConditions([
      { code: "snow", severity: "serious", context: "Firm above 7,000 ft" },
      { code: "water", severity: "info" },
    ]),
    [
      { code: "snow", severity: "serious", context: "Firm above 7,000 ft" },
      { code: "water", severity: "info", context: undefined },
    ]
  );
  assert.throws(
    () => parseTripReportConditions([
      { code: "snow", severity: "notable" },
      { code: "snow", severity: "serious" },
    ]),
    /repeated/
  );
  assert.throws(
    () => parseTripReportConditions([{ code: "everything", severity: "notable" }]),
    /condition code/
  );
});

test("photo validation accepts only the owner's deterministic activity namespace", () => {
  const photo = {
    id: "photo-1",
    storage_path: "trip-reports/user-1/session-1/photo-1.jpg",
    download_url: "https://firebasestorage.googleapis.com/v0/b/test/o/trip-reports%2Fuser-1%2Fsession-1%2Fphoto-1.jpg?alt=media",
  };
  assert.equal(parseTripReportPhotos([photo], "user-1", "session-1").length, 1);
  assert.throws(
    () => parseTripReportPhotos(
      [{ ...photo, storage_path: "trip-reports/user-2/session-1/photo-1.jpg" }],
      "user-1",
      "session-1"
    ),
    /storage path/
  );
  assert.throws(
    () => parseTripReportPhotos(
      [{ ...photo, storage_path: "trip-reports/user-1/session-1/other.jpg" }],
      "user-1",
      "session-1"
    ),
    /storage path/
  );
  assert.throws(
    () => parseTripReportPhotos(
      [{ ...photo, download_url: "https://example.com/photo.jpg" }],
      "user-1",
      "session-1"
    ),
    /Peaks Storage/
  );
});

test("pagination cursor is opaque, round-trips, and rejects malformed input", () => {
  const cursor = { date: "2026-07-31T12:30:00.000Z", id: "report-2" };
  const encoded = encodeTripReportCursor(cursor);
  assert.ok(!encoded.includes(cursor.id));
  assert.deepEqual(decodeTripReportCursor(encoded), cursor);
  assert.equal(decodeTripReportCursor("not-a-cursor"), null);
});
