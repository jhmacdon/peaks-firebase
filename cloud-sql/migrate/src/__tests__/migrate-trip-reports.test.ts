import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLegacyTripReport } from "../trip-report-normalize";

test("normalizes 2021 iOS content without inventing route links", () => {
  const report = normalizeLegacyTripReport("session-1", {
    userId: "user-1",
    date: "2021-07-01T12:00:00Z",
    destinations: ["rainier", "rainier", "muir"],
    headerPhotos: [{
      type: "photo",
      id: "asset-1",
      image: "https://firebasestorage.googleapis.com/photo.jpg",
      created: "2021-07-01T13:00:00Z",
    }],
    content: [{ type: "text", text: "Snow from the cleaver." }],
    attachments: { route: true, timeline: true },
  });
  assert.ok(report);
  assert.equal(report.body, "Snow from the cleaver.");
  assert.deepEqual(report.destinationIds, ["rainier", "muir"]);
  assert.equal(report.photos.length, 1);
  assert.equal("routeIds" in report, false);
});

test("normalizes web blocks and drops unsafe photo URLs", () => {
  const report = normalizeLegacyTripReport("report-1", {
    userId: "user-1",
    title: "Web report",
    blocks: [
      { type: "text", content: "Open trail." },
      { type: "photo", content: "javascript:alert(1)" },
    ],
  });
  assert.ok(report);
  assert.equal(report.body, "Open trail.");
  assert.deepEqual(report.photos, []);
});

test("rejects ownerless or empty legacy rows", () => {
  assert.equal(normalizeLegacyTripReport("report", { content: [] }), null);
  assert.equal(normalizeLegacyTripReport("report", { userId: "user", content: [] }), null);
});
