import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectDestinationIdentity } from "./fetch_destination_identity.mjs";
import {
  compareRouteSourceFacts,
  validateSourceFacts,
} from "./compare_route_source_facts.mjs";

const workerCheckoutResolver = fileURLToPath(
  new URL(
    "../../../../.agents/skills/peaks-route-factory/scripts/resolve_worker_checkout.sh",
    import.meta.url
  )
);

const routeElevationWrapper = fileURLToPath(
  new URL(
    "../../peaks-route-elevation-backfill/scripts/route_elevation_jobs.sh",
    import.meta.url
  )
);

const routeCatalogAudit = fileURLToPath(
  new URL("./audit_catalog_routes.sh", import.meta.url)
);

const routeAuditSkill = fileURLToPath(
  new URL("../SKILL.md", import.meta.url)
);

const routeAuditLunaPrompt = fileURLToPath(
  new URL("../references/luna-goal-prompt.md", import.meta.url)
);

const routeAuditJobs = fileURLToPath(
  new URL(
    "../../../../cloud-sql/migrate/src/route-catalog-audit-jobs.ts",
    import.meta.url
  )
);

const routeAuditJobsMigration = fileURLToPath(
  new URL(
    "../../../../cloud-sql/migrations/20260803_route_catalog_audit_rule_v2.sql",
    import.meta.url
  )
);

const routeAuditJobsV3Migration = fileURLToPath(
  new URL(
    "../../../../cloud-sql/migrations/20260803_route_catalog_audit_rule_v3.sql",
    import.meta.url
  )
);

const routeAuditJobsFreshMigration = fileURLToPath(
  new URL(
    "../../../../cloud-sql/migrations/20260801_route_catalog_audit_jobs.sql",
    import.meta.url
  )
);

const workerPreflight = fileURLToPath(
  new URL(
    "../../../../.agents/skills/peaks-route-factory/scripts/worker_preflight.sh",
    import.meta.url
  )
);

const routeDatabaseWrapper = fileURLToPath(
  new URL(
    "../../../../.agents/skills/peaks-route-factory/scripts/with_route_db.sh",
    import.meta.url
  )
);

const routeDatabasePasswordLoader = fileURLToPath(
  new URL(
    "../../../../.agents/skills/peaks-route-factory/scripts/load_route_db_password.sh",
    import.meta.url
  )
);

const routeDatabasePasswordCache = fileURLToPath(
  new URL(
    "../../../../.agents/skills/peaks-route-factory/scripts/cache_route_db_password.sh",
    import.meta.url
  )
);

const routeTsxRunner = fileURLToPath(
  new URL(
    "../../../../cloud-sql/migrate/scripts/run-tsx.sh",
    import.meta.url
  )
);

const migratePackage = fileURLToPath(
  new URL("../../../../cloud-sql/migrate/package.json", import.meta.url)
);

test("approved worker checkouts resolve by exact path", () => {
  const checkouts = [
    [
      "/Users/josiahm/projects/peaks/firebase",
      "canonical",
    ],
    [
      "/Users/josiahm/projects/peaks/.workers/firebase-route-factory",
      "route-factory",
    ],
    [
      "/Users/josiahm/projects/peaks/.workers/firebase-route-audit",
      "luna-route-audit-01",
    ],
    [
      "/Users/josiahm/projects/peaks/.workers/firebase-route-audit-02",
      "luna-route-audit-02",
    ],
    [
      "/Users/josiahm/projects/peaks/.workers/firebase-route-audit-03",
      "luna-route-audit-03",
    ],
    [
      "/Users/josiahm/projects/peaks/.workers/firebase-route-audit-04",
      "luna-route-audit-04",
    ],
    [
      "/Users/josiahm/projects/peaks/.workers/firebase-route-elevation",
      "luna-route-elevation-01",
    ],
  ];
  for (const [checkoutPath, expected] of checkouts) {
    const actual = execFileSync(
      workerCheckoutResolver,
      [checkoutPath],
      { encoding: "utf8" }
    ).trim();
    assert.equal(actual, expected);
  }
  for (const rejectedPath of [
    "/Users/josiahm/projects/peaks/.workers/firebase-route-audit-01",
    "/tmp/firebase-route-audit-04",
    "/Users/josiahm/projects/peaks/.workers/firebase-route-audit-05",
    "/Users/josiahm/projects/peaks/.workers/firebase-route-elevation-01",
    "/Users/josiahm/projects/peaks/.workers/firebase-route-elevation-02",
    "/Users/josiahm/projects/peaks/.workers/firebase-route-elevations",
  ]) {
    assert.throws(
      () => execFileSync(
        workerCheckoutResolver,
        [rejectedPath],
        { encoding: "utf8", stdio: "pipe" }
      ),
      /Command failed/
    );
  }
});

test("elevation wrapper preflights before every queue call and owns its worker ID", () => {
  const source = readFileSync(routeElevationWrapper, "utf8");
  const databaseSource = readFileSync(routeDatabaseWrapper, "utf8");
  const databaseWrapperIndex = source.indexOf("with_route_db.sh");
  const npmIndex = source.indexOf("npm --prefix");
  assert.doesNotMatch(source, /worker_preflight\.sh/);
  assert.match(databaseSource, /worker_preflight\.sh/);
  assert.ok(databaseSource.indexOf("worker_preflight.sh") < databaseSource.indexOf('exec "$@"'));
  assert.ok(
    npmIndex > databaseWrapperIndex,
    "database wrapper runs the queue CLI"
  );
  assert.match(source, /luna-route-elevation-01/);
  assert.match(source, /--worker-id.*not allowed|not allowed.*--worker-id/s);
  assert.match(source, /claim.*--apply/s);
  assert.doesNotMatch(source, /mapfile|readarray|declare -A|\[\[/);
  assert.doesNotThrow(() => execFileSync("bash", ["-n", routeElevationWrapper]));
});

test("database wrapper accepts only a private local password cache", () => {
  const root = mkdtempSync(join(tmpdir(), "peaks-route-db-password-"));
  const repoRoot = join(root, "firebase-route-elevation");
  const credentialFile = join(root, ".peaks-route-db-password");
  try {
    mkdirSync(repoRoot);
    writeFileSync(credentialFile, "test-password\n");
    chmodSync(credentialFile, 0o600);
    const environment = {
      ...process.env,
      DB_PASS: "",
      PEAKS_ROUTE_DB_PASS: "",
      PEAKS_ROUTE_DB_PASSWORD_FILE: credentialFile,
    };
    const output = execFileSync(
      "bash",
      [
        "-euc",
        'source "$1" "$2"; printf "%s" "$DB_PASS"',
        "_",
        routeDatabasePasswordLoader,
        repoRoot,
      ],
      { encoding: "utf8", env: environment }
    );
    assert.equal(output, "test-password");

    chmodSync(credentialFile, 0o644);
    assert.throws(
      () => execFileSync(
        "bash",
        ["-euc", 'source "$1" "$2"', "_", routeDatabasePasswordLoader, repoRoot],
        { encoding: "utf8", env: environment, stdio: "pipe" }
      ),
      /Command failed/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const wrapperSource = readFileSync(routeDatabaseWrapper, "utf8");
  const cacheSource = readFileSync(routeDatabasePasswordCache, "utf8");
  assert.match(wrapperSource, /load_route_db_password\.sh/);
  assert.match(cacheSource, /--out-file="\$temporary_file"/);
  assert.match(cacheSource, /chmod 600 "\$temporary_file"/);
  assert.match(cacheSource, /mv -f "\$temporary_file" "\$credential_file"/);
  assert.doesNotMatch(cacheSource, /cat |printf.*DB_PASS|echo.*DB_PASS/);
});

test("password cache writer rejects symlinks and replaces loose files atomically", () => {
  const root = mkdtempSync(join(tmpdir(), "peaks-route-db-cache-writer-"));
  const scripts = join(root, ".agents/skills/peaks-route-factory/scripts");
  const bin = join(root, "bin");
  const credentialFile = join(root, ".peaks-route-db-password");
  const symlinkTarget = join(root, "symlink-target");
  try {
    mkdirSync(scripts, { recursive: true });
    mkdirSync(bin);
    const cacheScript = join(scripts, "cache_route_db_password.sh");
    const resolver = join(scripts, "resolve_worker_checkout.sh");
    const gcloud = join(bin, "gcloud");
    copyFileSync(routeDatabasePasswordCache, cacheScript);
    writeFileSync(resolver, "#!/usr/bin/env bash\nexit 0\n");
    writeFileSync(
      gcloud,
      "#!/usr/bin/env bash\nset -euo pipefail\noutput_file=''\nfor argument in \"$@\"; do\n  case \"$argument\" in --out-file=*) output_file=\"${argument#--out-file=}\" ;; esac\ndone\n[ -n \"$output_file\" ]\nprintf '%s\\n' fresh-secret >\"$output_file\"\n"
    );
    for (const executable of [cacheScript, resolver, gcloud]) {
      chmodSync(executable, 0o755);
    }
    const environment = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PEAKS_ROUTE_DB_PASSWORD_FILE: credentialFile,
    };

    writeFileSync(symlinkTarget, "must-not-change\n");
    symlinkSync(symlinkTarget, credentialFile);
    assert.throws(
      () => execFileSync(cacheScript, [], {
        encoding: "utf8", env: environment, stdio: "pipe",
      }),
      /Command failed/
    );
    assert.equal(readFileSync(symlinkTarget, "utf8"), "must-not-change\n");
    rmSync(credentialFile);

    writeFileSync(credentialFile, "old-secret\n");
    chmodSync(credentialFile, 0o644);
    execFileSync(cacheScript, [], { encoding: "utf8", env: environment });
    assert.equal(readFileSync(credentialFile, "utf8"), "fresh-secret\n");
    assert.equal(statSync(credentialFile).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("printed route audit SQL requires every linked summit and canonical elevation", () => {
  const sql = execFileSync(routeCatalogAudit, [
    "--route-id", "route-1", "--print-sql",
  ], { encoding: "utf8" });
  assert.match(sql, /ST_Distance\(sr\.path, d\.location\)/);
  assert.match(sql, /route_misses_linked_summit_gt_5m/);
  assert.match(sql, /worst_summit_gap_m/);
  assert.match(sql, /fault_summit_ids/);
  assert.match(sql, /fault_summit_names/);
  assert.match(sql, /fault_summit_gaps_m/);
  assert.match(sql, /shape IN \('out_and_back', 'point_to_point'\)/);
  assert.match(sql, /end_over_5m_from_summit/);
  assert.match(sql, /encode_route_elevation_profile\(rm\.path\)/);
  assert.match(sql, /IS DISTINCT FROM encode_route_elevation_profile\(rm\.path\)/);
  assert.match(sql, /missing_or_invalid_elevation_profile/);
  assert.match(sql, /route_elevation_profile_has_real_range\(rm\.path\)/);
  assert.match(sql, /flat_or_placeholder_elevation_profile/);
  assert.match(sql, /route_elevation_stats\(rc\.path\)/);
  assert.match(sql, /route_elevation_stats\(s\.path\)/);
  assert.match(sql, /route_elevation_stats_mismatch/);
  assert.match(sql, /segment_elevation_stats_mismatch/);
  assert.match(sql, /segment_elevation_stats_mismatch_ids/);
  assert.match(
    sql,
    /CASE WHEN rm\.gain IS DISTINCT FROM rm\.computed_gain\s+OR rm\.gain_loss IS DISTINCT FROM rm\.computed_gain_loss\s+THEN 'route_elevation_stats_mismatch'/
  );
  assert.match(
    sql,
    /CASE WHEN COALESCE\(rm\.segment_elevation_stats_mismatch_count, 0\) > 0\s+THEN 'segment_elevation_stats_mismatch'/
  );
  assert.doesNotMatch(sql, /end_over_250m_from_summit/);
  assert.doesNotMatch(sql, /flat_or_missing_elevation_profile/);
});

test("Luna waits for one bounded catalog checker instead of reading an empty live file", () => {
  const script = readFileSync(routeCatalogAudit, "utf8");
  const skill = readFileSync(routeAuditSkill, "utf8");
  const prompt = readFileSync(routeAuditLunaPrompt, "utf8");
  assert.match(script, /default_transaction_read_only=on/);
  assert.match(script, /jit=off/);
  assert.match(script, /statement_timeout=300000/);
  for (const instructions of [skill, prompt]) {
    assert.match(instructions, /yield_time_ms`? (?:set to )?30000/i);
    assert.match(instructions, /session_id/);
    assert.match(instructions, /write_stdin/);
    assert.match(instructions, /same session|same process/i);
    assert.match(instructions, /second (?:catalog )?checker/i);
    assert.match(instructions, /Ctrl-C/);
  }
});

test("Luna proves setup from a fresh wrapper call and uses bounded leases", () => {
  const skill = readFileSync(routeAuditSkill, "utf8");
  const prompt = readFileSync(routeAuditLunaPrompt, "utf8");
  for (const instructions of [skill, prompt]) {
    assert.match(instructions, /fresh run/i);
    assert.match(instructions, /never reuse|never reuse or infer/i);
    assert.match(instructions, /(?:current|this) turn/i);
    assert.match(instructions, /sandbox_permissions=require_escalated/);
    assert.match(instructions, /claim --lease-minutes 30\s+--apply/);
  }
  assert.match(prompt, /Heartbeat .*--lease-minutes 30/i);
});

test("path-derived elevation stats reject matching wrong route and segment values", () => {
  const sql = execFileSync(routeCatalogAudit, [
    "--route-id", "route-1", "--print-sql",
  ], { encoding: "utf8" });
  assert.match(
    sql,
    /route_elevation_stats\(rc\.path\) elevation_stats/
  );
  assert.match(
    sql,
    /rm\.gain IS DISTINCT FROM rm\.computed_gain\s+OR rm\.gain_loss IS DISTINCT FROM rm\.computed_gain_loss/
  );
  assert.match(
    sql,
    /route_elevation_stats\(s\.path\) elevation_stats/
  );
  assert.match(
    sql,
    /ss\.stored_gain IS DISTINCT FROM ss\.computed_gain\s+OR ss\.stored_gain_loss IS DISTINCT FROM ss\.computed_gain_loss/
  );
  assert.match(
    sql,
    /WHEN CARDINALITY\(rig\.error_issues\) > 0 THEN 'ERROR'/
  );
});

test("route audit jobs requeue v2 passes under rule version 3 without stealing leases", () => {
  const source = readFileSync(routeAuditJobs, "utf8");
  const migration = readFileSync(routeAuditJobsMigration, "utf8");
  const v3Migration = readFileSync(routeAuditJobsV3Migration, "utf8");
  const freshMigration = readFileSync(routeAuditJobsFreshMigration, "utf8");
  assert.match(source, /const AUDIT_RULE_VERSION = 3/);
  assert.match(source, /audit_rule_version/);
  assert.match(source, /job\.audit_rule_version < EXCLUDED\.audit_rule_version/);
  assert.match(source, /job\.audit_rule_version !== candidate\.audit_rule_version/);
  assert.match(source, /job\.state = 'auditing'/);
  assert.match(source, /\* 200/);
  assert.match(source, /NOT route_elevation_profile_has_real_range\(r\.path\)/);
  assert.match(source, /route_elevation_stats\(r\.path\)/);
  assert.match(source, /route_elevation_stats\(s\.path\)/);
  assert.match(source, /encode\(ST_AsEWKB\(segment\.path::geometry\), 'hex'\)/);
  assert.match(source, /COALESCE\(segment\.provenance::text, ''\)/);
  assert.match(source, /encode_route_elevation_profile\(segment\.path\)/);
  assert.doesNotMatch(source, /segment\.updated_at::text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS audit_rule_version INTEGER/);
  assert.match(migration, /SET audit_rule_version = 1/);
  assert.match(migration, /SET DEFAULT 2/);
  assert.match(migration, /SET NOT NULL/);
  assert.match(v3Migration, /ALTER COLUMN audit_rule_version SET DEFAULT 3/);
  assert.match(
    freshMigration,
    /CONSTRAINT route_catalog_audit_jobs_audit_rule_version_positive/
  );
});

test("elevation preflight contains dirty, stale, and runtime guards", () => {
  const wrapper = readFileSync(routeElevationWrapper, "utf8");
  const databaseWrapper = readFileSync(routeDatabaseWrapper, "utf8");
  const preflight = readFileSync(workerPreflight, "utf8");
  assert.match(wrapper, /with_route_db\.sh/);
  assert.ok(databaseWrapper.indexOf("worker_preflight.sh") < databaseWrapper.indexOf('exec "$@"'));
  assert.ok(preflight.indexOf("git -C \"$repo_root\" status") < preflight.indexOf("npm --prefix"));
  assert.ok(preflight.indexOf("rev-parse origin/main") < preflight.indexOf("npm --prefix"));
  assert.match(preflight, /route-elevation-jobs\.ts/);
  assert.match(preflight, /run-tsx\.sh/);
  assert.match(preflight, /tsx_runner.*-e|tsx_runner.*--help/s);
});

test("worker TypeScript runner avoids the tsx IPC command", () => {
  const source = readFileSync(routeTsxRunner, "utf8");
  const packageJson = JSON.parse(readFileSync(migratePackage, "utf8"));
  assert.match(source, /node --import \"\$tsx_loader\"/);
  assert.doesNotMatch(source, /node_modules\/\.bin\/tsx/);
  for (const scriptName of [
    "routes:jobs",
    "routes:integrity-repairs",
    "routes:audit-jobs",
    "routes:elevation-jobs",
  ]) {
    assert.match(packageJson.scripts[scriptName], /^\.\/scripts\/run-tsx\.sh /);
  }
  assert.equal(
    execFileSync(routeTsxRunner, ["--eval", "console.log('runner-ok')"], {
      encoding: "utf8",
    }).trim(),
    "runner-ok"
  );
});

test("dirty and stale elevation checkouts fail before the queue CLI runs", () => {
  const root = mkdtempSync(join(tmpdir(), "peaks-elevation-preflight-"));
  const skillScripts = join(
    root,
    ".claude/skills/peaks-route-elevation-backfill/scripts"
  );
  const factoryScripts = join(
    root,
    ".agents/skills/peaks-route-factory/scripts"
  );
  const bin = join(root, "bin");
  const marker = join(root, "npm-called");
  try {
    mkdirSync(skillScripts, { recursive: true });
    mkdirSync(factoryScripts, { recursive: true });
    mkdirSync(bin);
    const wrapper = join(skillScripts, "route_elevation_jobs.sh");
    const preflight = join(factoryScripts, "worker_preflight.sh");
    const resolver = join(factoryScripts, "resolve_worker_checkout.sh");
    const databaseWrapper = join(factoryScripts, "with_route_db.sh");
    const npm = join(bin, "npm");
    copyFileSync(routeElevationWrapper, wrapper);
    copyFileSync(workerPreflight, preflight);
    writeFileSync(resolver, "#!/usr/bin/env bash\nprintf '%s\\n' luna-route-elevation-01\n");
    writeFileSync(
      databaseWrapper,
      "#!/usr/bin/env bash\nset -euo pipefail\nscript_dir=\"$(cd \"$(dirname \"$0\")\" && pwd)\"\n\"$script_dir/worker_preflight.sh\"\nexec \"$@\"\n"
    );
    writeFileSync(npm, "#!/usr/bin/env bash\n: > \"$NPM_MARKER\"\nexit 0\n");
    for (const executable of [wrapper, preflight, resolver, databaseWrapper, npm]) {
      chmodSync(executable, 0o755);
    }
    writeFileSync(join(root, "tracked.txt"), "base\n");
    execFileSync("git", ["init", "-q", root]);
    execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
    execFileSync("git", ["-C", root, "add", "."]);
    execFileSync("git", ["-C", root, "commit", "-qm", "base"]);
    const base = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["-C", root, "commit", "--allow-empty", "-qm", "origin main"]);
    const originMain = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["-C", root, "update-ref", "refs/remotes/origin/main", originMain]);
    execFileSync("git", ["-C", root, "reset", "--hard", "-q", base]);
    const environment = {
      ...process.env,
      NPM_MARKER: marker,
      PATH: `${bin}:${process.env.PATH}`,
    };
    writeFileSync(join(root, "dirty.txt"), "dirty\n");
    for (const [expected, clean] of [
      [/route worker checkout is dirty/, false],
      [/route worker checkout is stale/, true],
    ]) {
      if (clean) rmSync(join(root, "dirty.txt"));
      let failure;
      try {
        execFileSync(wrapper, ["stats"], {
          encoding: "utf8", env: environment, stdio: "pipe",
        });
        assert.fail("wrapper must fail during preflight");
      } catch (error) {
        failure = error;
      }
      assert.match(String(failure.stderr), expected);
      assert.equal(existsSync(marker), false, "preflight must block npm");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("elevation wrapper parses both show filters in either order", () => {
  const root = mkdtempSync(join(tmpdir(), "peaks-elevation-wrapper-"));
  const skillScripts = join(
    root,
    ".claude/skills/peaks-route-elevation-backfill/scripts"
  );
  const factoryScripts = join(
    root,
    ".agents/skills/peaks-route-factory/scripts"
  );
  const bin = join(root, "bin");
  const preflightLog = join(root, "preflight-log");
  try {
    mkdirSync(skillScripts, { recursive: true });
    mkdirSync(factoryScripts, { recursive: true });
    mkdirSync(bin);
    const wrapper = join(skillScripts, "route_elevation_jobs.sh");
    copyFileSync(routeElevationWrapper, wrapper);
    writeFileSync(
      join(factoryScripts, "worker_preflight.sh"),
      "#!/usr/bin/env bash\nprintf '%s\\n' preflight >>\"$PREFLIGHT_LOG\"\n"
    );
    writeFileSync(join(factoryScripts, "resolve_worker_checkout.sh"), "#!/usr/bin/env bash\nprintf '%s\\n' luna-route-elevation-01\n");
    writeFileSync(
      join(factoryScripts, "with_route_db.sh"),
      "#!/usr/bin/env bash\nset -euo pipefail\nscript_dir=\"$(cd \"$(dirname \"$0\")\" && pwd)\"\n\"$script_dir/worker_preflight.sh\"\nexec \"$@\"\n"
    );
    writeFileSync(
      join(bin, "npm"),
      "#!/usr/bin/env bash\nprintf '%s\\n' npm >>\"$PREFLIGHT_LOG\"\nprintf '%s\\n' \"$@\"\n"
    );
    for (const executable of [
      wrapper,
      join(factoryScripts, "worker_preflight.sh"),
      join(factoryScripts, "resolve_worker_checkout.sh"),
      join(factoryScripts, "with_route_db.sh"),
      join(bin, "npm"),
    ]) chmodSync(executable, 0o755);
    const environment = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PREFLIGHT_LOG: preflightLog,
    };
    for (const args of [
      ["show", "--route-id", "route-1", "--state", "retry"],
      ["show", "--state", "retry", "--route-id", "route-1"],
    ]) {
      rmSync(preflightLog, { force: true });
      const output = execFileSync(wrapper, args, { encoding: "utf8", env: environment });
      assert.match(output, /show/);
      assert.match(output, /--route-id\nroute-1\n--state\nretry/);
      assert.equal(
        readFileSync(preflightLog, "utf8"),
        "preflight\nnpm\n",
        "the shared database wrapper preflights exactly once before npm"
      );
    }
    assert.throws(
      () => execFileSync(wrapper, ["claim", "--apply", "--worker-id", "wrong-worker"], {
        encoding: "utf8", env: environment, stdio: "pipe",
      }),
      /Command failed/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const catalogAudit = {
  records: [
    {
      type: "identity",
      severity: "REVIEW",
      destination_id: "peak-1",
      destination_name: "대둔산",
      issues: ["localized_display_name_requires_source_review"],
      metrics: {
        stored_name: "대둔산",
        country_code: "KR",
        osm_id: "3819433157",
        wikidata_id: "Q5208179",
      },
    },
    {
      type: "selection",
      severity: "ERROR",
      destination_id: "peak-1",
      item_id: "route-1",
      issues: ["selected_route_has_errors"],
    },
    {
      type: "route",
      severity: "ERROR",
      destination_id: "peak-1",
      item_id: "route-1",
      item_name: "금남정맥",
      issues: ["legacy_route_coverage_import"],
      metrics: { status: "active", one_way_m: 52_000 },
    },
    {
      type: "route",
      severity: "ERROR",
      destination_id: "peak-1",
      item_id: "route-2",
      item_name: "금남정맥",
      issues: ["legacy_route_coverage_import"],
      metrics: { status: "active", one_way_m: 64_000 },
    },
  ],
};

const facts = {
  destination_id: "peak-1",
  preferred_display_name: "Daedunsan",
  local_names: ["대둔산"],
  aliases: ["Daedunsan Peak"],
  standard_route: {
    name: "Mount Daedunsan",
    aliases: ["Daedunsan parking lot–Macheondae"],
    trailhead_name: "Daedunsan Provincial Park",
    distance_m: 4_345,
    distance_basis: "round_trip",
    shape: "out_and_back",
    gain_m: 553,
    activity: "hike",
    access: "public park trail; check current closures",
  },
  sources: [
    {
      publisher: "AllTrails",
      url: "https://www.alltrails.com/example",
      retrieved_at: "2026-08-01",
      supports: [
        "route_identity", "trailhead", "distance", "shape", "gain", "activity",
      ],
      facts: {
        route_name: "Mount Daedunsan",
        trailhead_name: "Daedunsan Provincial Park",
        distance_m: 4_345,
        distance_basis: "round_trip",
        shape: "out_and_back",
        gain_m: 553,
        activity: "hike",
      },
    },
    {
      publisher: "OpenStreetMap",
      url: "https://www.openstreetmap.org/node/3819433157",
      retrieved_at: "2026-08-01",
      supports: ["route_identity", "trailhead", "access"],
      facts: {
        route_name: "Mount Daedunsan",
        trailhead_name: "Daedunsan Provincial Park",
        access: "public park trail; check current closures",
      },
    },
  ],
};

test("linked OSM and Wikidata names expose an English display-name mismatch", async () => {
  const responses = new Map([
    [
      "https://api.openstreetmap.org/api/0.6/node/3819433157.json",
      {
        elements: [{
          type: "node",
          id: 3819433157,
          tags: {
            name: "대둔산",
            "name:en": "Daedunsan Peak",
            "name:ko": "대둔산",
          },
        }],
      },
    ],
    [
      "https://www.wikidata.org/wiki/Special:EntityData/Q5208179.json",
      {
        entities: {
          Q5208179: {
            labels: {
              en: { language: "en", value: "Daedunsan" },
              ko: { language: "ko", value: "대둔산" },
            },
            aliases: {},
          },
        },
      },
    ],
  ]);
  const fakeFetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => responses.get(String(url)),
  });

  const result = await collectDestinationIdentity(catalogAudit, fakeFetch);
  assert.deepEqual(result.english_candidates, ["Daedunsan Peak", "Daedunsan"]);
  assert.ok(result.findings.includes("stored_display_name_differs_from_english_sources"));
  assert.ok(!result.findings.includes("english_name_sources_disagree"));
});

test("source facts require two independent publishers", () => {
  assert.throws(
    () => validateSourceFacts({
      ...facts,
      sources: [facts.sources[0], { ...facts.sources[0] }],
    }),
    /two independent publishers/
  );
});

test("Daedunsan-scale legacy routes fail the external plausibility check", () => {
  const identityAudit = {
    destination_id: "peak-1",
    stored_name: "대둔산",
    english_candidates: ["Daedunsan Peak", "Daedunsan"],
    findings: [],
  };
  const result = compareRouteSourceFacts(catalogAudit, identityAudit, facts);
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.standard_route.expected_one_way_m, 2_173);
  assert.ok(result.findings.some((finding) =>
    finding.type === "display_name_mismatch"
  ));
  assert.ok(result.findings.some((finding) =>
    finding.type === "no_plausible_standard_route"
  ));
  assert.deepEqual(result.routes.map((route) => route.action), [
    "supersede",
    "supersede",
  ]);
});

test("quarantined legacy routes do not block a valid active standard route", () => {
  const repairedCatalog = {
    records: [
      {
        ...catalogAudit.records[0],
        severity: "REVIEW",
        issues: ["localized_display_name_requires_source_review"],
        metrics: {
          ...catalogAudit.records[0].metrics,
          stored_name: "Daedunsan",
          search_name: "daedunsan daedunsan peak 대둔산",
          names: {
            english: "Daedunsan",
            local: ["대둔산"],
            aliases: ["Daedunsan Peak"],
          },
        },
      },
      {
        type: "selection",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "standard-route",
        issues: [],
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "standard-route",
        item_name: "Mount Daedunsan",
        issues: [],
        metrics: {
          status: "active",
          one_way_m: 2_175,
          gain_m: 553,
          shape: "out_and_back",
          trailhead: "Daedunsan Provincial Park",
        },
      },
      {
        ...catalogAudit.records[2],
        metrics: { status: "superseded", one_way_m: 52_000 },
      },
    ],
  };
  const repairedIdentity = {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    english_candidates: ["Daedunsan Peak", "Daedunsan"],
    findings: [],
    known_names: ["Daedunsan", "Daedunsan Peak", "대둔산"],
  };
  const result = compareRouteSourceFacts(repairedCatalog, repairedIdentity, facts);
  assert.equal(result.verdict, "PASS");
  assert.deepEqual(result.routes.map((route) => route.action), [
    "keep",
    "supersede",
  ]);

  const missingSearchCatalog = structuredClone(repairedCatalog);
  missingSearchCatalog.records[0].issues = ["missing_search_name"];
  missingSearchCatalog.records[0].metrics.search_name = null;
  const missingSearchResult = compareRouteSourceFacts(missingSearchCatalog, {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    english_candidates: ["Daedunsan Peak", "Daedunsan"],
    findings: [],
    known_names: ["Daedunsan", "Daedunsan Peak", "대둔산"],
  }, facts);
  assert.equal(missingSearchResult.verdict, "REVIEW");
  assert.ok(missingSearchResult.findings.some((finding) =>
    finding.type === "unresolved_catalog_reviews"
  ));

  const mismatchedCompleteSource = structuredClone(facts);
  mismatchedCompleteSource.sources[0].facts.route_name = "Different Traverse";
  mismatchedCompleteSource.sources[0].facts.trailhead_name = "Other Trailhead";
  mismatchedCompleteSource.sources[0].facts.activity = "scramble";
  const mismatchedCompleteResult = compareRouteSourceFacts(
    repairedCatalog,
    repairedIdentity,
    mismatchedCompleteSource
  );
  assert.equal(mismatchedCompleteResult.verdict, "REVIEW");
  assert.ok(mismatchedCompleteResult.findings.some((finding) =>
    finding.type === "source_route_fact_conflicts"
  ));

  const inventedAccess = structuredClone(facts);
  inventedAccess.standard_route.access = "open year-round";
  const inventedAccessResult = compareRouteSourceFacts(
    repairedCatalog,
    repairedIdentity,
    inventedAccess
  );
  assert.equal(inventedAccessResult.verdict, "REVIEW");
  assert.ok(inventedAccessResult.findings.some((finding) =>
    finding.type === "source_route_fact_conflicts" &&
    finding.reviews.some((review) =>
      review.type === "no_access_source_matches_standard"
    )
  ));

  const oneWayPartialSource = structuredClone(facts);
  oneWayPartialSource.sources.push({
    publisher: "Partial Distance Source",
    url: "https://example.net/distance",
    retrieved_at: "2026-08-01",
    supports: ["distance"],
    facts: {
      distance_m: 2_173,
      distance_basis: "one_way",
    },
  });
  assert.doesNotThrow(() => validateSourceFacts(oneWayPartialSource));
  assert.equal(
    compareRouteSourceFacts(
      repairedCatalog,
      repairedIdentity,
      oneWayPartialSource
    ).verdict,
    "PASS"
  );

  const impossiblePartialSource = structuredClone(facts);
  impossiblePartialSource.sources.push({
    publisher: "Impossible Shape Source",
    url: "https://example.net/impossible",
    retrieved_at: "2026-08-01",
    supports: ["distance", "shape"],
    facts: {
      distance_m: 4_345,
      distance_basis: "round_trip",
      shape: "point_to_point",
    },
  });
  assert.throws(
    () => validateSourceFacts(impossiblePartialSource),
    /point_to_point source distance cannot be round_trip/
  );

  const conflictingPartialSource = structuredClone(facts);
  conflictingPartialSource.sources.push({
    publisher: "Long Variant Source",
    url: "https://example.net/long-variant",
    retrieved_at: "2026-08-01",
    supports: ["distance", "shape"],
    facts: {
      distance_m: 48_000,
      distance_basis: "one_way",
      shape: "out_and_back",
    },
  });
  const conflictingPartialResult = compareRouteSourceFacts(
    repairedCatalog,
    repairedIdentity,
    conflictingPartialSource
  );
  assert.equal(conflictingPartialResult.verdict, "REVIEW");
  assert.ok(conflictingPartialResult.findings.some((finding) =>
    finding.type === "source_route_fact_conflicts" &&
    finding.reviews.some((review) =>
      review.type === "source_facts_conflict_with_standard"
    )
  ));

  const zeroGainFacts = structuredClone(facts);
  zeroGainFacts.standard_route.gain_m = 0;
  zeroGainFacts.sources[0].facts.gain_m = 0;
  const zeroGainCatalog = structuredClone(repairedCatalog);
  zeroGainCatalog.records[2].metrics.gain_m = 0;
  assert.equal(
    compareRouteSourceFacts(
      zeroGainCatalog,
      repairedIdentity,
      zeroGainFacts
    ).verdict,
    "PASS"
  );
  zeroGainCatalog.records[2].metrics.gain_m = 1_000;
  const wrongZeroGainResult = compareRouteSourceFacts(
    zeroGainCatalog,
    repairedIdentity,
    zeroGainFacts
  );
  assert.equal(wrongZeroGainResult.verdict, "FAIL");
  assert.ok(wrongZeroGainResult.routes[0].findings.includes(
    "gain_far_from_standard"
  ));
});

test("a matching-distance wrong route cannot pass", () => {
  const wrongCatalog = {
    records: [
      {
        ...catalogAudit.records[0],
        severity: "INFO",
        issues: [],
        metrics: {
          ...catalogAudit.records[0].metrics,
          stored_name: "Daedunsan",
          search_name: "daedunsan daedunsan peak 대둔산",
          names: {
            english: "Daedunsan",
            local: ["대둔산"],
            aliases: ["Daedunsan Peak"],
          },
        },
      },
      {
        type: "selection",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "wrong-route",
        issues: [],
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "wrong-route",
        item_name: "Wrong Traverse",
        issues: [],
        metrics: {
          status: "active",
          one_way_m: 2_175,
          gain_m: 553,
          shape: "out_and_back",
          trailhead: "Wrong Trailhead",
        },
      },
    ],
  };
  const result = compareRouteSourceFacts(wrongCatalog, {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    findings: [],
    known_names: ["Daedunsan", "Daedunsan Peak", "대둔산"],
  }, facts);
  assert.equal(result.verdict, "REVIEW");
  assert.equal(result.routes[0].action, "needs human review");
  assert.ok(result.findings.some((finding) =>
    finding.type === "active_route_source_conflicts"
  ));
});

test("one plausible route does not hide a far-longer active route", () => {
  const mixedCatalog = {
    records: [
      {
        ...catalogAudit.records[0],
        severity: "INFO",
        issues: [],
        metrics: {
          ...catalogAudit.records[0].metrics,
          stored_name: "Daedunsan",
          search_name: "daedunsan daedunsan peak 대둔산",
          names: {
            english: "Daedunsan",
            local: ["대둔산"],
            aliases: ["Daedunsan Peak"],
          },
        },
      },
      {
        type: "selection",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "standard-route",
        issues: [],
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "standard-route",
        item_name: "Mount Daedunsan",
        issues: [],
        metrics: {
          status: "active",
          one_way_m: 2_175,
          gain_m: 553,
          shape: "out_and_back",
          trailhead: "Daedunsan Provincial Park",
        },
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "wrong-long-route",
        item_name: "Mount Daedunsan",
        issues: [],
        metrics: {
          status: "active",
          one_way_m: 20_000,
          gain_m: 553,
          shape: "out_and_back",
          trailhead: "Daedunsan Provincial Park",
        },
      },
    ],
  };
  const result = compareRouteSourceFacts(mixedCatalog, {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    findings: [],
    known_names: ["Daedunsan", "Daedunsan Peak", "대둔산"],
  }, facts);
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.routes[1].action, "supersede");
  assert.ok(result.findings.some((finding) =>
    finding.type === "active_routes_require_supersede"
  ));
});

test("wrong stored shape and gain require repair", () => {
  const wrongStatsCatalog = {
    records: [
      {
        ...catalogAudit.records[0],
        severity: "INFO",
        issues: [],
        metrics: {
          ...catalogAudit.records[0].metrics,
          stored_name: "Daedunsan",
          search_name: "daedunsan daedunsan peak 대둔산",
          names: {
            english: "Daedunsan",
            local: ["대둔산"],
            aliases: ["Daedunsan Peak"],
          },
        },
      },
      {
        type: "selection",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "wrong-stats-route",
        issues: [],
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "wrong-stats-route",
        item_name: "Mount Daedunsan",
        issues: [],
        metrics: {
          status: "active",
          one_way_m: 2_175,
          gain_m: 50,
          shape: "loop",
          trailhead: "Daedunsan Provincial Park",
        },
      },
    ],
  };
  const result = compareRouteSourceFacts(wrongStatsCatalog, {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    findings: [],
    known_names: ["Daedunsan", "Daedunsan Peak", "대둔산"],
  }, facts);
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.routes[0].action, "repair");
  assert.ok(result.routes[0].findings.includes("shape_differs_from_standard"));
  assert.ok(result.routes[0].findings.includes("gain_far_from_standard"));
});

test("missing searchable local names cannot pass", () => {
  const missingNamesCatalog = {
    records: [
      {
        ...catalogAudit.records[0],
        severity: "INFO",
        issues: [],
        metrics: {
          ...catalogAudit.records[0].metrics,
          stored_name: "Daedunsan",
          search_name: "daedunsan",
          names: { english: "Daedunsan" },
        },
      },
      {
        type: "selection",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "standard-route",
        issues: [],
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "standard-route",
        item_name: "Mount Daedunsan",
        issues: [],
        metrics: {
          status: "active",
          one_way_m: 2_175,
          gain_m: 553,
          shape: "out_and_back",
          trailhead: "Daedunsan Provincial Park",
        },
      },
    ],
  };
  const result = compareRouteSourceFacts(missingNamesCatalog, {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    findings: [],
    known_names: ["Daedunsan", "Daedunsan Peak", "대둔산"],
  }, facts);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.findings.some((finding) =>
    finding.type === "catalog_names_not_searchable"
  ));
});

test("incomplete public evidence reaches a terminal human-review result", () => {
  const result = compareRouteSourceFacts({
    records: [
      {
        ...catalogAudit.records[0],
        severity: "INFO",
        issues: [],
        metrics: {
          ...catalogAudit.records[0].metrics,
          stored_name: "Daedunsan",
        },
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "unknown-route",
        item_name: "Unknown Route",
        issues: [],
        metrics: { status: "active", one_way_m: 2_000 },
      },
    ],
  }, {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    findings: [],
  }, {
    destination_id: "peak-1",
    preferred_display_name: "Daedunsan",
    local_names: ["대둔산"],
    aliases: ["Daedunsan Peak"],
    standard_route: null,
    sources: [],
    evidence_gaps: ["no second independent public route source"],
  });
  assert.equal(result.verdict, "REVIEW");
  assert.equal(result.state, "needs_human");
  assert.equal(result.routes[0].action, "needs human review");
});

test("a stale linked identity source becomes review evidence", async () => {
  const fakeFetch = async (url) => {
    if (String(url).includes("openstreetmap")) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        entities: {
          Q5208179: {
            labels: {
              en: { language: "en", value: "Daedunsan" },
              ko: { language: "ko", value: "대둔산" },
            },
            aliases: {},
          },
        },
      }),
    };
  };
  const result = await collectDestinationIdentity(catalogAudit, fakeFetch);
  assert.equal(result.osm, null);
  assert.equal(result.source_errors.length, 1);
  assert.ok(result.findings.includes("identity_source_errors"));
  assert.equal(result.wikidata.labels.en, "Daedunsan");
});

test("unresolved active catalog warnings cannot pass", () => {
  const warningCatalog = {
    records: [
      {
        ...catalogAudit.records[0],
        severity: "INFO",
        issues: [],
        metrics: {
          ...catalogAudit.records[0].metrics,
          stored_name: "Daedunsan",
          search_name: "daedunsan daedunsan peak 대둔산",
          names: {
            english: "Daedunsan",
            local: ["대둔산"],
            aliases: ["Daedunsan Peak"],
          },
        },
      },
      {
        type: "selection",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "warning-route",
        issues: [],
      },
      {
        type: "route",
        severity: "WARN",
        destination_id: "peak-1",
        item_id: "warning-route",
        item_name: "Mount Daedunsan",
        issues: ["point_jump_gt_250m"],
        metrics: {
          status: "active",
          one_way_m: 2_175,
          gain_m: 553,
          shape: "out_and_back",
          trailhead: "Daedunsan Provincial Park",
        },
      },
    ],
  };
  const result = compareRouteSourceFacts(warningCatalog, {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    findings: [],
    known_names: ["Daedunsan", "Daedunsan Peak", "대둔산"],
  }, facts);
  assert.equal(result.verdict, "REVIEW");
  assert.equal(result.routes[0].action, "needs human review");
  assert.ok(result.routes[0].findings.includes("point_jump_gt_250m"));
  assert.ok(result.findings.some((finding) =>
    finding.type === "unresolved_catalog_reviews"
  ));
});

test("standard facts cannot mix two different source route variants", () => {
  const mixedSourceFacts = {
    destination_id: "vaalserberg",
    preferred_display_name: "Vaalserberg",
    local_names: ["Vaalserberg"],
    aliases: [],
    standard_route: {
      name: "Drielandenpunt loop",
      aliases: [],
      trailhead_name: "Bellevue flat parking area",
      distance_m: 5_100,
      distance_basis: "round_trip",
      shape: "loop",
      gain_m: 200,
      activity: "hike",
      access: "open year-round",
    },
    sources: [
      {
        publisher: "Visit Zuid-Limburg",
        url: "https://example.com/official",
        retrieved_at: "2026-08-01",
        supports: [
          "route_identity", "trailhead", "distance", "shape", "access",
        ],
        facts: {
          route_name: "Drielandenpunt route",
          trailhead_name: "Drielandenpunt",
          distance_m: 5_100,
          distance_basis: "round_trip",
          shape: "loop",
          access: "public route",
        },
      },
      {
        publisher: "AllTrails",
        url: "https://example.org/alltrails",
        retrieved_at: "2026-08-01",
        supports: [
          "route_identity", "trailhead", "distance", "shape", "gain",
          "activity",
        ],
        facts: {
          route_name: "Vaals–Drielandenpunt loop",
          trailhead_name: "Bellevue flat parking area",
          distance_m: 6_400,
          distance_basis: "round_trip",
          shape: "loop",
          gain_m: 200,
          activity: "hike",
        },
      },
    ],
  };
  const result = compareRouteSourceFacts({
    records: [
      {
        type: "identity",
        severity: "INFO",
        destination_id: "vaalserberg",
        issues: [],
        metrics: {
          stored_name: "Vaalserberg",
          search_name: "vaalserberg",
          names: { english: "Vaalserberg", local: ["Vaalserberg"] },
        },
      },
      {
        type: "selection",
        severity: "PASS",
        destination_id: "vaalserberg",
        item_id: "route",
        issues: [],
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "vaalserberg",
        item_id: "route",
        item_name: "Drielandenpunt loop",
        issues: [],
        metrics: {
          status: "active",
          one_way_m: 5_100,
          gain_m: 200,
          shape: "loop",
          trailhead: "Bellevue flat parking area",
        },
      },
    ],
  }, {
    destination_id: "vaalserberg",
    stored_name: "Vaalserberg",
    findings: [],
    known_names: ["Vaalserberg"],
  }, mixedSourceFacts);
  assert.equal(result.verdict, "REVIEW");
  assert.ok(result.findings.some((finding) =>
    finding.type === "source_route_fact_conflicts" &&
    finding.reviews.some((review) =>
      review.type === "standard_route_combines_source_variants"
    )
  ));
});
