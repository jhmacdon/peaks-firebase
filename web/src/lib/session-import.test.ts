import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  MAX_GPX_SESSION_POINTS,
  parseSessionGPX,
} from "./session-import";

test("accepts a valid GPX document without an XML declaration", () => {
  const gpx = `<gpx version="1.1" creator="Peaks test">
  <trk>
    <name>Declaration-free track</name>
    <trkseg>
      <trkpt lat="47.1" lon="-121.9">
        <ele>100</ele>
        <time>2026-07-28T10:00:00Z</time>
      </trkpt>
      <trkpt lat="47.101" lon="-121.9">
        <ele>110</ele>
        <time>2026-07-28T10:01:00Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

  const parsed = parseSessionGPX(gpx, "track.gpx");
  assert.equal(parsed.name, "Declaration-free track");
  assert.equal(parsed.points.length, 2);
});

test("rejects excessive point elements before extracting their bodies", () => {
  const points = '<trkpt lat="0" lon="0" />'.repeat(
    MAX_GPX_SESSION_POINTS + 1
  );
  const gpx = `<gpx>${points}</gpx>`;
  const startedAt = performance.now();

  assert.throws(
    () => parseSessionGPX(gpx, "too-many.gpx"),
    /more than 25,000 point elements/
  );
  assert.ok(
    performance.now() - startedAt < 2_000,
    "excessive point preflight should finish within two seconds"
  );
});

test("rejects many unclosed point starts in linear time", () => {
  const gpx = `<gpx>${"<trkpt ".repeat(100_000)}</gpx>`;
  const startedAt = performance.now();

  assert.throws(
    () => parseSessionGPX(gpx, "unclosed.gpx"),
    /unclosed tag/
  );
  assert.ok(
    performance.now() - startedAt < 2_000,
    "unclosed point preflight should finish within two seconds"
  );
});

test("rejects fake point starts inside a malformed attribute", () => {
  const fakePoints = "<trkpt ".repeat(100_000);
  const gpx = `<gpx note="${fakePoints}"><trkpt /></gpx>`;
  const startedAt = performance.now();

  assert.throws(
    () => parseSessionGPX(gpx, "attribute.gpx"),
    /invalid attribute/
  );
  assert.ok(
    performance.now() - startedAt < 2_000,
    "malformed attribute preflight should finish within two seconds"
  );
});
