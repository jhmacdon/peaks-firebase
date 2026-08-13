import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const skillRoot = join(
  __dirname,
  "../../../../.claude/skills/peaks-cloud-sql-proxy-recovery"
);

test("proxy recovery pins the Peaks instance and quota project", () => {
  const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
  const script = readFileSync(join(skillRoot, "scripts/ensure_proxy.sh"), "utf8");

  assert.match(skill, /--quota-project donner-a8608/);
  assert.match(skill, /Do not enable that API in\s+KOTH/);
  assert.match(script, /INSTANCE="donner-a8608:us-central1:peaks-db"/);
  assert.match(script, /QUOTA_PROJECT="donner-a8608"/);
  assert.match(script, /<key>RunAtLoad<\/key>/);
  assert.match(script, /<key>KeepAlive<\/key>/);
  assert.match(script, /\/readiness/);
  assert.match(script, /<string>--quiet<\/string>/);
});

test("route workers route reboot failures to proxy recovery", () => {
  for (const path of [
    join(__dirname, "../../../../.claude/skills/peaks-route-catalog-audit/SKILL.md"),
    join(__dirname, "../../../../.claude/skills/peaks-route-elevation-backfill/SKILL.md"),
  ]) {
    assert.match(
      readFileSync(path, "utf8"),
      /\$peaks-cloud-sql-proxy-recovery/
    );
  }
});
