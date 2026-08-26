import assert from "node:assert/strict";
import test from "node:test";
import {
  areaCoverPhotoFor,
  areaCoverPhotoSql,
  distinctAreaCoverPhotosFor,
} from "./area-cover-photo";

test("area cover lookup runs only after areas have been ranked", () => {
  const sql = areaCoverPhotoSql();

  assert.match(sql, /FROM ranked/);
  assert.match(sql, /JOIN destinations d ON d\.id = da\.destination_id/);
  assert.match(sql, /d\.owner = 'peaks'/);
  assert.match(sql, /d\.prominence DESC NULLS LAST/);
  assert.match(sql, /cover_photo_candidates/);
  assert.match(sql, /LIMIT 12/);
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

test("area cover rows read and sanitize ranked photo candidates", () => {
  assert.deepEqual(
    areaCoverPhotoFor("another-area", {
      cover_photo_candidates: [
        {
          imageUrl: "https://example.com/first.jpg",
          focalX: -2,
          focalY: 108,
          attribution: "A. Hiker · CC BY 4.0",
          attributionUrl: "javascript:alert(1)",
        },
        { imageUrl: "" },
      ],
    }),
    {
      imageUrl: "https://example.com/first.jpg",
      focalX: 0,
      focalY: 100,
      attribution: "A. Hiker · CC BY 4.0",
      attributionUrl: null,
    }
  );
});

test("distinct area covers move a flexible area to its next choice", () => {
  const shared = {
    imageUrl: "https://example.com/shared.jpg",
    focalX: 50,
    focalY: 50,
  };
  const alternate = {
    imageUrl: "https://example.com/alternate.jpg",
    focalX: 50,
    focalY: 50,
  };

  const covers = distinctAreaCoverPhotosFor([
    {
      areaId: "flexible-area",
      row: { cover_photo_candidates: [shared, alternate] },
    },
    {
      areaId: "shared-only-area",
      row: { cover_photo_candidates: [shared] },
    },
  ]);

  assert.equal(covers[0]?.imageUrl, alternate.imageUrl);
  assert.equal(covers[1]?.imageUrl, shared.imageUrl);
});

test("distinct area covers prefer the icon card over a repeated photo", () => {
  const shared = {
    imageUrl: "https://example.com/shared.jpg",
    focalX: 50,
    focalY: 50,
  };
  const covers = distinctAreaCoverPhotosFor([
    { areaId: "first-area", row: { cover_photo_candidates: [shared] } },
    { areaId: "second-area", row: { cover_photo_candidates: [shared] } },
  ]);

  assert.equal(covers[0]?.imageUrl, shared.imageUrl);
  assert.equal(covers[1], null);
});

test("Wikimedia thumbnail sizes count as one photo", () => {
  const sharedLarge = {
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Peak.jpg/1920px-Peak.jpg",
    focalX: 50,
    focalY: 50,
  };
  const sharedSmall = {
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Peak.jpg/1280px-Peak.jpg",
    focalX: 50,
    focalY: 50,
  };
  const alternate = {
    imageUrl: "https://example.com/other.jpg",
    focalX: 50,
    focalY: 50,
  };
  const covers = distinctAreaCoverPhotosFor([
    {
      areaId: "first-area",
      row: { cover_photo_candidates: [sharedLarge, alternate] },
    },
    { areaId: "second-area", row: { cover_photo_candidates: [sharedSmall] } },
  ]);

  assert.equal(covers[0]?.imageUrl, alternate.imageUrl);
  assert.equal(covers[1]?.imageUrl, sharedSmall.imageUrl);
});
