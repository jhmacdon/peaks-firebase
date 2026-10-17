import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import sharp from "sharp";
import request from "supertest";
import db from "../db";
import { app } from "../index";
import {
  COVER_UPLOAD_MAX_BYTES,
  CoverPhotoError,
  renderCoverPhoto,
  validateUploadPath,
  withCoverProcessingLock,
  type CoverStorage,
} from "../lib/cover-photo";
import { routeCoverOriginSql } from "../lib/route-cover";
import { parseCoverBody, setCoverStorageFactoryForTests } from "../routes/admin";
import { dbSkipReason as skipReason } from "./helpers/test-db";

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 120, b: 110 } },
  })
    .jpeg()
    .toBuffer();
}

/**
 * The shipped iOS decoder, RouteCoverPhoto.from(apiObject:) in
 * ios/Peaks-iOS/peakscore/PeaksModels/Route.swift. It returns nil (no cover)
 * unless cover_destination_id is a non-empty string, cover_image and
 * cover_image_attribution_url are https URLs, cover_image_attribution is
 * non-empty, and each focal value is absent or 0-100.
 */
function shippedIosRouteCover(d: Record<string, unknown>): { destinationID: string; imageURL: string } | null {
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const https = (value: unknown) => {
    const string = text(value);
    if (!string) return null;
    try {
      return new URL(string).protocol === "https:" ? string : null;
    } catch {
      return null;
    }
  };
  const focalOk = (value: unknown) =>
    value === null || value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
  const destinationID = text(d.cover_destination_id);
  const imageURL = https(d.cover_image);
  if (!destinationID || !imageURL || !text(d.cover_image_attribution) || !https(d.cover_image_attribution_url)) {
    return null;
  }
  if (!focalOk(d.cover_image_focal_x) || !focalOk(d.cover_image_focal_y)) return null;
  return { destinationID, imageURL };
}

class FakeStorage implements CoverStorage {
  readonly bucketName = "peaks-test.appspot.com";
  objects = new Map<string, { data: Buffer; contentType: string; generation: string }>();
  removed: string[] = [];
  private nextGeneration = 1;
  /** Runs between stat and download, to simulate a concurrent overwrite. */
  beforeDownload: (() => void) | null = null;
  put(objectName: string, data: Buffer, contentType: string) {
    this.objects.set(objectName, { data, contentType, generation: String(this.nextGeneration++) });
  }
  async stat(objectName: string) {
    const object = this.objects.get(objectName);
    return object
      ? { contentType: object.contentType, size: object.data.byteLength, generation: object.generation }
      : null;
  }
  async download(objectName: string, generation: string | null) {
    this.beforeDownload?.();
    this.beforeDownload = null;
    const object = this.objects.get(objectName);
    if (!object || (generation && object.generation !== generation)) {
      throw new CoverPhotoError(422, "Uploaded image changed or vanished; upload it again");
    }
    return object.data;
  }
  async save(objectName: string, data: Buffer) {
    this.put(objectName, data, "image/jpeg");
  }
  async remove(objectName: string, generation?: string | null) {
    const object = this.objects.get(objectName);
    if (object && generation && object.generation !== generation) return;
    this.removed.push(objectName);
    this.objects.delete(objectName);
  }
}

const storage = new FakeStorage();
setCoverStorageFactoryForTests(() => storage);

describe("admin cover input checks", () => {
  test("upload path must sit directly under the matching prefix", () => {
    assert.equal(validateUploadPath("routes", "r1", "covers/routes/r1/abc.jpg"), "covers/routes/r1/abc.jpg");
    for (const bad of [
      "covers/routes/r2/abc.jpg",
      "covers/destinations/r1/abc.jpg",
      "covers/routes/r1/nested/abc.jpg",
      "covers/routes/r1/",
      "covers/routes/r1/..",
      "covers/routes/r1/.hidden",
      "trip-reports/u/s/abc.jpg",
      42,
      undefined,
    ]) {
      assert.throws(() => validateUploadPath("routes", "r1", bad), CoverPhotoError, String(bad));
    }
  });

  test("body defaults focal points and checks credit fields", () => {
    assert.deepEqual(parseCoverBody("destinations", "d1", { storagePath: "covers/destinations/d1/x.jpg" }), {
      storagePath: "covers/destinations/d1/x.jpg",
      attribution: null,
      attributionUrl: null,
      focalX: 50,
      focalY: 50,
    });
    assert.equal(
      parseCoverBody("routes", "r1", { storagePath: "covers/routes/r1/x.jpg", focalX: 33.4, focalY: 0 }).focalX,
      33
    );
    assert.throws(() => parseCoverBody("routes", "r1", { storagePath: "covers/routes/r1/x.jpg", focalX: 101 }), /focalX/);
    assert.throws(
      () => parseCoverBody("routes", "r1", { storagePath: "covers/routes/r1/x.jpg", attributionUrl: "http://x.org" }),
      /https/
    );
    assert.throws(() => parseCoverBody("routes", "r1", { storagePath: "covers/routes/r1/x.jpg", attribution: 5 }), /attribution/);
  });

  test("rendering enforces format, minimum size, and caps the long edge at 2400 px", async () => {
    await assert.rejects(renderCoverPhoto(await jpeg(1200, 900)), /at least 1600×900/);
    await assert.rejects(renderCoverPhoto(Buffer.from("not an image")), /not a readable image/);
    const tiff = await sharp({ create: { width: 1700, height: 1000, channels: 3, background: "#123" } }).tiff().toBuffer();
    await assert.rejects(renderCoverPhoto(tiff), (error: CoverPhotoError) => error.status === 415);
    const rendered = await renderCoverPhoto(await jpeg(3200, 1800));
    assert.equal(rendered.width, 2400);
    assert.equal(rendered.height, 1350);
    const metadata = await sharp(rendered.data).metadata();
    assert.equal(metadata.format, "jpeg");
  });

  test("processing runs one image at a time per process", async () => {
    let running = 0;
    let peak = 0;
    const task = () =>
      withCoverProcessingLock(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running -= 1;
      });
    await Promise.all([task(), task(), task(), withCoverProcessingLock(async () => { throw new Error("x"); }).catch(() => undefined), task()]);
    assert.equal(peak, 1);
  });

  test("the route origin read survives a database without the new column", () => {
    assert.equal(routeCoverOriginSql(), "(to_jsonb(cover) ->> 'origin')");
  });
});

describe("admin cover auth", () => {
  test("unauthenticated requests are rejected", async () => {
    const response = await request(app).put("/api/admin/routes/r1/cover").send({});
    assert.equal(response.status, 401);
  });

  test("a signed-in user without the admin claim gets 403", async () => {
    for (const [method, path] of [
      ["put", "/api/admin/routes/r1/cover"],
      ["delete", "/api/admin/routes/r1/cover"],
      ["put", "/api/admin/destinations/d1/cover"],
      ["delete", "/api/admin/destinations/d1/cover"],
    ] as const) {
      const response = await request(app)[method](path).set("X-Test-User", "not-admin").send({});
      assert.equal(response.status, 403, `${method} ${path}`);
      assert.deepEqual(response.body, { error: "Admin access required" });
    }
  });

  test("an admin with a bad storage path gets 400 before any lookup", async () => {
    const response = await request(app)
      .put("/api/admin/routes/r1/cover")
      .set("X-Test-User", "admin-user")
      .set("X-Test-Admin", "true")
      .send({ storagePath: "covers/routes/other/x.jpg" });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /covers\/routes\/r1\//);
  });
});

const prefix = `admin-cover-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const routeId = `${prefix}-route`;
const destinationId = `${prefix}-destination`;
const objectiveId = `${prefix}-objective`;
const admin = { "X-Test-User": `${prefix}-admin`, "X-Test-Admin": "true", "X-Test-Name": "Josiah McDonald" };

function upload(kind: "routes" | "destinations", id: string, name: string, data: Buffer, contentType = "image/jpeg") {
  const path = `covers/${kind}/${id}/${name}`;
  storage.put(path, data, contentType);
  return path;
}

describe("admin cover endpoints", { skip: skipReason ?? undefined }, () => {
  async function cleanup() {
    await db.query("DELETE FROM routes WHERE id = $1", [routeId]);
    await db.query("DELETE FROM destinations WHERE id = ANY($1)", [[destinationId, objectiveId]]);
  }

  before(async () => {
    await cleanup();
    await db.query(
      `INSERT INTO destinations (id, name, search_name, features, hero_image, hero_image_attribution,
                                 hero_image_attribution_url, hero_image_focal_x)
       VALUES ($1, 'Cover Peak', 'cover peak', ARRAY['summit']::destination_feature[],
               'https://example.org/reviewed.jpg', 'Reviewed Photographer', 'https://example.org/reviewed', 70),
              ($2, 'Cover Lake', 'cover lake', ARRAY['lake']::destination_feature[], NULL, NULL, NULL, 50)`,
      [destinationId, objectiveId]
    );
    await db.query(`INSERT INTO routes (id, name, status) VALUES ($1, 'Cover Route', 'active')`, [routeId]);
    await db.query(
      `INSERT INTO route_destinations (route_id, destination_id, ordinal) VALUES ($1, $2, 0)`,
      [routeId, destinationId]
    );
  });

  after(cleanup);

  test("the origin read yields null, not an error, on a view without the column", async () => {
    const result = await db.query(
      `SELECT ${routeCoverOriginSql()} AS origin
       FROM (SELECT 'r' AS route_id, 'https://example.org/x.jpg' AS image_url) cover`
    );
    assert.equal(result.rows[0].origin, null);
  });

  test("a route falls back to its place's cover until it has its own", async () => {
    const response = await request(app).get(`/api/routes/${routeId}`).set("X-Test-User", admin["X-Test-User"]);
    assert.equal(response.status, 200);
    assert.equal(response.body.cover_image, "https://example.org/reviewed.jpg");
    assert.equal(response.body.cover_image_origin, "destination");
    assert.equal(response.body.cover_destination_id, destinationId);
    assert.ok(shippedIosRouteCover(response.body));
  });

  test("refused uploads get 415 or 422 and are deleted", async () => {
    const send = (storagePath: string) =>
      request(app).put(`/api/admin/routes/${routeId}/cover`).set(admin).send({ storagePath });
    assert.equal((await send(`covers/routes/${routeId}/missing.jpg`)).status, 422);

    const heic = upload("routes", routeId, "photo.heic", Buffer.from("ftypheic"), "image/heic");
    const heicResponse = await send(heic);
    assert.equal(heicResponse.status, 415);
    assert.match(heicResponse.body.error, /JPEG, PNG or WebP/);
    assert.ok(!storage.objects.has(heic), "a refused HEIC upload is deleted");

    const text = upload("routes", routeId, "notes.txt", Buffer.from("hello"), "text/plain");
    assert.equal((await send(text)).status, 415);

    const disguised = upload("routes", routeId, "disguised.jpg", Buffer.from("not really a jpeg"));
    assert.equal((await send(disguised)).status, 422);
    assert.ok(!storage.objects.has(disguised));

    const huge = upload("routes", routeId, "huge.jpg", Buffer.alloc(COVER_UPLOAD_MAX_BYTES + 1));
    assert.match((await send(huge)).body.error, /larger than 15 MB/);
    assert.ok(!storage.objects.has(huge));

    const small = upload("routes", routeId, "small.jpg", await jpeg(800, 600));
    const smallResponse = await send(small);
    assert.equal(smallResponse.status, 422);
    assert.match(smallResponse.body.error, /at least 1600×900/);
    assert.ok(!storage.objects.has(small), "a refused upload with EXIF data does not linger");
  });

  test("an upload replaced between the check and the download is refused", async () => {
    const path = upload("routes", routeId, "swap.jpg", await jpeg(1600, 900));
    storage.beforeDownload = () => storage.put(path, Buffer.from("swapped"), "image/jpeg");
    const response = await request(app)
      .put(`/api/admin/routes/${routeId}/cover`)
      .set(admin)
      .send({ storagePath: path });
    assert.equal(response.status, 422);
    assert.match(response.body.error, /changed or vanished/);
    assert.ok(storage.objects.has(path), "the newer upload is not deleted");
    storage.objects.delete(path);
  });

  test("an unknown route is 404", async () => {
    const response = await request(app)
      .put(`/api/admin/routes/${prefix}-nope/cover`)
      .set(admin)
      .send({ storagePath: `covers/routes/${prefix}-nope/a.jpg` });
    assert.equal(response.status, 404);
  });

  test("PUT sets the route's own cover; shipped iOS still decodes it", async () => {
    const path = upload("routes", routeId, "first.jpg", await jpeg(4000, 3000));
    const response = await request(app)
      .put(`/api/admin/routes/${routeId}/cover`)
      .set(admin)
      .send({ storagePath: path, focalX: 30, focalY: 60 });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.id, routeId);
    assert.equal(response.body.cover_image_origin, "route");
    // No objective: the top-ranked linked place names the cover.
    assert.equal(response.body.cover_destination_id, destinationId);
    assert.equal(response.body.cover_destination_name, "Cover Peak");
    assert.equal(response.body.cover_image_attribution, "Josiah McDonald · Peaks");
    assert.equal(response.body.cover_image_attribution_url, response.body.cover_image);
    assert.match(
      response.body.cover_image,
      new RegExp(`^https://firebasestorage\\.googleapis\\.com/v0/b/peaks-test\\.appspot\\.com/o/route-covers%2F${routeId}%2Fadmin-`)
    );
    assert.equal(response.body.cover_image_focal_x, 30);
    assert.equal(response.body.cover_image_focal_y, 60);
    assert.ok(storage.removed.includes(path), "the original upload is removed");
    assert.deepEqual(shippedIosRouteCover(response.body), {
      destinationID: destinationId,
      imageURL: response.body.cover_image,
    });

    const row = (await db.query(
      `SELECT cover_source, cover_storage_path, cover_updated_at FROM routes WHERE id = $1`,
      [routeId]
    )).rows[0];
    assert.equal(row.cover_source, "admin");
    assert.match(row.cover_storage_path, new RegExp(`^route-covers/${routeId}/admin-.+\\.jpg$`));
    assert.ok(row.cover_updated_at instanceof Date);
    const processed = storage.objects.get(row.cover_storage_path);
    assert.ok(processed);
    const metadata = await sharp(processed.data).metadata();
    assert.equal(Math.max(metadata.width!, metadata.height!), 2400);

    const detail = await request(app).get(`/api/routes/${routeId}`).set("X-Test-User", admin["X-Test-User"]);
    assert.equal(detail.body.cover_image, response.body.cover_image);
    assert.equal(detail.body.cover_image_origin, "route");
    assert.ok(shippedIosRouteCover(detail.body), "the detail payload decodes in shipped iOS");

    await db.query(`UPDATE routes SET objective_destination_id = $2 WHERE id = $1`, [routeId, objectiveId]);
    const withObjective = await request(app).get(`/api/routes/${routeId}`).set("X-Test-User", admin["X-Test-User"]);
    assert.equal(withObjective.body.cover_destination_id, objectiveId, "the objective names a route's own cover");
    assert.equal(withObjective.body.cover_destination_name, "Cover Lake");
    await db.query(`UPDATE routes SET objective_destination_id = NULL WHERE id = $1`, [routeId]);
  });

  test("a second PUT replaces the cover and removes the previous processed copy", async () => {
    const before = (await db.query(`SELECT cover_storage_path FROM routes WHERE id = $1`, [routeId])).rows[0];
    const path = upload("routes", routeId, "second.webp", await sharp({
      create: { width: 1600, height: 900, channels: 3, background: "#456" },
    }).webp().toBuffer(), "image/webp");
    const response = await request(app)
      .put(`/api/admin/routes/${routeId}/cover`)
      .set(admin)
      .send({ storagePath: path, attribution: "NPS / Jane Doe", attributionUrl: "https://www.nps.gov/mora" });
    assert.equal(response.status, 200);
    assert.equal(response.body.cover_image_attribution, "NPS / Jane Doe");
    assert.equal(response.body.cover_image_attribution_url, "https://www.nps.gov/mora");
    assert.equal(response.body.cover_image_focal_x, 50);
    assert.ok(storage.removed.includes(before.cover_storage_path));
  });

  test("DELETE clears an admin route cover, removes its file, and falls back to the place", async () => {
    const before = (await db.query(`SELECT cover_storage_path FROM routes WHERE id = $1`, [routeId])).rows[0];
    const response = await request(app).delete(`/api/admin/routes/${routeId}/cover`).set(admin);
    assert.equal(response.status, 200);
    assert.equal(response.body.cover_image_origin, "destination");
    assert.equal(response.body.cover_image, "https://example.org/reviewed.jpg");
    assert.ok(storage.removed.includes(before.cover_storage_path));
    const again = await request(app).delete(`/api/admin/routes/${routeId}/cover`).set(admin);
    assert.equal(again.status, 409);
  });

  test("DELETE refuses a destination photo the admin did not set", async () => {
    const response = await request(app).delete(`/api/admin/destinations/${destinationId}/cover`).set(admin);
    assert.equal(response.status, 409);
    const detail = await request(app).get(`/api/destinations/${destinationId}`).set("X-Test-User", admin["X-Test-User"]);
    assert.equal(detail.body.hero_image_origin, "reviewed");
  });

  test("an admin destination cover replaces the reviewed hero, and DELETE restores it", async () => {
    const first = upload("destinations", destinationId, "peak.png", await sharp({
      create: { width: 2000, height: 1200, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer(), "image/png");
    const response = await request(app)
      .put(`/api/admin/destinations/${destinationId}/cover`)
      .set(admin)
      .send({ storagePath: first, focalY: 20 });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(Object.keys(response.body).sort(), [
      "hero_image",
      "hero_image_attribution",
      "hero_image_attribution_url",
      "hero_image_focal_x",
      "hero_image_focal_y",
      "hero_image_origin",
      "id",
    ]);
    assert.match(response.body.hero_image, /destination-covers%2F/);
    assert.equal(response.body.hero_image_focal_y, 20);
    assert.equal(response.body.hero_image_origin, "admin");
    const detail = await request(app).get(`/api/destinations/${destinationId}`).set("X-Test-User", admin["X-Test-User"]);
    assert.equal(detail.body.hero_image, response.body.hero_image);
    assert.equal(detail.body.hero_image_attribution, "Josiah McDonald · Peaks");
    assert.equal(detail.body.hero_image_origin, "admin");

    // A second admin cover still remembers the reviewed hero from before both.
    const firstProcessed = (await db.query(
      `SELECT hero_image_storage_path FROM destinations WHERE id = $1`, [destinationId]
    )).rows[0].hero_image_storage_path;
    const second = upload("destinations", destinationId, "peak2.jpg", await jpeg(1600, 900));
    assert.equal((await request(app)
      .put(`/api/admin/destinations/${destinationId}/cover`)
      .set(admin)
      .send({ storagePath: second })).status, 200);
    assert.ok(storage.removed.includes(firstProcessed), "the replaced admin file is removed");
    const secondProcessed = (await db.query(
      `SELECT hero_image_storage_path FROM destinations WHERE id = $1`, [destinationId]
    )).rows[0].hero_image_storage_path;

    const cleared = await request(app).delete(`/api/admin/destinations/${destinationId}/cover`).set(admin);
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body, {
      id: destinationId,
      hero_image: "https://example.org/reviewed.jpg",
      hero_image_attribution: "Reviewed Photographer",
      hero_image_attribution_url: "https://example.org/reviewed",
      hero_image_focal_x: 70,
      hero_image_focal_y: 50,
      hero_image_origin: "reviewed",
    });
    assert.ok(storage.removed.includes(secondProcessed), "DELETE removes the admin file");
    const row = (await db.query(
      `SELECT hero_image_source, hero_image_storage_path, hero_image_previous FROM destinations WHERE id = $1`,
      [destinationId]
    )).rows[0];
    assert.deepEqual(row, { hero_image_source: null, hero_image_storage_path: null, hero_image_previous: null });
    assert.equal((await request(app).delete(`/api/admin/destinations/${destinationId}/cover`).set(admin)).status, 409);
  });

  test("a place with no reviewed hero is left empty by DELETE", async () => {
    const path = upload("destinations", objectiveId, "lake.jpg", await jpeg(1600, 900));
    assert.equal((await request(app)
      .put(`/api/admin/destinations/${objectiveId}/cover`)
      .set(admin)
      .send({ storagePath: path })).status, 200);
    const cleared = await request(app).delete(`/api/admin/destinations/${objectiveId}/cover`).set(admin);
    assert.equal(cleared.body.hero_image, null);
    assert.equal(cleared.body.hero_image_origin, null);
  });

  test("a reviewed catalog route accepts a cover edit but no other change", async () => {
    // The real guard needs review receipts that only the catalog lanes can
    // write. Run the exact migration text against stand-in tables instead.
    const migration = readFileSync(
      resolve(__dirname, "../../../migrations/20261015_route_covers.sql"),
      "utf8"
    );
    const guard = migration.match(
      /CREATE OR REPLACE FUNCTION guard_trail_catalog_pending_only\(\)[\s\S]*?\nEND \$\$;/
    )?.[0];
    assert.ok(guard, "expected the guard in the migration");
    const schema = `guard_${process.pid}_${Date.now()}`;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path = ${schema}, public`);
      await client.query(`CREATE TABLE ${schema}.routes (LIKE public.routes INCLUDING DEFAULTS)`);
      await client.query(`CREATE TABLE ${schema}.trail_catalog_candidate_jobs (proposed_route_id text)`);
      await client.query(`CREATE TABLE ${schema}.trail_catalog_review_jobs (route_id text, state text)`);
      await client.query(
        `CREATE FUNCTION ${schema}.trail_catalog_publish_authorized(text) RETURNS boolean LANGUAGE sql AS 'SELECT false'`
      );
      assert.ok(guard.includes("SET search_path=pg_catalog,public,pg_temp"));
      await client.query(
        guard
          .replace("guard_trail_catalog_pending_only()", `${schema}.guard_trail_catalog_pending_only()`)
          .replace("SET search_path=pg_catalog,public,pg_temp", `SET search_path=${schema},pg_catalog`)
      );
      await client.query(
        `CREATE TRIGGER guard BEFORE INSERT OR UPDATE OR DELETE ON ${schema}.routes
         FOR EACH ROW EXECUTE FUNCTION ${schema}.guard_trail_catalog_pending_only()`
      );
      await client.query(`INSERT INTO ${schema}.trail_catalog_candidate_jobs VALUES ('catalog-route')`);
      await client.query(`INSERT INTO ${schema}.routes (id, name, owner, status) VALUES ('catalog-route', 'Reviewed', 'peaks', 'pending')`);
      await client.query(`INSERT INTO ${schema}.trail_catalog_review_jobs VALUES ('catalog-route', 'verified')`);

      await client.query(
        `UPDATE ${schema}.routes
            SET cover_image = 'https://example.org/c.jpg', cover_attribution = 'A',
                cover_attribution_url = 'https://example.org/a', cover_source = 'admin',
                cover_storage_path = 'route-covers/catalog-route/x.jpg',
                cover_focal_x = 40, cover_focal_y = 60, cover_updated_at = now()
          WHERE id = 'catalog-route'`
      );
      await client.query("SAVEPOINT name_change");
      await assert.rejects(
        client.query(`UPDATE ${schema}.routes SET name = 'Renamed' WHERE id = 'catalog-route'`),
        /catalog reviewed route is immutable/
      );
      await client.query("ROLLBACK TO SAVEPOINT name_change");
      await assert.rejects(
        client.query(`UPDATE ${schema}.routes SET cover_image = NULL, external_links = '[]' WHERE id = 'catalog-route'`),
        /catalog reviewed route is immutable/
      );
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});
