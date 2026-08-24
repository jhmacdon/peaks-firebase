import assert from "node:assert/strict";
import test from "node:test";

import {
  DESTINATION_SITEMAP_CHUNK_COUNT,
  DESTINATION_SITEMAP_CHUNK_SIZE,
  buildSitemapIndexXml,
  buildUrlSetXml,
  destinationSitemapChunkIndex,
  isKnownSitemapId,
  sitemapIds,
} from "./sitemap-xml";

test("the database-free sitemap roster covers the current catalog", () => {
  assert.equal(DESTINATION_SITEMAP_CHUNK_COUNT, 3);
  assert.equal(
    DESTINATION_SITEMAP_CHUNK_COUNT * DESTINATION_SITEMAP_CHUNK_SIZE,
    120_000
  );
  assert.deepEqual(sitemapIds(), [
    "destinations-0",
    "destinations-1",
    "destinations-2",
    "areas",
    "routes",
    "lists",
    "landing",
    "static",
  ]);
});

test("destination sitemap IDs are bounded to the published roster", () => {
  assert.equal(destinationSitemapChunkIndex("destinations-0"), 0);
  assert.equal(destinationSitemapChunkIndex("destinations-2"), 2);
  assert.equal(destinationSitemapChunkIndex("destinations-3"), null);
  assert.equal(destinationSitemapChunkIndex("destinations-nope"), null);
  assert.equal(isKnownSitemapId("areas"), true);
  assert.equal(isKnownSitemapId("unknown"), false);
});

test("sitemap XML escapes URLs and keeps accurate modification dates", () => {
  const index = buildSitemapIndexXml([
    "https://getpeaks.app/sitemap/landing.xml?x=1&y=2",
  ]);
  const urls = buildUrlSetXml([
    {
      url: "https://getpeaks.app/areas/a&b",
      lastModified: new Date("2026-08-23T12:00:00Z"),
    },
    { url: "https://getpeaks.app/about", lastModified: "not-a-date" },
  ]);

  assert.match(index, /x=1&amp;y=2/);
  assert.match(urls, /areas\/a&amp;b/);
  assert.match(urls, /<lastmod>2026-08-23T12:00:00\.000Z<\/lastmod>/);
  assert.equal((urls.match(/<lastmod>/g) ?? []).length, 1);
});
