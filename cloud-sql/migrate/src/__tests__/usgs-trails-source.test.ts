import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExactUsgsTrailObjectIds,
  buildUsgsTrailAttribution,
  buildUsgsTrailsQueryUrl,
  normalizeUsgsTrailOriginators,
  parseUsgsTrailsQueryUrl,
  USGS_TRAILS_DEFAULT_ORIGINATOR,
  USGS_TRAILS_LICENSE_NAME,
  USGS_TRAILS_LICENSE_URL,
  USGS_TRAILS_QUERY_URL,
  usgsTrailOriginatorFromProperties,
} from "../usgs-trails-source";

test("USGS trail source URLs use one canonical layer-0 query", () => {
  const url = buildUsgsTrailsQueryUrl([9, 2]);
  assert.equal(
    `${url.origin}${url.pathname}`,
    USGS_TRAILS_QUERY_URL
  );
  assert.equal(url.searchParams.get("where"), "objectid IN (2,9)");
  assert.equal(url.searchParams.get("outFields"), "*");
  assert.equal(url.searchParams.get("returnGeometry"), "true");
  assert.equal(url.searchParams.get("outSR"), "4326");
  assert.equal(url.searchParams.get("f"), "geojson");
  assert.deepEqual(parseUsgsTrailsQueryUrl(url.toString()), [2, 9]);
});

test("USGS trail source parser rejects other services and changed query shapes", () => {
  const canonical = buildUsgsTrailsQueryUrl([2, 9]);
  const otherLayer = new URL(canonical);
  otherLayer.pathname = otherLayer.pathname.replace(
    "USGSTrails/MapServer/0/query",
    "Roads/MapServer/0/query"
  );
  assert.throws(
    () => parseUsgsTrailsQueryUrl(otherLayer.toString()),
    /not the National Digital Trails layer-0 query/
  );

  for (const mutate of [
    (url: URL) => url.searchParams.set("outFields", "objectid"),
    (url: URL) => url.searchParams.set("returnGeometry", "false"),
    (url: URL) => url.searchParams.set("outSR", "3857"),
    (url: URL) => url.searchParams.set("f", "json"),
    (url: URL) => url.searchParams.set("extra", "1"),
  ]) {
    const changed = new URL(canonical);
    mutate(changed);
    assert.throws(
      () => parseUsgsTrailsQueryUrl(changed.toString()),
      /not the canonical trail query/
    );
  }
  const zero = new URL(canonical);
  zero.searchParams.set("where", "objectid IN (0)");
  assert.throws(
    () => parseUsgsTrailsQueryUrl(zero.toString()),
    /invalid object-ID query/
  );
  const duplicate = new URL(canonical);
  duplicate.searchParams.set("where", "objectid IN (2,2)");
  assert.throws(
    () => parseUsgsTrailsQueryUrl(duplicate.toString()),
    /must be unique/
  );
});

test("USGS response IDs must match the canonical query exactly", () => {
  assert.doesNotThrow(() => assertExactUsgsTrailObjectIds([9, 2], [2, 9]));
  assert.throws(
    () => assertExactUsgsTrailObjectIds([2, 9], [2, 10]),
    /returned object IDs 2,10; expected 2,9/
  );
  assert.throws(
    () => assertExactUsgsTrailObjectIds([2, 9], [2, 2]),
    /must be unique/
  );
});

test("USGS trail attribution is canonical and source-originator bound", () => {
  assert.equal(USGS_TRAILS_LICENSE_NAME, "Public domain");
  assert.match(USGS_TRAILS_LICENSE_URL, /^https:\/\/www\.usgs\.gov\//);
  assert.deepEqual(
    normalizeUsgsTrailOriginators(["Agency B", "Agency A", "Agency B"]),
    ["Agency A", "Agency B"]
  );
  assert.equal(
    buildUsgsTrailAttribution(["Agency B", "Agency A"]),
    "Agency A and Agency B via U.S. Geological Survey, The National Map"
  );
  assert.equal(
    usgsTrailOriginatorFromProperties({ SOURCEORIGINATOR: "Agency A" }),
    "Agency A"
  );
  assert.equal(
    usgsTrailOriginatorFromProperties({ sourceoriginator: null }),
    USGS_TRAILS_DEFAULT_ORIGINATOR
  );
  assert.throws(
    () => buildUsgsTrailAttribution(["Agency A\nInjected"]),
    /printable characters/
  );
});
