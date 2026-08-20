import assert from "node:assert/strict";
import test from "node:test";

import { buildDiscoverHref, parseSearchScope } from "./discover-search";

test("parseSearchScope accepts the five real scopes", () => {
  assert.equal(parseSearchScope("all"), "all");
  assert.equal(parseSearchScope("destinations"), "destinations");
  assert.equal(parseSearchScope("areas"), "areas");
  assert.equal(parseSearchScope("routes"), "routes");
  assert.equal(parseSearchScope("lists"), "lists");
});

test("parseSearchScope falls back to all for anything else", () => {
  assert.equal(parseSearchScope(null), "all");
  assert.equal(parseSearchScope(undefined), "all");
  assert.equal(parseSearchScope(""), "all");
  assert.equal(parseSearchScope("peaks"), "all");
  assert.equal(parseSearchScope("__proto__"), "all");
});

test("buildDiscoverHref returns the bare path when nothing is set", () => {
  assert.equal(buildDiscoverHref(""), "/discover");
  assert.equal(buildDiscoverHref("", { query: null, scope: null }), "/discover");
});

test("buildDiscoverHref trims the query and drops it when blank", () => {
  assert.equal(buildDiscoverHref("", { query: "  Mount Rainier " }), "/discover?q=Mount+Rainier");
  assert.equal(buildDiscoverHref("q=rainier", { query: "   " }), "/discover");
  assert.equal(buildDiscoverHref("q=rainier", { query: null }), "/discover");
});

test("buildDiscoverHref keeps the default scope out of the URL", () => {
  assert.equal(buildDiscoverHref("q=rainier", { scope: "all" }), "/discover?q=rainier");
  assert.equal(buildDiscoverHref("q=rainier&type=routes", { scope: "all" }), "/discover?q=rainier");
  assert.equal(
    buildDiscoverHref("q=rainier", { scope: "routes" }),
    "/discover?q=rainier&type=routes"
  );
});

test("buildDiscoverHref leaves params it was not asked to change", () => {
  assert.equal(buildDiscoverHref("q=rainier&type=lists"), "/discover?q=rainier&type=lists");
  assert.equal(
    buildDiscoverHref("q=rainier&type=lists", { query: "hood" }),
    "/discover?q=hood&type=lists"
  );
  assert.equal(
    buildDiscoverHref("?q=rainier&ref=nav", { scope: "areas" }),
    "/discover?q=rainier&ref=nav&type=areas"
  );
});
