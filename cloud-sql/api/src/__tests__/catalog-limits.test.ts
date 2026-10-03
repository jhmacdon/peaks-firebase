import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { app } from "../index";
import db from "../db";
import { appRequest } from "./helpers/app-request";

afterEach(() => mock.restoreAll());

// These caps match the largest current iOS requests, including map pages,
// the viewfinder and flyovers. Routes/near has no current iOS caller.
const limits = [
  { path: "/destinations/viewport?minLat=46&maxLat=48&minLng=-123&maxLng=-121", max: 200, fallback: 200, index: 4 },
  { path: "/destinations/nearby?lat=47&lng=-122", max: 2000, fallback: 50, index: 3 },
  { path: "/routes/near?lat=47&lng=-122", max: 20, fallback: 20, index: 3 },
  { path: "/search/features?features=summit", max: 180, fallback: 50, index: 1 },
  { path: "/lists/popular?unused=1", max: 10, fallback: 10, index: 0 },
];

for (const [number, { path, max, fallback, index }] of limits.entries()) {
  test(`${path.split("?")[0]} clamps limits for signed-out and signed-in requests`, async () => {
    mock.method(console, "log", () => undefined);
    let values: unknown[] = [];
    mock.method(db, "query", async (_text: string, params: unknown[]) => { values = params; return { rows: [] }; });
    for (const uid of ["", "member"]) {
      const headers: Record<string, string> = { "X-Forwarded-For": `192.0.2.${50 + number}` };
      if (uid) headers["X-Test-User"] = uid;
      for (const [input, expected] of [
        ["", fallback], ["-1", fallback], ["0", fallback], ["NaN", fallback], ["Infinity", fallback],
        ["1", 1], ["3.9", 3], [String(max), max], [String(max + 1), max], ["99999999", max],
      ] as const) {
        const response = await appRequest(app, "GET", `/api${path}&limit=${input}`, headers);
        assert.equal(response.status, 200);
        assert.equal(values[index], expected, `${uid || "signed out"}: limit=${input}`);
      }
    }
  });
}

for (const [number, { path, max, fallback }] of [
  { path: "/destinations/nearby", max: 260_000, fallback: 10_000 },
  { path: "/routes/near", max: 5_000, fallback: 5_000 },
].entries()) {
  test(`${path} clamps radii for everyone and keeps the current iOS maximum`, async () => {
    mock.method(console, "log", () => undefined);
    let values: unknown[] = [];
    mock.method(db, "query", async (_text: string, params: unknown[]) => { values = params; return { rows: [] }; });
    for (const uid of ["", "member"]) {
      const headers: Record<string, string> = { "X-Forwarded-For": `192.0.2.${60 + number}` };
      if (uid) headers["X-Test-User"] = uid;
      for (const [input, expected] of [
        ["", fallback], ["-1", fallback], ["0", fallback], ["NaN", fallback], ["Infinity", fallback],
        ["1.5", 1.5], [String(max), max], [String(max + 1), max], ["1e9", max],
      ] as const) {
        const response = await appRequest(app, "GET", `/api${path}?lat=47&lng=-122&radius=${input}`, headers);
        assert.equal(response.status, 200);
        assert.equal(values[2], expected, `${uid || "signed out"}: radius=${input}`);
      }
    }
  });
}

for (const [number, path] of ["/destinations/averages", "/lists/by-destinations"].entries()) {
  test(`${path} rejects oversized signed-out ID batches before SQL and leaves signed-in batches intact`, async () => {
    mock.method(console, "log", () => undefined);
    const queries: unknown[][] = [];
    mock.method(db, "query", async (_text: string, values: unknown[]) => { queries.push(values); return { rows: [] }; });
    const ids = Array.from({ length: 2001 }, (_, i) => `id-${i}`);
    const headers = { "X-Forwarded-For": `192.0.2.${70 + number}` };
    const oversized = await appRequest(app, "GET", `/api${path}?ids=${ids.join(",")}`, headers);
    assert.equal(oversized.status, 400);
    assert.deepEqual(oversized.body, { error: "Signed-out requests accept at most 2000 destination IDs" });
    assert.equal(queries.length, 0);

    const allowed = ids.slice(0, 2000);
    assert.equal((await appRequest(app, "GET", `/api${path}?ids=${allowed.join(",")}`, headers)).status, 200);
    assert.ok(queries.length > 0);
    assert.ok(queries.every((values) => JSON.stringify(values[0]) === JSON.stringify(allowed)));
    queries.length = 0;
    assert.equal((await appRequest(app, "GET", `/api${path}?ids=${ids.join(",")}`, { "X-Test-User": "member" })).status, 200);
    assert.ok(queries.length > 0);
    assert.ok(queries.every((values) => JSON.stringify(values[0]) === JSON.stringify(ids)));
  });
}
