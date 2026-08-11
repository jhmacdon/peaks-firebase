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
    assert.match(source, /outcome.*destination_deleted/s);
    assert.match(source, /do not (?:run )?release/i);
  }
});
