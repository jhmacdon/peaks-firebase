import assert from "node:assert/strict";
import test from "node:test";
import { buildExternalLinkAudit, catalogLinkUrl } from "../audit-external-links";

test("resolves only stable IDs and exact HTTPS pages", () => {
  assert.equal(catalogLinkUrl("peakbagger", "2296"), "https://www.peakbagger.com/peak.aspx?pid=2296");
  assert.equal(catalogLinkUrl("wta", "mount-si"), "https://www.wta.org/go-hiking/hikes/mount-si");
  assert.equal(catalogLinkUrl("osm", "123"), null);
  assert.equal(catalogLinkUrl("alltrails", "Mount Si"), null);
});

test("reports coverage, providers, features, duplicates, and bad links", () => {
  const report = buildExternalLinkAudit([
    {
      kind: "destination",
      id: "peak-1",
      name: "Peak One",
      features: ["summit"],
      external_ids: { peakbagger: "2296", wikidata: "Q194057" },
      external_links: [],
    },
    {
      kind: "destination",
      id: "lake-1",
      name: "Lake One",
      features: ["lake"],
      external_ids: { osm: "123" },
      external_links: [],
    },
    {
      kind: "route",
      id: "route-1",
      name: "Route One",
      features: [],
      external_ids: {},
      external_links: [
        { type: "alltrails", id: "trail/us/washington/mount-si-trail" },
        { type: "alltrails", id: "trail/us/washington/mount-si-trail" },
        { type: "bad", id: "javascript:alert(1)" },
      ],
    },
  ], 10);

  assert.deepEqual(report.destinations, {
    total: 2,
    linked: 1,
    missing: 1,
    coveragePercent: 50,
    providers: { peakbagger: 1, wikidata: 1 },
  });
  assert.equal(report.routes.linked, 1);
  assert.equal(report.routes.providers.alltrails, 1);
  assert.equal(report.destinationFeatures.summit.linked, 1);
  assert.equal(report.destinationFeatures.lake.missing, 1);
  assert.equal(report.issueCount, 2);
});
