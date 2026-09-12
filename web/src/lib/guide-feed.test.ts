import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/guides/route";
import { GUIDES } from "./guides";
import { FIRE_LOOKOUT_QUERY } from "./fire-lookouts";

test("native guide feed returns the exact web catalog without a database", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600, s-maxage=3600");
  const { guides } = await response.json();
  assert.deepEqual(guides, GUIDES);
  for (const guide of guides) {
    assert.equal(typeof guide.intro, "string");
    assert.ok(guide.subtitle.length > 0);
    assert.ok(guide.href.startsWith("/") && !guide.href.startsWith("//"));
    for (const section of guide.sections) {
      assert.ok(section.paragraphs.every((paragraph: unknown) => typeof paragraph === "string"));
      assert.equal(new URL(section.source.url).protocol, "https:");
    }
  }
});

test("both state lookout chapters have distinct canonical destinations", () => {
  for (const state of ["california", "washington"]) {
    const guide = GUIDES.find((entry) => entry.slug === `${state}-fire-lookouts`);
    assert.equal(guide?.href, `/fire-lookouts/${state}`);
  }
  assert.match(FIRE_LOOKOUT_QUERY, /country_code = \$1 AND state_code = \$2/);
  assert.match(FIRE_LOOKOUT_QUERY, /features @> ARRAY\['fire-lookout'\]/);
});
