import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildRouteJsonLd } from "./json-ld";

const webRoot = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

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

test("route detail, cards, and share image use the derived photo", () => {
  const hero = read("components/route/route-hero.tsx");
  const card = read("components/route-card.tsx");
  const page = read("app/(public)/routes/[id]/page.tsx");
  const layout = read("app/(public)/routes/[id]/layout.tsx");
  const shareImage = read("app/(public)/routes/[id]/opengraph-image.tsx");

  assert.match(page, /route\.cover_image_attribution_url/);
  assert.match(page, /<RouteHero/);
  assert.match(hero, /src=\{cover\.url\}/);
  assert.match(hero, /href=\{cover\.attributionUrl\}/);
  assert.match(card, /src=\{route\.cover_image\}/);
  assert.match(layout, /image: route\.cover_image/);
  assert.match(shareImage, /imageUrl = route\.cover_image/);
  assert.match(shareImage, /imageAttribution = route\.cover_image_attribution/);
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
