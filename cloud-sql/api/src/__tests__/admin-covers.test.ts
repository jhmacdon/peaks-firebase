import { strict as assert } from "node:assert";
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
  type CoverStorage,
} from "../lib/cover-photo";
import { parseCoverBody, setCoverStorageFactoryForTests } from "../routes/admin";
import { dbSkipReason as skipReason } from "./helpers/test-db";

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 120, b: 110 } },
  })
    .jpeg()
    .toBuffer();
}

class FakeStorage implements CoverStorage {
  readonly bucketName = "peaks-test.appspot.com";
  objects = new Map<string, { data: Buffer; contentType: string; metadata?: Record<string, string> }>();
  removed: string[] = [];
  async stat(objectName: string) {
    const object = this.objects.get(objectName);
    return object ? { contentType: object.contentType, size: object.data.byteLength } : null;
  }
  async download(objectName: string) {
    const object = this.objects.get(objectName);
    if (!object) throw new Error("missing");
    return object.data;
  }
  async save(objectName: string, data: Buffer, token: string, metadata: Record<string, string>) {
    this.objects.set(objectName, { data, contentType: "image/jpeg", metadata: { ...metadata, token } });
  }
  async remove(objectName: string) {
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

  test("rendering enforces the minimum size and caps the long edge at 2400 px", async () => {
    await assert.rejects(renderCoverPhoto(await jpeg(1200, 900)), /at least 1600×900/);
    await assert.rejects(renderCoverPhoto(Buffer.from("not an image")), /not a readable image/);
    const rendered = await renderCoverPhoto(await jpeg(3200, 1800));
    assert.equal(rendered.width, 2400);
    assert.equal(rendered.height, 1350);
    const metadata = await sharp(rendered.data).metadata();
    assert.equal(metadata.format, "jpeg");
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
const admin = { "X-Test-User": `${prefix}-admin`, "X-Test-Admin": "true", "X-Test-Name": "Josiah McDonald" };

async function upload(kind: "routes" | "destinations", id: string, name: string, data: Buffer, contentType = "image/jpeg") {
  const path = `covers/${kind}/${id}/${name}`;
  storage.objects.set(path, { data, contentType });
  return path;
}

describe("admin cover endpoints", { skip: skipReason ?? undefined }, () => {
  async function cleanup() {
    await db.query("DELETE FROM routes WHERE id = $1", [routeId]);
    await db.query("DELETE FROM destinations WHERE id = $1", [destinationId]);
  }

  before(async () => {
    await cleanup();
    await db.query(
      `INSERT INTO destinations (id, name, search_name, features, hero_image, hero_image_attribution, hero_image_attribution_url)
       VALUES ($1, 'Cover Peak', 'cover peak', ARRAY['summit']::destination_feature[],
               'https://example.org/reviewed.jpg', 'Reviewed Photographer', 'https://example.org/reviewed')`,
      [destinationId]
    );
    await db.query(`INSERT INTO routes (id, name, status) VALUES ($1, 'Cover Route', 'active')`, [routeId]);
    await db.query(
      `INSERT INTO route_destinations (route_id, destination_id, ordinal) VALUES ($1, $2, 0)`,
      [routeId, destinationId]
    );
  });

  after(cleanup);

  test("a route falls back to its place's cover until it has its own", async () => {
    const response = await request(app).get(`/api/routes/${routeId}`).set("X-Test-User", admin["X-Test-User"]);
    assert.equal(response.status, 200);
    assert.equal(response.body.cover_image, "https://example.org/reviewed.jpg");
    assert.equal(response.body.cover_image_origin, "destination");
    assert.equal(response.body.cover_destination_id, destinationId);
  });

  test("missing, non-image, oversized and small uploads are refused with 422", async () => {
    const send = (storagePath: string) =>
      request(app).put(`/api/admin/routes/${routeId}/cover`).set(admin).send({ storagePath });
    assert.equal((await send(`covers/routes/${routeId}/missing.jpg`)).status, 422);
    const text = await upload("routes", routeId, "notes.txt", Buffer.from("hello"), "text/plain");
    assert.match((await send(text)).body.error, /image\/\* content type/);
    const huge = await upload("routes", routeId, "huge.jpg", Buffer.alloc(COVER_UPLOAD_MAX_BYTES + 1));
    assert.match((await send(huge)).body.error, /larger than 15 MB/);
    const small = await upload("routes", routeId, "small.jpg", await jpeg(800, 600));
    const smallResponse = await send(small);
    assert.equal(smallResponse.status, 422);
    assert.match(smallResponse.body.error, /at least 1600×900/);
  });

  test("an unknown route is 404", async () => {
    const response = await request(app)
      .put(`/api/admin/routes/${prefix}-nope/cover`)
      .set(admin)
      .send({ storagePath: `covers/routes/${prefix}-nope/a.jpg` });
    assert.equal(response.status, 404);
  });

  test("PUT sets the route's own cover with default credit and the detail shape", async () => {
    const path = await upload("routes", routeId, "first.jpg", await jpeg(4000, 3000));
    const response = await request(app)
      .put(`/api/admin/routes/${routeId}/cover`)
      .set(admin)
      .send({ storagePath: path, focalX: 30, focalY: 60 });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.id, routeId);
    assert.equal(response.body.cover_image_origin, "route");
    assert.equal(response.body.cover_destination_id, null);
    assert.equal(response.body.cover_image_attribution, "Josiah McDonald · Peaks");
    assert.equal(response.body.cover_image_attribution_url, response.body.cover_image);
    assert.match(
      response.body.cover_image,
      new RegExp(`^https://firebasestorage\\.googleapis\\.com/v0/b/peaks-test\\.appspot\\.com/o/route-covers%2F${routeId}%2Fadmin-`)
    );
    assert.equal(response.body.cover_image_focal_x, 30);
    assert.equal(response.body.cover_image_focal_y, 60);
    assert.ok(storage.removed.includes(path), "the original upload is removed");

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
  });

  test("a second PUT replaces the cover and removes the previous processed copy", async () => {
    const before = (await db.query(`SELECT cover_storage_path FROM routes WHERE id = $1`, [routeId])).rows[0];
    const path = await upload("routes", routeId, "second.jpg", await jpeg(1600, 900));
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

  test("DELETE clears an admin route cover and falls back to the place", async () => {
    const response = await request(app).delete(`/api/admin/routes/${routeId}/cover`).set(admin);
    assert.equal(response.status, 200);
    assert.equal(response.body.cover_image_origin, "destination");
    assert.equal(response.body.cover_image, "https://example.org/reviewed.jpg");
    const again = await request(app).delete(`/api/admin/routes/${routeId}/cover`).set(admin);
    assert.equal(again.status, 409);
  });

  test("DELETE refuses a destination photo the admin did not set", async () => {
    const response = await request(app).delete(`/api/admin/destinations/${destinationId}/cover`).set(admin);
    assert.equal(response.status, 409);
  });

  test("PUT and DELETE a destination cover use the destination detail shape", async () => {
    const path = await upload("destinations", destinationId, "peak.png", await sharp({
      create: { width: 2000, height: 1200, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer(), "image/png");
    const response = await request(app)
      .put(`/api/admin/destinations/${destinationId}/cover`)
      .set(admin)
      .send({ storagePath: path, focalY: 20 });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(Object.keys(response.body).sort(), [
      "hero_image",
      "hero_image_attribution",
      "hero_image_attribution_url",
      "hero_image_focal_x",
      "hero_image_focal_y",
      "id",
    ]);
    assert.match(response.body.hero_image, /destination-covers%2F/);
    assert.equal(response.body.hero_image_focal_y, 20);
    const detail = await request(app).get(`/api/destinations/${destinationId}`).set("X-Test-User", admin["X-Test-User"]);
    assert.equal(detail.body.hero_image, response.body.hero_image);
    assert.equal(detail.body.hero_image_attribution, "Josiah McDonald · Peaks");

    const cleared = await request(app).delete(`/api/admin/destinations/${destinationId}/cover`).set(admin);
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.hero_image, null);
    const row = (await db.query(
      `SELECT hero_image, hero_image_source, hero_image_storage_path FROM destinations WHERE id = $1`,
      [destinationId]
    )).rows[0];
    assert.deepEqual(row, { hero_image: null, hero_image_source: null, hero_image_storage_path: null });
  });
});
