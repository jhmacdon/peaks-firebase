import assert from "node:assert/strict";
import test from "node:test";
import {
  canCollectAnalytics,
  pageViewProperties,
  pathOnly,
  petricsOptions,
  referrerHost,
} from "./analytics-core";

test("Petrics stays off without a source key", () => {
  assert.equal(petricsOptions({}, true), null);
  assert.equal(petricsOptions({ sourceKey: "  " }, true), null);
});

test("Petrics stays off when collection is not allowed", () => {
  assert.equal(petricsOptions({ sourceKey: "ptr_v1_key" }, false), null);
});

test("Petrics builds web options from the env", () => {
  assert.deepEqual(petricsOptions({ sourceKey: " ptr_v1_key " }, true), {
    sourceKey: "ptr_v1_key",
    platform: "web",
  });
  assert.deepEqual(
    petricsOptions({ sourceKey: "ptr_v1_key", endpoint: "https://collector.example" }, true),
    { sourceKey: "ptr_v1_key", endpoint: "https://collector.example", platform: "web" },
  );
});

test("Petrics never collects on the server or in tests", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(canCollectAnalytics(), false);
});

test("pageView properties drop the query string and fragment", () => {
  assert.equal(pathOnly("/lists/abc?email=a@b.c#top"), "/lists/abc");
  assert.equal(pathOnly("/routes/r1#map"), "/routes/r1");
  assert.equal(pathOnly("?q=1"), "/");
  assert.deepEqual(
    pageViewProperties("/discover?q=me@example.com", "Discover | Peaks", ""),
    { path: "/discover", title: "Discover | Peaks" },
  );
});

test("pageView properties keep only the referrer host", () => {
  assert.equal(referrerHost("https://www.google.com/search?q=mount+rainier"), "www.google.com");
  assert.equal(referrerHost("http://localhost:3000/login?next=/log"), "localhost:3000");
  assert.equal(referrerHost(""), undefined);
  assert.equal(referrerHost("not a url"), undefined);
  assert.deepEqual(
    pageViewProperties("/map", "", "https://news.ycombinator.com/item?id=1"),
    { path: "/map", referrer_host: "news.ycombinator.com" },
  );
});
