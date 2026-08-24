import assert from "node:assert/strict";
import test from "node:test";
import { areaCoverPhotoFor, areaCoverPhotoSql } from "./area-cover-photo";

test("area cover lookup runs only after areas have been ranked", () => {
  const sql = areaCoverPhotoSql();

  assert.match(sql, /FROM ranked/);
  assert.match(sql, /JOIN destinations d ON d\.id = da\.destination_id/);
  assert.match(sql, /d\.owner = 'peaks'/);
  assert.match(sql, /d\.prominence DESC NULLS LAST/);
  assert.doesNotMatch(sql, /to_jsonb|boundary/);
});

test("area cover rows keep safe credits and bounded crop points", () => {
  assert.deepEqual(
    areaCoverPhotoFor("another-area", {
      cover_image_url: "https://example.com/area.jpg",
      cover_image_focal_x: 140,
      cover_image_focal_y: "-8",
      cover_image_attribution: "A. Walker · CC BY 4.0",
      cover_image_attribution_url: "https://commons.wikimedia.org/wiki/File:Area.jpg",
    }),
    {
      imageUrl: "https://example.com/area.jpg",
      focalX: 100,
      focalY: 0,
      attribution: "A. Walker · CC BY 4.0",
      attributionUrl: "https://commons.wikimedia.org/wiki/File:Area.jpg",
    }
  );

  assert.equal(areaCoverPhotoFor("another-area", { cover_image_url: "" }), null);
});

test("a curated area cover wins over a linked destination photo", () => {
  const cover = areaCoverPhotoFor("padus-96976ad47b6e7a6cda92", {
    cover_image_url: "https://example.com/destination.jpg",
  });

  assert.match(cover?.imageUrl ?? "", /Coon_bluff_after_rain_1/);
  assert.equal(cover?.attribution, "Mkling98 · CC0");
});
