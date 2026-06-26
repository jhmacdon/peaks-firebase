// streamQueryAsJsonArray holds a pooled connection for the ENTIRE duration of
// streaming a session's points. If the client disconnects mid-stream (iOS 15s
// request timeout fires, or the user navigates away), the server must stop
// draining the server-side cursor and return the connection to the pool
// immediately — otherwise it keeps a scarce connection hostage reading rows
// nobody will ever receive. On a 4-connection pool that is exactly how one
// user's session-sync fan-out 503'd the whole API.
//
// No DB: a fake pool/client yields a couple rows then blocks (as a real cursor
// would when there's more to fetch). We emit `res`'s "close" event and assert
// the stream is destroyed and the client released.

import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { streamQueryAsJsonArray } from "../lib/stream-json";

class FakeRes extends EventEmitter {
  headersSent = false;
  destroyed = false;
  body = "";
  setHeader(): this {
    return this;
  }
  write(chunk: string): boolean {
    this.body += chunk;
    this.headersSent = true;
    return true;
  }
  end(): this {
    return this;
  }
  status(): this {
    return this;
  }
  json(): this {
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

// A fake QueryStream: yields `initialRows`, then blocks (mimicking a cursor with
// more rows to fetch) until destroy() is called.
function makeBlockingStream(initialRows: unknown[]) {
  let opened = false;
  let releaseGate!: () => void;
  const gate = new Promise<void>((r) => {
    releaseGate = r;
  });
  return {
    destroyed: false,
    destroy() {
      this.destroyed = true;
      releaseGate();
    },
    async *[Symbol.asyncIterator]() {
      opened = true;
      for (const row of initialRows) {
        if (this.destroyed) return;
        yield row;
      }
      await gate; // simulate "waiting for more rows from the cursor"
    },
    get opened() {
      return opened;
    },
  };
}

const tick = () => new Promise((r) => setImmediate(r));

test("client disconnect mid-stream destroys the cursor and releases the connection", async () => {
  const stream = makeBlockingStream([{ time: 1 }, { time: 2 }]);
  let released = 0;
  const client = {
    query() {
      return stream;
    },
    release() {
      released++;
    },
  };
  const pool = {
    async connect() {
      return client;
    },
  };
  const res = new FakeRes();

  const done = streamQueryAsJsonArray(res as any, pool as any, "SELECT 1", []);

  // Let the stream emit its first rows, then the client goes away.
  await tick();
  await tick();
  res.emit("close");

  await done;

  assert.equal(stream.destroyed, true, "cursor must be destroyed on disconnect");
  assert.equal(released, 1, "pooled connection must be released exactly once");
});

test("normal completion still releases the connection exactly once", async () => {
  // A non-blocking stream (finite) must keep the existing release-once contract.
  async function* finite() {
    yield { time: 1 };
    yield { time: 2 };
  }
  let released = 0;
  const client = {
    query() {
      return finite();
    },
    release() {
      released++;
    },
  };
  const pool = {
    async connect() {
      return client;
    },
  };
  const res = new FakeRes();

  await streamQueryAsJsonArray(res as any, pool as any, "SELECT 1", []);

  assert.equal(res.body, JSON.stringify([{ time: 1 }, { time: 2 }]));
  assert.equal(released, 1, "pooled connection released exactly once on success");
});
