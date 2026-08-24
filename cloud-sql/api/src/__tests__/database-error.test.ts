import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isTransientDatabaseError } from "../lib/database-error";

test("classifies pool waits and database recovery as transient", () => {
  assert.equal(
    isTransientDatabaseError(new Error("timeout exceeded when trying to connect")),
    true
  );
  assert.equal(
    isTransientDatabaseError(new Error("Connection terminated due to connection timeout")),
    true
  );
  assert.equal(
    isTransientDatabaseError(Object.assign(new Error("cannot connect"), { code: "57P03" })),
    true
  );
  assert.equal(
    isTransientDatabaseError(Object.assign(new Error("socket refused"), { code: "ECONNREFUSED" })),
    true
  );
});

test("does not retry broken SQL or application errors", () => {
  assert.equal(
    isTransientDatabaseError(Object.assign(new Error("syntax error"), { code: "42601" })),
    false
  );
  assert.equal(isTransientDatabaseError(new Error("column does not exist")), false);
  assert.equal(isTransientDatabaseError("connection terminated"), false);
});
