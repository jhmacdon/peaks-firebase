import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { app } from "../index";
import db from "../db";
import { dbSkipReason } from "./helpers/test-db";
import { appRequest } from "./helpers/app-request";

const prefix = `guest-catalog-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const id = (kind: string) => `${prefix}-${kind}`;
const uid = id("secret-user");
const publicDestination = id("destination");
const secretDestination = id("secret-destination");
const publicRoute = id("route");
const secretRoute = id("secret-route");
const publicList = id("list");
const secretList = id("secret-list");
const publicArea = id("area");
const secretArea = id("secret-area");

async function cleanup() {
  await db.query("DELETE FROM tracking_sessions WHERE user_id = $1", [uid]);
  await db.query("DELETE FROM plans WHERE id = $1", [id("plan")]);
  for (const [table, ids] of [
    ["routes", [publicRoute, secretRoute]], ["lists", [publicList, secretList]],
    ["destinations", [publicDestination, secretDestination]], ["areas", [publicArea, secretArea]],
  ] as const) await db.query(`DELETE FROM ${table} WHERE id = ANY($1::text[])`, [ids]);
}

describe("signed-out catalog privacy with PostGIS fixtures", { skip: dbSkipReason ?? undefined }, () => {
  before(async () => {
    await cleanup();
    for (const [area, owner, source] of [[publicArea, "USFS", "padus"], [secretArea, uid, "user"]]) {
      await db.query(`INSERT INTO areas
        (id, name, search_name, kind, owner, source, source_id, source_version,
         boundary, centroid, bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng)
        VALUES ($1, 'Guest Catalog ' || $1, 'guest catalog ' || $1, 'national_forest', $2, $3, $1, 'test',
          ST_Multi(ST_MakeEnvelope(-122.1,46.9,-121.9,47.1,4326)),
          ST_SetSRID(ST_MakePoint(-122,47),4326),46.9,47.1,-122.1,-121.9)`, [area, owner, source]);
    }
    for (const [destination, owner] of [[publicDestination, "peaks"], [secretDestination, uid]]) {
      await db.query(`INSERT INTO destinations
        (id,name,search_name,owner,features,location,elevation)
        VALUES ($1, 'Guest Catalog ' || $1, 'guest catalog ' || $1,$2,ARRAY['summit']::destination_feature[],
          ST_GeomFromText('POINT Z(-122 47 10)',4326)::geography,10)`, [destination, owner]);
    }
    await db.query("UPDATE areas SET parent_area_id = $1 WHERE id = $2", [secretArea, publicArea]);
    for (const destination of [publicDestination, secretDestination]) {
      for (const area of [publicArea, secretArea]) {
        await db.query("INSERT INTO destination_areas (destination_id,area_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [destination,area]);
      }
    }
    // A credited private destination must not leak through a public route's cover.
    await db.query(`UPDATE destinations SET hero_image = 'https://example.test/private-photo',
      hero_image_attribution = 'private-photo-credit', hero_image_attribution_url = 'https://example.test/credit'
      WHERE id = $1`, [secretDestination]);
    for (const [route, owner] of [[publicRoute, "peaks"], [secretRoute, uid]]) {
      await db.query(`INSERT INTO routes (id,name,owner,path)
        VALUES ($1,$1,$2,ST_GeomFromText('LINESTRING Z(-122 47 10,-121.99 47.01 20)',4326)::geography)`, [route, owner]);
      await db.query(`INSERT INTO route_sections
        (route_id,section_id,ordinal,label,start_fraction,end_fraction)
        VALUES ($1,'section',0,$1,0,1)`, [route]);
      for (const destination of [publicDestination, secretDestination]) {
        await db.query("INSERT INTO route_destinations (route_id,destination_id) VALUES ($1,$2)", [route,destination]);
      }
      for (const area of [publicArea,secretArea]) {
        await db.query("INSERT INTO route_areas (route_id,area_id,relation,source) VALUES ($1,$2,'intersects','test') ON CONFLICT DO NOTHING", [route,area]);
      }
    }
    for (const [list,owner] of [[publicList,"peaks"],[secretList,uid]]) {
      await db.query("INSERT INTO lists (id,name,owner) VALUES ($1,$1,$2)", [list,owner]);
      for (const destination of [publicDestination,secretDestination]) {
        await db.query("INSERT INTO list_destinations (list_id,destination_id) VALUES ($1,$2)", [list,destination]);
      }
    }
    await db.query("INSERT INTO plans (id,user_id,name,is_public) VALUES ($1,$2,'Shared public plan',true)", [id("plan"),uid]);
    await db.query("INSERT INTO plan_routes (plan_id,route_id) VALUES ($1,$2)", [id("plan"),secretRoute]);
    await db.query(`INSERT INTO tracking_sessions (id,user_id,start_time,ended,is_public)
      VALUES ($1,$3,'2026-01-01T00:00:00Z',true,true),($2,$3,'2026-02-01T00:00:00Z',true,false)`, [id("public-session"),id("secret-session"),uid]);
    await db.query(`INSERT INTO session_destinations (session_id,destination_id,relation)
      VALUES ($1,$3,'reached'),($2,$3,'reached') ON CONFLICT DO NOTHING`, [id("public-session"),id("secret-session"),publicDestination]);
    await db.query(`INSERT INTO session_areas (session_id,area_id,source)
      VALUES ($1,$3,'postgis'),($2,$3,'postgis') ON CONFLICT DO NOTHING`, [id("public-session"),id("secret-session"),publicArea]);
  });
  after(cleanup);

  test("all 19 allowlisted reads return 200 without private rows or personal history", async () => {
    const paths = [
      "/destinations/nearby?lat=47&lng=-122",
      "/destinations/viewport?minLat=46.9&maxLat=47.1&minLng=-122.1&maxLng=-121.9",
      `/destinations/averages?ids=${publicDestination},${secretDestination}`,
      `/destinations/${publicDestination}`, `/destinations/${publicDestination}/lists`,
      `/destinations/${publicDestination}/routes`,
      "/lists/popular", `/lists/by-destinations?ids=${publicDestination},${secretDestination}`,
      `/lists/${publicList}`, `/lists/${publicList}/destinations`,
      "/search?q=guest%20catalog", "/search/all?q=guest%20catalog", "/search/features?features=summit&lat=47&lng=-122",
      "/routes/near?lat=47&lng=-122", `/routes/${publicRoute}`, `/routes/${publicRoute}/destinations`,
      `/routes/${publicRoute}/sections`, `/routes/${publicRoute}/elevation`, `/areas/${publicArea}`,
    ];
    for (const path of paths) {
      const response = await appRequest(app,"GET",`/api${path}`);
      assert.equal(response.status,200,`${path}: ${JSON.stringify(response.body)}`);
      const serialized = JSON.stringify(response.body);
      for (const secret of [secretDestination,secretRoute,secretList,secretArea,uid,"private-photo"]) {
        assert.ok(!serialized.includes(secret), `${path} exposed ${secret}`);
      }
      if (path.startsWith("/areas/")) {
        assert.deepEqual(response.body.sessions,[]);
        assert.equal(response.body.session_count,0);
      }
      if (path.startsWith("/destinations/averages")) {
        assert.equal(response.body[publicDestination].months.jan,1);
        assert.equal(response.body[publicDestination].months.feb,undefined);
      }
    }
    // Also exercise the short-query and geographic search branches.
    for (const path of ["/search", "/search/all"]) {
      for (const query of ["q=gu", "q=gu&lat=47&lng=-122", "q=guest%20catalog&lat=47&lng=-122"]) {
        const response = await appRequest(app,"GET",`/api${path}?${query}`);
        assert.equal(response.status,200);
        for (const secret of [secretDestination, secretRoute, secretArea, "private-photo"]) {
          assert.ok(!JSON.stringify(response.body).includes(secret), `${path}?${query} exposed ${secret}`);
        }
      }
    }
  });

  test("mixed search fills every public bucket and filters area counts and route covers", async () => {
    const response = await appRequest(app, "GET", "/api/search/all?q=guest%20catalog");
    assert.equal(response.status, 200);
    assert.ok(response.body.destinations.some((row: any) => row.id === publicDestination));
    const route = response.body.routes.find((row: any) => row.id === publicRoute);
    assert.ok(route, "route SQL must succeed without a uid");
    assert.equal(route.cover_destination_id, null);
    assert.equal(route.cover_image, null);
    assert.deepEqual(route.areas.map((area: any) => area.id), [publicArea]);
    assert.equal(route.areas[0].parent_id, null);
    const area = response.body.areas.find((row: any) => row.id === publicArea);
    assert.ok(area, "area SQL must succeed without a uid");
    assert.equal(area.parent_id, null);
    assert.equal(area.destination_count, 1);
    assert.equal(area.route_count, 1);

    const routes = await appRequest(app, "GET", `/api/destinations/${publicDestination}/routes`);
    assert.equal(routes.status, 200);
    assert.deepEqual(routes.body.map((row: any) => row.id), [publicRoute]);
    assert.equal(routes.body[0].cover_image, null);
    assert.deepEqual(routes.body[0].areas.map((row: any) => row.id), [publicArea]);

    const own = await appRequest(app, "GET", "/api/search/all?q=guest%20catalog", { "X-Test-User": uid });
    assert.equal(own.status, 200);
    assert.ok(own.body.destinations.some((row: any) => row.id === secretDestination));
    assert.ok(own.body.routes.some((row: any) => row.id === secretRoute));
    assert.ok(own.body.areas.some((row: any) => row.id === secretArea));
    const ownRoutes = await appRequest(app, "GET", `/api/destinations/${secretDestination}/routes`, { "X-Test-User": uid });
    assert.equal(ownRoutes.status, 200);
    assert.ok(ownRoutes.body.some((row: any) => row.id === secretRoute));
  });

  test("private IDs cannot open detail, geometry, divisions or membership while signed out", async () => {
    for (const path of [`/destinations/${secretDestination}`,`/lists/${secretList}`,`/areas/${secretArea}`,`/routes/${secretRoute}`,`/routes/${secretRoute}/elevation`]) {
      assert.equal((await appRequest(app,"GET",`/api${path}`)).status,404,path);
    }
    for (const path of [`/destinations/${secretDestination}/lists`,`/destinations/${secretDestination}/routes`,`/lists/${secretList}/destinations`,`/routes/${secretRoute}/sections`,`/routes/${secretRoute}/destinations`]) {
      const response = await appRequest(app,"GET",`/api${path}`);
      assert.equal(response.status,200,path);
      assert.deepEqual(response.body,[],path);
    }
    const own = await appRequest(app,"GET",`/api/routes/${secretRoute}`,{ "X-Test-User": uid });
    assert.equal(own.status,200);
    const history = await appRequest(app,"GET",`/api/areas/${publicArea}`,{ "X-Test-User": uid });
    assert.equal(history.status,200);
    assert.equal(history.body.session_count,2);
  });
});
