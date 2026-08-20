import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAreaJsonLd,
  buildDestinationJsonLd,
  buildListJsonLd,
  buildRouteJsonLd,
  serializeJsonLd,
} from "./json-ld";

test("serializeJsonLd escapes script-breaking markup", () => {
  const data = { name: '</script><script data-test="x">&' };
  const serialized = serializeJsonLd(data);

  assert.equal(serialized.includes("<"), false);
  assert.equal(serialized.includes(">"), false);
  assert.equal(serialized.includes("&"), false);
  assert.match(serialized, /\\u003c\/script\\u003e/);
  assert.deepEqual(JSON.parse(serialized), data);
});

test("destination JSON-LD uses Mountain with geo and elevation for summits", () => {
  assert.deepEqual(
    buildDestinationJsonLd({
      name: "Mount Si",
      url: "https://getpeaks.app/destinations/mount-si",
      features: ["summit"],
      latitude: 47.4882,
      longitude: -121.7239,
      elevationMeters: 1270.2,
    }),
    {
      "@context": "https://schema.org",
      "@type": "Mountain",
      name: "Mount Si",
      url: "https://getpeaks.app/destinations/mount-si",
      geo: {
        "@type": "GeoCoordinates",
        latitude: 47.4882,
        longitude: -121.7239,
        elevation: 1270.2,
      },
    }
  );
});

test("destination JSON-LD uses Place and omits missing values", () => {
  const jsonLd = buildDestinationJsonLd({
    name: null,
    url: "https://getpeaks.app/destinations/trailhead",
    features: ["trailhead"],
    latitude: null,
    longitude: null,
    elevationMeters: null,
  });

  assert.deepEqual(jsonLd, {
    "@context": "https://schema.org",
    "@type": "Place",
    url: "https://getpeaks.app/destinations/trailhead",
  });
  assert.equal(JSON.stringify(jsonLd).includes("null"), false);
  assert.equal("features" in jsonLd, false);
});

test("area JSON-LD uses Park without exposing area codes", () => {
  assert.deepEqual(
    buildAreaJsonLd({
      name: "Mount Rainier National Park",
      url: "https://getpeaks.app/areas/mount-rainier",
      latitude: 46.85,
      longitude: -121.75,
    }),
    {
      "@context": "https://schema.org",
      "@type": "Park",
      name: "Mount Rainier National Park",
      url: "https://getpeaks.app/areas/mount-rainier",
      geo: {
        "@type": "GeoCoordinates",
        latitude: 46.85,
        longitude: -121.75,
      },
    }
  );
});

test("route JSON-LD emits only available distance values", () => {
  assert.deepEqual(
    buildRouteJsonLd({
      name: "Camp Muir Route",
      url: "https://getpeaks.app/routes/camp-muir",
      distanceMeters: 6598.2,
      gainMeters: null,
    }),
    {
      "@context": "https://schema.org",
      "@type": "Place",
      name: "Camp Muir Route",
      url: "https://getpeaks.app/routes/camp-muir",
      additionalProperty: [
        {
          "@type": "PropertyValue",
          name: "Distance",
          value: 6598.2,
          unitText: "meters",
        },
      ],
    }
  );
});

test("list JSON-LD caps itemListElement at 50 and omits missing names", () => {
  const jsonLd = buildListJsonLd({
    name: "Peak List",
    url: "https://getpeaks.app/lists/peak-list",
    numberOfItems: 52,
    items: Array.from({ length: 52 }, (_, index) => ({
      name: index === 0 ? null : `Peak ${index + 1}`,
      url: `https://getpeaks.app/destinations/${index + 1}`,
    })),
  });
  const items = jsonLd.itemListElement as Array<Record<string, unknown>>;

  assert.equal(items.length, 50);
  assert.equal(items[0].position, 1);
  assert.equal("name" in items[0], false);
  assert.equal(items[49].position, 50);
  assert.equal(jsonLd.numberOfItems, 52);
  assert.equal(JSON.stringify(jsonLd).includes("null"), false);
});

test("every JSON-LD shape survives JSON.stringify and JSON.parse", () => {
  const values = [
    buildDestinationJsonLd({
      name: "Mount Si",
      url: "https://getpeaks.app/destinations/mount-si",
      features: ["summit"],
      latitude: 47.4882,
      longitude: -121.7239,
      elevationMeters: 1270.2,
    }),
    buildAreaJsonLd({
      name: "Mount Rainier National Park",
      url: "https://getpeaks.app/areas/mount-rainier",
    }),
    buildRouteJsonLd({
      name: "Camp Muir Route",
      url: "https://getpeaks.app/routes/camp-muir",
      distanceMeters: 6598.2,
    }),
    buildListJsonLd({
      name: "Peak List",
      url: "https://getpeaks.app/lists/peak-list",
      items: [],
    }),
  ];

  for (const value of values) {
    assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
  }
});
