import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeStoredListCompletionTarget,
  readImportedListCompletionTarget,
} from "../list-completion-target";

const migration = readFileSync(
  resolve(__dirname, "../../../migrations/20260831_list_completion_target.sql"),
  "utf8"
);
const schema = readFileSync(resolve(__dirname, "../../../schema.sql"), "utf8");
const firestoreMigrator = readFileSync(
  resolve(__dirname, "../migrate-list-record.ts"),
  "utf8"
);

test("normalizes only positive integer targets within the roster", () => {
  assert.equal(normalizeStoredListCompletionTarget(13, 18), 13);
  assert.equal(normalizeStoredListCompletionTarget(null, 18), null);
  assert.equal(normalizeStoredListCompletionTarget(undefined, 18), null);
  assert.equal(normalizeStoredListCompletionTarget(0, 18), null);
  assert.equal(normalizeStoredListCompletionTarget(19, 18), null);
  assert.equal(normalizeStoredListCompletionTarget(13.5, 18), null);
  assert.equal(normalizeStoredListCompletionTarget("13", 18), null);
  assert.equal(normalizeStoredListCompletionTarget(1, 0), null);
});

test("reads both import spellings but keeps an explicit client null", () => {
  assert.equal(readImportedListCompletionTarget({ completionTarget: 13 }), 13);
  assert.equal(readImportedListCompletionTarget({ completion_target: 10 }), 10);
  assert.equal(
    readImportedListCompletionTarget({ completionTarget: null, completion_target: 10 }),
    null
  );
});

test("migration and baseline schema share the nullable field and bounded read helper", () => {
  for (const sql of [migration, schema]) {
    assert.match(sql, /completion_target\s+INT/);
    assert.match(sql, /lists_completion_target_positive/);
    assert.match(sql, /completion_target IS NULL OR completion_target > 0/);
    assert.match(sql, /effective_list_completion_target/);
    assert.match(sql, /configured_target BETWEEN 1 AND/);
  }
});

test("the Firestore migrator reads either field spelling and writes the column", () => {
  assert.match(firestoreMigrator, /readImportedListCompletionTarget\(value\)/);
  assert.match(firestoreMigrator, /INSERT INTO lists \(id, name, description, owner, completion_target\)/);
  assert.match(firestoreMigrator, /completion_target = EXCLUDED\.completion_target/);
  assert.match(firestoreMigrator, /DELETE FROM list_destinations/);
  assert.match(firestoreMigrator, /WHERE list_id = \$1/);
});
