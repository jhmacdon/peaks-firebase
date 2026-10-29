import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../../next.config";
import { catalogPageMetadata, catalogPageNumber, catalogPagePath } from "./catalog-seo";
import { getSiteUrl } from "./seo";

test("pagination has distinct canonical pages and normalizes page one", () => {
  assert.equal(catalogPagePath("/lists", 1), "/lists");
  assert.equal(catalogPagePath("/lists", 2), "/lists?page=2");
  assert.equal(catalogPagePath("/areas", 2, { state: "WA", q: "Mount & lake", type: "" }), "/areas?q=Mount+%26+lake&state=WA&page=2");
  for (const input of [undefined, "", "-1", "2abc", "NaN", "1.5", "Infinity"]) {
    assert.equal(catalogPageNumber(input), 1);
  }
  assert.equal(catalogPageNumber(["2", "3"]), 2);
  assert.equal(catalogPageNumber("999999"), 10_000);
});

test("catalog metadata keeps pagination indexable and search results noindex", () => {
  const input = { path: "/lists", title: "Peak lists", description: "Browse mountain lists.", page: 2 };
  const page = catalogPageMetadata(input);
  assert.equal(page.title, "Peak lists — Page 2");
  assert.match(String(page.alternates?.canonical), /\/lists\?page=2$/);
  assert.equal(page.robots, undefined);
  assert.ok(page.openGraph?.images);
  assert.ok(page.twitter?.images);
  const search = catalogPageMetadata({ ...input, filters: { q: "Rainier" }, noindex: true });
  assert.deepEqual(search.robots, { index: false, follow: true });
  assert.match(String(search.alternates?.canonical), /q=Rainier&page=2$/);
});

test("Discover search headers leave the bare browse URL crawlable", async () => {
  const rules = (await nextConfig.headers!()).filter((rule) => rule.source === "/discover");
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    assert.deepEqual(rule.headers, [{ key: "X-Robots-Tag", value: "noindex, follow" }]);
    assert.equal(rule.has?.[0].type, "query");
    assert.equal(rule.has?.[0].value, ".+");
  }
  assert.ok(rules.some((rule) => rule.has?.[0].key === "q"));
  assert.ok(rules.some((rule) => rule.has?.[0].key === "nearLat"));
});

test("canonical origin defaults to production, never an incidental preview host", (t) => {
  const original = { site: process.env.NEXT_PUBLIC_SITE_URL, preview: process.env.VERCEL_URL };
  t.after(() => {
    if (original.site === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original.site;
    if (original.preview === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = original.preview;
  });
  delete process.env.NEXT_PUBLIC_SITE_URL;
  process.env.VERCEL_URL = "preview.example.test";
  assert.equal(getSiteUrl().origin, "https://getpeaks.app");
  process.env.NEXT_PUBLIC_SITE_URL = " getpeaks.app/path?tracking=true ";
  assert.equal(getSiteUrl().href, "https://getpeaks.app/");
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  assert.equal(getSiteUrl().origin, "http://localhost:3000");
});
