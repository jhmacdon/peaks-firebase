import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const skillRoot = join(
  __dirname,
  "../../../../.claude/skills/peaks-route-catalog-audit"
);

test("recurring audit instructions diagnose a vanished destination without releasing", () => {
  for (const file of [
    "SKILL.md",
    "references/luna-goal-prompt.md",
  ]) {
    const source = readFileSync(join(skillRoot, file), "utf8");
    assert.match(source, /diagnose-loss --destination-id\s+DESTINATION_ID/);
    assert.match(source, /No\s+single\s+live\s+audit\s+lease\s+matched/);
    assert.match(source, /No\s+live\s+audit\s+lease\s+matched/);
    assert.match(source, /No\s+single\s+audit\s+lease\s+matched/);
    assert.match(source, /No\s+audit\s+lease\s+matched/);
    assert.match(source, /outcome.*destination_deleted/s);
    assert.match(source, /job_terminal/);
    assert.match(source, /job_requeued/);
    assert.match(source, /job_terminal.*without operator action/s);
    assert.match(source, /job_requeued.*without operator action/s);
    assert.match(source, /do not (?:run )?release/i);
  }
});

test("recurring audit instructions never complete and release one result", () => {
  const source = readFileSync(
    join(skillRoot, "references/luna-goal-prompt.md"),
    "utf8"
  );
  assert.match(source, /Complete on success or release on failure/);
  assert.match(source, /never run both commands for one result/);
});
