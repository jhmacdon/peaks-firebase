import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { catalogShareImage } from "./catalog-share-image";

const photo = {
  imageUrl: "https://storage.googleapis.com/peaks-covers/glacier.jpg?generation=2",
  attribution: "Briant Cockrum / CC BY-SA 3.0",
  attributionUrl: "https://commons.wikimedia.org/wiki/File:Glacier_Peak.jpg",
};

test("catalog shares use the existing credited photo across supported cover licenses", () => {
  for (const credit of [photo.attribution, "Jane / CC BY 4.0", "Jane / CC0", "NPS / Public domain"]) {
    const image = catalogShareImage("Glacier Peak", "/destinations/glacier", {
      ...photo,
      attribution: credit,
    });
    assert.deepEqual(image, {
      url: photo.imageUrl,
      alt: `Glacier Peak. Photo: ${credit}`,
    });
    // The original asset keeps its own size and format.
    assert.equal(image.width, undefined);
    assert.equal(image.type, undefined);
  }
});

test("missing or incomplete photos keep a named card for each catalog page", () => {
  const incompletePhotos = [
    { ...photo, imageUrl: null },
    { ...photo, imageUrl: " " },
    { ...photo, attribution: null },
    { ...photo, attribution: " " },
    { ...photo, attributionUrl: null },
    { ...photo, attributionUrl: " " },
  ];
  for (const path of ["/destinations/glacier", "/routes/glacier-standard"]) {
    for (const incomplete of incompletePhotos) {
      const image = catalogShareImage("Glacier Peak", path, incomplete);
      assert.equal(new URL(image.url).pathname, `${path}/share-image`);
      assert.equal(image.alt, "Glacier Peak on Peaks");
      assert.equal(image.width, 1200);
      assert.equal(image.height, 630);
      assert.equal(image.type, "image/png");
    }
  }
});

test("share images reject relative, local, and credential-bearing URLs", () => {
  for (const invalid of ["/cover.jpg", "not a url", "file:///cover.jpg", "data:image/png;base64,AAAA", "https://user:password@example.com/cover.jpg"]) {
    for (const field of ["imageUrl", "attributionUrl"]) {
      const image = catalogShareImage("Glacier Peak", "/destinations/glacier", {
        ...photo,
        [field]: invalid,
      });
      assert.equal(new URL(image.url).pathname, "/destinations/glacier/share-image");
    }
  }
});

test("catalog layouts publish both image tags without a file convention overriding the cover", () => {
  const app = resolve(import.meta.dirname, "../app/(public)");
  for (const segment of ["destinations", "routes"]) {
    const root = resolve(app, `${segment}/[id]`);
    const layout = readFileSync(resolve(root, "layout.tsx"), "utf8");
    assert.match(layout, /catalogShareImage\(title, canonicalPath,/);
    assert.match(layout, /openGraph:\s*\{[^}]*\bimages,/);
    assert.match(layout, /twitter:\s*\{[^}]*\bimages,/);
    assert.equal(existsSync(resolve(root, "opengraph-image.tsx")), false);
    assert.equal(existsSync(resolve(root, "share-image/route.tsx")), true);
  }
});
