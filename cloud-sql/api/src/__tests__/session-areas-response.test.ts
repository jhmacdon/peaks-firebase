import { strict as assert } from "node:assert";
import { test } from "node:test";
import db from "../db";
import sessionsRouter, {
  buildSessionAreasQuery,
  buildSessionDetailQuery,
  SESSION_AREAS_SQL,
} from "../routes/sessions";

class FakeResponse {
  statusCode?: number;
  jsonBody?: unknown;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.jsonBody = body;
    return this;
  }
}

function getSessionGetHandler(path: string) {
  const layer = (sessionsRouter as any).stack.find(
    (candidate: any) =>
      candidate.route?.path === path && candidate.route?.methods?.get
  );
  assert.ok(layer, `expected sessions router to include GET ${path}`);
  return layer.route.stack[0].handle as (
    req: unknown,
    res: unknown
  ) => Promise<void>;
}

test("session areas come from stored track tags and collapse area fragments", () => {
  const query = buildSessionAreasQuery("session-1", "user-1");

  assert.match(query.text, /FROM session_areas sa/);
  assert.match(query.text, /JOIN areas a ON a\.id = sa\.area_id/);
  assert.match(query.text, /DISTINCT ON \(a\.kind, a\.name\)/);
  assert.match(query.text, /'relation', sa\.relation/);
  // Sub-areas (e.g. an NPS wilderness inside a national park) carry their
  // parent so clients can demote them in favor of the park.
  assert.match(query.text, /'parent_id', a\.parent_area_id/);
  assert.doesNotMatch(query.text, /a\.boundary/);
  assert.deepEqual(query.values, ["session-1", "user-1"]);
});

test("session areas require ownership or public access", () => {
  const query = buildSessionAreasQuery("session-1", "user-1");

  assert.match(query.text, /s\.user_id = \$2 OR s\.is_public = true/);
});

test("session area JSON can be embedded in every session response", () => {
  assert.match(SESSION_AREAS_SQL, /FROM session_areas sa/);
  assert.match(SESSION_AREAS_SQL, /WHERE sa\.session_id = s\.id/);
  assert.match(SESSION_AREAS_SQL, /'parent_id', a\.parent_area_id/);
  assert.match(SESSION_AREAS_SQL, /'\[\]'::json/);
  assert.doesNotMatch(SESSION_AREAS_SQL, /a\.boundary/);
});

test("session list embeds track-based protected areas", async (t) => {
  let capturedSql = "";
  let capturedValues: unknown[] = [];
  t.mock.method(db, "query", async (text: string, values: unknown[]) => {
    capturedSql = text;
    capturedValues = values;
    return { rows: [] } as any;
  });

  const handler = getSessionGetHandler("/");
  const response = new FakeResponse();
  await handler({ uid: "user-1", query: {} }, response);

  assert.match(capturedSql, /FROM session_areas sa/);
  assert.match(capturedSql, /\)\s+AS areas\s+FROM tracking_sessions s/);
  assert.match(capturedSql, /WHERE s\.user_id = \$1/);
  assert.deepEqual(capturedValues, ["user-1", null, 200, 0]);
  assert.deepEqual(response.jsonBody, []);
});

test("session changes embed protected areas inside each upsert", async (t) => {
  let capturedSql = "";
  let capturedValues: unknown[] = [];
  t.mock.method(db, "query", async (text: string, values: unknown[]) => {
    capturedSql = text;
    capturedValues = values;
    return { rows: [] } as any;
  });

  const handler = getSessionGetHandler("/changes");
  const response = new FakeResponse();
  await handler({ uid: "user-1", query: {} }, response);

  assert.match(capturedSql, /'areas', COALESCE\(/);
  assert.match(capturedSql, /FROM session_areas sa/);
  assert.match(capturedSql, /FROM tracking_sessions s\s+WHERE s\.user_id = \$1/);
  assert.deepEqual(capturedValues, ["user-1", null, null, 200]);
  assert.deepEqual(response.jsonBody, {
    changes: [],
    next_cursor: null,
    has_more: false,
  });
});

test("session detail embeds areas without weakening public-view privacy", () => {
  const query = buildSessionDetailQuery("session-1", "viewer-1");

  assert.match(query.text, /FROM session_areas sa/);
  assert.match(query.text, /\)\s+AS areas\s+FROM tracking_sessions s/);
  assert.match(
    query.text,
    /CASE WHEN s\.user_id = \$2 THEN s\.health_data ELSE NULL END AS health_data/
  );
  assert.match(query.text, /s\.user_id = \$2 OR s\.is_public = true/);
  assert.deepEqual(query.values, ["session-1", "viewer-1"]);
});
