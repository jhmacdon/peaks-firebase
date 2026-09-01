import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RouteCard from "../components/route-card";
import { buildRouteJsonLd } from "./json-ld";
import {
  EntityOgImage,
  isPublicDomainImageAttribution,
} from "./seo-image";
import type { SearchRouteResult } from "./actions/search";

const webRoot = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

// The web build uses Next's automatic JSX transform. The lightweight tsx
// test runner uses the classic transform for imported .tsx files.
Object.assign(globalThis, { React });

test("route detail and browse queries join the single derived cover view", () => {
  const routeActions = read("lib/actions/routes.ts");
  const searchActions = read("lib/actions/search.ts");

  assert.match(routeActions, /LEFT JOIN route_cover_photos cover ON cover\.route_id = r\.id/);
  assert.equal(
    [...searchActions.matchAll(/LEFT JOIN route_cover_photos cover ON cover\.route_id = r\.id/g)]
      .length,
    2
  );
  for (const source of [routeActions, searchActions]) {
    assert.match(source, /cover\.image_url AS cover_image/);
    assert.match(source, /cover\.attribution_url AS cover_image_attribution_url/);
  }
});

test("route detail and credited cards use the derived photo", () => {
  const hero = read("components/route/route-hero.tsx");
  const card = read("components/route-card.tsx");
  const page = read("app/(public)/routes/[id]/page.tsx");
  const layout = read("app/(public)/routes/[id]/layout.tsx");
  const shareImage = read("app/(public)/routes/[id]/opengraph-image.tsx");

  assert.match(page, /route\.cover_image_attribution_url/);
  assert.match(page, /<RouteHero/);
  assert.match(hero, /src=\{cover\.url\}/);
  assert.match(hero, /href=\{cover\.attributionUrl\}/);
  assert.match(card, /src=\{route\.cover_image!?\}/);
  assert.match(layout, /image: route\.cover_image/);
  assert.match(shareImage, /isPublicDomainImageAttribution/);
  assert.match(shareImage, /imageUrl = route\.cover_image/);
});

const coveredRoute: SearchRouteResult = {
  id: "rainier-dc",
  name: "Disappointment Cleaver",
  distance: 14_000,
  gain: 2_800,
  gain_loss: 2_800,
  completion: "none",
  shape: "out_and_back",
  destination_count: 1,
  session_count: 3,
  provenance: null,
  cover_destination_id: "rainier",
  cover_destination_name: "Mount Rainier",
  cover_image: "https://upload.wikimedia.org/rainier.jpg",
  cover_image_attribution: "Jane Photographer / CC BY-SA 4.0",
  cover_image_attribution_url:
    "https://commons.wikimedia.org/wiki/File:Mount_Rainier.jpg",
  cover_image_focal_x: 48,
  cover_image_focal_y: 42,
};

test("photographed route cards render valid blocks with visible linked credit", () => {
  const html = renderToStaticMarkup(React.createElement(RouteCard, { route: coveredRoute }));

  assert.match(html, /<article/);
  assert.match(html, /href="https:\/\/commons\.wikimedia\.org\/wiki\/File:Mount_Rainier\.jpg"/);
  assert.match(html, /Jane Photographer \/ CC BY-SA 4\.0/);
  assert.match(html, /cropped/);
  assert.doesNotMatch(html, /<span[^>]*>\s*<div/);
});

test("route cards suppress a photo when its visible credit record is incomplete", () => {
  const html = renderToStaticMarkup(React.createElement(RouteCard, {
    route: { ...coveredRoute, cover_image_attribution_url: null },
  }));

  assert.doesNotMatch(html, /upload\.wikimedia\.org\/rainier\.jpg/);
});

test("standalone share images accept only explicit public-domain credits", () => {
  assert.equal(isPublicDomainImageAttribution("Jane / CC0 1.0"), true);
  assert.equal(isPublicDomainImageAttribution("Jane / Public domain"), true);
  assert.equal(isPublicDomainImageAttribution("Jane / PD-USGov"), true);
  assert.equal(isPublicDomainImageAttribution("Jane / CC BY-SA 4.0"), false);

  const html = renderToStaticMarkup(React.createElement(EntityOgImage, {
    name: "Disappointment Cleaver",
    stats: "9 mi · Mount Rainier",
    imageUrl: coveredRoute.cover_image,
    imageAttribution: "Jane / CC0 1.0",
  }));
  assert.match(html, /upload\.wikimedia\.org\/rainier\.jpg/);
  assert.match(html, /Jane \/ CC0 1\.0 · cropped/);
});

test("route structured metadata publishes the same cover URL", () => {
  assert.deepEqual(
    buildRouteJsonLd({
      name: "Disappointment Cleaver",
      url: "https://getpeaks.app/routes/disappointment-cleaver",
      image: "https://upload.wikimedia.org/rainier.jpg",
    }),
    {
      "@context": "https://schema.org",
      "@type": "Place",
      name: "Disappointment Cleaver",
      url: "https://getpeaks.app/routes/disappointment-cleaver",
      image: "https://upload.wikimedia.org/rainier.jpg",
    }
  );
});
