import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildDestinationDetailQuery,
  mapDestinationDetailRow,
} from "../routes/destinations";

test("destination detail query selects place copy + source credit columns", () => {
  const query = buildDestinationDetailQuery("dest-1");

  assert.match(query.text, /d\.description\b/);
  assert.match(query.text, /d\.description_source_name/);
  assert.match(query.text, /d\.description_source_url/);
  assert.match(query.text, /d\.description_source_license/);
  assert.deepEqual(query.values, ["dest-1"]);
});

test("destination detail query serializes massif_boundary as embedded GeoJSON", () => {
  const query = buildDestinationDetailQuery("dest-1");

  // The ::json cast is load-bearing: without it the column arrives as a
  // JSON *string* and the iOS boundary parser silently yields nil.
  assert.match(
    query.text,
    /CASE WHEN d\.massif_boundary IS NOT NULL\s+THEN ST_AsGeoJSON\(d\.massif_boundary\)::json END AS massif_boundary/
  );
});

test("mapDestinationDetailRow leaves populated place copy untouched", () => {
  const row: any = {
    id: "dest-1",
    name: "Mount Rainier",
    description: "Mount Rainier is a stratovolcano in the Cascade Range.",
    description_source_name: "Wikipedia",
    description_source_url: "https://en.wikipedia.org/wiki/Mount_Rainier",
    description_source_license: "CC BY-SA 4.0",
    massif_boundary: { type: "Polygon", coordinates: [[[-121.6, 46.8], [-121.6, 46.9], [-121.9, 46.9], [-121.6, 46.8]]] },
    areas: [],
  };

  const mapped = mapDestinationDetailRow(row);

  assert.equal(mapped.description, "Mount Rainier is a stratovolcano in the Cascade Range.");
  assert.equal(mapped.description_source_name, "Wikipedia");
  assert.equal(mapped.description_source_url, "https://en.wikipedia.org/wiki/Mount_Rainier");
  assert.equal(mapped.description_source_license, "CC BY-SA 4.0");
  assert.equal(mapped.massif_boundary.type, "Polygon");
});

test("mapDestinationDetailRow normalizes blank place copy to null", () => {
  const row: any = {
    id: "dest-2",
    name: "Nameless Bump",
    description: "   ",
    description_source_name: "",
    description_source_url: null,
    description_source_license: undefined,
    massif_boundary: null,
    areas: [],
  };

  const mapped = mapDestinationDetailRow(row);

  assert.equal(mapped.description, null);
  assert.equal(mapped.description_source_name, null);
  assert.equal(mapped.description_source_url, null);
  assert.equal(mapped.description_source_license, null);
  assert.equal(mapped.massif_boundary, null);
});

test("place copy without a source URL is dropped entirely (licensing guard)", () => {
  const row: any = {
    id: "dest-3",
    name: "Unsourced Peak",
    description: "Some copy with no provenance.",
    description_source_name: null,
    description_source_url: null,
    description_source_license: null,
    areas: [],
  };

  const mapped = mapDestinationDetailRow(row);

  assert.equal(
    mapped.description,
    null,
    "Copy we cannot credit must not be served — the client has no way to attribute it."
  );
  assert.equal(mapped.massif_boundary, null);
});

test("place copy without a license string is dropped (full credit required)", () => {
  const row: any = {
    id: "dest-4",
    name: "Unlicensed Peak",
    description: "Copy with a source but no license.",
    description_source_name: "Wikipedia",
    description_source_url: "https://en.wikipedia.org/wiki/Unlicensed_Peak",
    description_source_license: null,
    areas: [],
  };

  const mapped = mapDestinationDetailRow(row);

  assert.equal(
    mapped.description,
    null,
    "Full credit is name AND url AND license — a missing license means the copy cannot be served."
  );
  assert.equal(mapped.description_source_name, "Wikipedia");
  assert.equal(
    mapped.description_source_url,
    "https://en.wikipedia.org/wiki/Unlicensed_Peak"
  );
  assert.equal(mapped.description_source_license, null);
});

test("destination detail query selects the hero image and its credit columns", () => {
  const query = buildDestinationDetailQuery("dest-1");

  assert.match(query.text, /d\.hero_image\b/);
  assert.match(query.text, /d\.hero_image_attribution\b/);
  assert.match(query.text, /d\.hero_image_attribution_url\b/);
  assert.match(query.text, /d\.hero_image_focal_x\b/);
  assert.match(query.text, /d\.hero_image_focal_y\b/);
});

test("an uncredited hero image is dropped whole, and the copy is left alone", () => {
  // The shape every legacy import leaves behind — CAI huts and the OSM
  // imports wrote a photo URL and no credit at all.
  const row: any = {
    id: "dest-hut",
    name: "Rifugio Senza Credito",
    description: "A hut on the ridge.",
    description_source_name: "Wikipedia",
    description_source_url: "https://en.wikipedia.org/wiki/Rifugio",
    description_source_license: "CC BY-SA 4.0",
    hero_image: "https://upload.wikimedia.org/rifugio.jpg",
    hero_image_attribution: null,
    hero_image_attribution_url: null,
    hero_image_focal_x: 20,
    hero_image_focal_y: 30,
    areas: [],
  };

  const mapped = mapDestinationDetailRow(row);

  assert.equal(
    mapped.hero_image,
    null,
    "A photo we cannot credit must not be served — the header would show it uncredited."
  );
  assert.equal(mapped.hero_image_attribution, null);
  assert.equal(mapped.hero_image_attribution_url, null);
  assert.equal(mapped.hero_image_focal_x, 50);
  assert.equal(mapped.hero_image_focal_y, 50);
  assert.equal(
    mapped.description,
    "A hut on the ridge.",
    "The photo guard and the copy guard are separate — a bad photo must not take the copy with it."
  );
});

test("a fully credited hero image passes through", () => {
  const row: any = {
    id: "dest-rainier",
    name: "Mount Rainier",
    description: null,
    description_source_name: null,
    description_source_url: null,
    description_source_license: null,
    hero_image: "https://upload.wikimedia.org/rainier.jpg",
    hero_image_attribution: "A Photographer, CC BY-SA 4.0",
    hero_image_attribution_url: "https://commons.wikimedia.org/wiki/File:Rainier.jpg",
    hero_image_focal_x: 35,
    hero_image_focal_y: 15,
    areas: [],
  };

  const mapped = mapDestinationDetailRow(row);

  assert.equal(mapped.hero_image, "https://upload.wikimedia.org/rainier.jpg");
  assert.equal(mapped.hero_image_attribution, "A Photographer, CC BY-SA 4.0");
  assert.equal(mapped.hero_image_focal_x, 35);
  assert.equal(mapped.hero_image_focal_y, 15);
  assert.equal(
    mapped.hero_image_attribution_url,
    "https://commons.wikimedia.org/wiki/File:Rainier.jpg"
  );
});

test("a hero image with an artist but no source URL is dropped (both halves required)", () => {
  const row: any = {
    id: "dest-half-credit",
    name: "Half Credit Peak",
    hero_image: "https://upload.wikimedia.org/half.jpg",
    hero_image_attribution: "A Photographer, CC BY-SA 4.0",
    hero_image_attribution_url: "   ",
    areas: [],
  };

  const mapped = mapDestinationDetailRow(row);

  assert.equal(
    mapped.hero_image,
    null,
    "A blank URL normalizes to null, so the credit is incomplete and the photo goes with it."
  );
  assert.equal(mapped.hero_image_attribution, null);
  assert.equal(mapped.hero_image_attribution_url, null);
});
