import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isStatementTimeout } from "../processing";

test("isStatementTimeout true only for pg code 57014", () => {
  assert.equal(isStatementTimeout({ code: "57014" }), true);
  assert.equal(isStatementTimeout(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" })), true);
  assert.equal(isStatementTimeout({ code: "23505" }), false);
  assert.equal(isStatementTimeout(new Error("boom")), false);
  assert.equal(isStatementTimeout(null), false);
  assert.equal(isStatementTimeout("57014"), false);
});
