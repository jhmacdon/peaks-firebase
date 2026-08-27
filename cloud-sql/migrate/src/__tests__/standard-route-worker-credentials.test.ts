import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const repositoryRoot = join(__dirname, "../../../..");
const scriptsRoot = join(
  repositoryRoot,
  ".agents/skills/peaks-route-factory/scripts"
);
const routeWorkerEnvironmentPath = join(
  scriptsRoot,
  "route_worker_environment.sh"
);
const routeJobsPath = join(scriptsRoot, "route_jobs.sh");
const withRouteDatabasePath = join(scriptsRoot, "with_route_db.sh");
const workerSystemTemporaryRoot =
  existsSync("/private/tmp") && !lstatSync("/private/tmp").isSymbolicLink()
    ? "/private/tmp"
    : "/tmp";
const workerCacheRoot = join(workerSystemTemporaryRoot, "peaks-route-worker");
const directWorkerShellPaths = [
  routeJobsPath,
  join(scriptsRoot, "import_route_candidate.sh"),
  join(scriptsRoot, "check_pending_route_source.sh"),
  join(scriptsRoot, "cache_route_db_password.sh"),
];
const credentialBearingCurlHelperPaths = [
  join(
    repositoryRoot,
    ".claude/skills/peaks-standard-route-backfill/scripts/find_osm_trail_geometry.sh"
  ),
  join(
    repositoryRoot,
    ".claude/skills/peaks-standard-route-backfill/scripts/find_public_trail_geometry.sh"
  ),
];

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function cleanWorkerTargetEnvironment(
  additions: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...additions };
  for (const name of [
    "PEAKS_ROUTE_DB_HOST",
    "PEAKS_ROUTE_DB_PORT",
    "PEAKS_ROUTE_DB_NAME",
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
  ]) {
    if (!(name in additions)) delete environment[name];
  }
  return environment;
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o700 });
  chmodSync(path, 0o700);
}

test("worker credentials use fixed lane-specific sources", () => {
  const loader = readFileSync(
    join(
      repositoryRoot,
      ".agents/skills/peaks-route-factory/scripts/load_route_db_password.sh"
    ),
    "utf8"
  );
  const wrapper = readFileSync(
    join(
      repositoryRoot,
      ".agents/skills/peaks-route-factory/scripts/with_route_db.sh"
    ),
    "utf8"
  );

  assert.match(loader, /com\.jhm\.peaks\.route-factory-db/);
  assert.match(loader, /com\.jhm\.peaks\.route-reviewer-db/);
  assert.doesNotMatch(loader, /PEAKS_ROUTE_(?:FACTORY|REVIEW)_KEYCHAIN/);
  assert.doesNotMatch(
    wrapper,
    /database_user="\$\{PEAKS_ROUTE_(?:FACTORY|REVIEW)_DB_USER/
  );
  assert.match(
    loader,
    /security find-generic-password[\s\S]*-a "\$\{DB_USER:[^}]+\}"[\s\S]*-s "\$keychain_service"[\s\S]*-w/
  );
  assert.match(
    wrapper,
    /credential_profile="factory"[\s\S]*unset PEAKS_ROUTE_REVIEW_DB_PASS PEAKS_ROUTE_DB_PASS/
  );
  assert.match(
    wrapper,
    /credential_profile="reviewer"[\s\S]*unset PEAKS_ROUTE_FACTORY_DB_PASS PEAKS_ROUTE_DB_PASS/
  );
  assert.match(
    wrapper,
    /unset DATABASE_URL PGPASSWORD PGSERVICE PGSERVICEFILE PGUSER PGHOST PGPORT PGDATABASE/
  );
  assert.match(wrapper, /database_user="peaks-route-factory-worker"/);
  assert.match(wrapper, /database_user="peaks-route-reviewer-worker"/);
  assert.match(wrapper, /pwd -P/);

  const contract = readFileSync(
    join(
      repositoryRoot,
      ".agents/skills/peaks-route-factory/references/worker-contract.md"
    ),
    "utf8"
  );
  assert.match(
    contract,
    /security add-generic-password -U[\s\S]*-a peaks-route-factory-worker[\s\S]*-s com\.jhm\.peaks\.route-factory-db[\s\S]*-w/
  );
  assert.match(
    contract,
    /security add-generic-password -U[\s\S]*-a peaks-route-reviewer-worker[\s\S]*-s com\.jhm\.peaks\.route-reviewer-db[\s\S]*-w/
  );

  const checkoutResolver = readFileSync(
    join(
      repositoryRoot,
      ".agents/skills/peaks-route-factory/scripts/resolve_worker_checkout.sh"
    ),
    "utf8"
  );
  assert.match(checkoutResolver, /case "\$checkout_path" in/);
});

test("worker environment scrubs executable and curl configuration injection", (t) => {
  const fixture = mkdtempSync(join(tmpdir(), "peaks-worker-environment-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const fakeBin = join(fixture, "fake-bin");
  mkdirSync(fakeBin);
  const fakeNpmMarker = join(fixture, "fake-npm-ran");
  const preloadMarker = join(fixture, "node-preload-ran");
  const preload = join(fixture, "preload.cjs");
  writeExecutable(
    join(fakeBin, "npm"),
    "#!/bin/sh\nprintf '%s\\n' fake > \"$FAKE_NPM_MARKER\"\nexit 97\n"
  );
  writeFileSync(
    preload,
    "require('node:fs').writeFileSync(process.env.NODE_PRELOAD_MARKER, 'loaded');\n"
  );

  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      [
        `source ${shellQuote(routeWorkerEnvironmentPath)}`,
        "sanitize_route_worker_environment",
        "printf 'path=%s\\nnode_options=%s\\ncurl_home=%s\\nxdg_config_home=%s\\nhttps_proxy=%s\\noverpass_url=%s\\npublic_web_url=%s\\ntmpdir=%s\\ntmp=%s\\ntemp=%s\\nnpm=%s\\n' \"$PATH\" \"${NODE_OPTIONS-}\" \"${CURL_HOME-}\" \"${XDG_CONFIG_HOME-}\" \"${HTTPS_PROXY-}\" \"${PEAKS_OVERPASS_URL-}\" \"${PEAKS_PUBLIC_WEB_URL-}\" \"${TMPDIR-}\" \"${TMP-}\" \"${TEMP-}\" \"$(command -v npm || true)\"",
        "node -e 'process.stdout.write(\"node-ok\\n\")'",
      ].join("; "),
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        NODE_OPTIONS: `--require=${preload}`,
        NODE_PATH: fixture,
        CURL_HOME: fixture,
        XDG_CONFIG_HOME: fixture,
        HTTPS_PROXY: "http://127.0.0.1:9999",
        PEAKS_OVERPASS_URL: "http://127.0.0.1/private",
        PEAKS_PUBLIC_WEB_URL: "http://169.254.169.254/metadata",
        TMPDIR: fixture,
        TMP: fixture,
        TEMP: fixture,
        FAKE_NPM_MARKER: fakeNpmMarker,
        NODE_PRELOAD_MARKER: preloadMarker,
      },
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(
    result.stdout,
    /^path=\/opt\/homebrew\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin:\/usr\/sbin:\/sbin$/m
  );
  assert.match(result.stdout, /^node_options=$/m);
  assert.match(result.stdout, /^curl_home=$/m);
  assert.match(result.stdout, /^xdg_config_home=$/m);
  assert.match(result.stdout, /^https_proxy=$/m);
  assert.match(result.stdout, /^overpass_url=$/m);
  assert.match(result.stdout, /^public_web_url=$/m);
  assert.match(result.stdout, /^tmpdir=$/m);
  assert.match(result.stdout, /^tmp=$/m);
  assert.match(result.stdout, /^temp=$/m);
  assert.doesNotMatch(result.stdout, new RegExp(fakeBin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.stdout, /^node-ok$/m);
  assert.equal(existsSync(fakeNpmMarker), false);
  assert.equal(existsSync(preloadMarker), false);
});

test("worker temporary directory selector rejects symlinks and uses its fallback", (t) => {
  const fixture = mkdtempSync(join(tmpdir(), "peaks-worker-temp-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const missing = join(fixture, "missing");
  const fallback = join(fixture, "fallback");
  const linked = join(fixture, "linked");
  mkdirSync(fallback);
  symlinkSync(fallback, linked);

  const selected = spawnSync(
    "/bin/bash",
    [
      "-c",
      `source ${shellQuote(routeWorkerEnvironmentPath)}; ` +
        'select_route_worker_system_tmp "$1" "$2"',
      "_",
      linked,
      fallback,
    ],
    { cwd: repositoryRoot, encoding: "utf8" }
  );
  assert.equal(selected.status, 0, selected.stderr || selected.stdout);
  assert.equal(selected.stdout.trim(), fallback);

  const rejected = spawnSync(
    "/bin/bash",
    [
      "-c",
      `source ${shellQuote(routeWorkerEnvironmentPath)}; ` +
        'select_route_worker_system_tmp "$1" "$2"',
      "_",
      linked,
      missing,
    ],
    { cwd: repositoryRoot, encoding: "utf8" }
  );
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /No trusted system temporary directory/);
});

test("credential-bearing curl helpers disable implicit config first", () => {
  for (const path of credentialBearingCurlHelperPaths) {
    const script = readFileSync(path, "utf8");
    assert.match(
      script,
      /\bcurl \\\n\s+--disable \\\n\s+--fail \\/,
      `${path} must ignore curl config before parsing any other option`
    );
  }
});

test("worker database profiles reject every host, port, and name override", () => {
  for (const profile of ["factory", "reviewer"]) {
    for (const variable of [
      "PEAKS_ROUTE_DB_HOST",
      "PEAKS_ROUTE_DB_PORT",
      "PEAKS_ROUTE_DB_NAME",
      "DB_HOST",
      "DB_PORT",
      "DB_NAME",
    ]) {
      const result = spawnSync(
        "/bin/bash",
        [
          "-c",
          `source ${shellQuote(routeWorkerEnvironmentPath)}; ` +
            `configure_route_database_target ${profile}`,
        ],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: cleanWorkerTargetEnvironment({ [variable]: "attacker-value" }),
        }
      );
      assert.equal(
        result.status,
        1,
        `${profile} accepted ${variable}: ${result.stderr || result.stdout}`
      );
      assert.match(
        result.stderr,
        /worker database target overrides are forbidden/
      );
    }
  }

  const accepted = spawnSync(
    "/bin/bash",
    [
      "-c",
      `source ${shellQuote(routeWorkerEnvironmentPath)}; ` +
        "configure_route_database_target factory; " +
        "printf '%s|%s|%s\\n' \"$DB_HOST\" \"$DB_PORT\" \"$DB_NAME\"",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: cleanWorkerTargetEnvironment(),
    }
  );
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  assert.equal(accepted.stdout.trim(), "127.0.0.1|5432|peaks");
});

test("route jobs bypass fake npm and invoke only the exact runner and job", (t) => {
  const fixture = mkdtempSync(join(tmpdir(), "peaks-route-jobs-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const fixtureScripts = join(
    fixture,
    ".agents/skills/peaks-route-factory/scripts"
  );
  const fixtureMigrateScripts = join(fixture, "cloud-sql/migrate/scripts");
  const fixtureMigrateSource = join(fixture, "cloud-sql/migrate/src");
  const fakeBin = join(fixture, "fake-bin");
  for (const directory of [
    fixtureScripts,
    fixtureMigrateScripts,
    fixtureMigrateSource,
    fakeBin,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  const fixtureRouteJobs = join(fixtureScripts, "route_jobs.sh");
  copyFileSync(routeJobsPath, fixtureRouteJobs);
  chmodSync(fixtureRouteJobs, 0o700);
  copyFileSync(
    routeWorkerEnvironmentPath,
    join(fixtureScripts, "route_worker_environment.sh")
  );
  writeExecutable(
    join(fixtureScripts, "route_job_claim_role.sh"),
    "route_job_validate_claim_stage() { :; }\n"
  );
  writeExecutable(
    join(fixtureScripts, "resolve_worker_checkout.sh"),
    "#!/bin/bash\nprintf '%s\\n' route-factory\n"
  );
  writeExecutable(
    join(fixtureScripts, "resolve_route_worker_id.sh"),
    "#!/bin/bash\nprintf '%s\\n' luna-route-worker-test\n"
  );
  const invocationLog = join(fixture, "invocation.log");
  writeExecutable(
    join(fixtureScripts, "with_route_db.sh"),
    "#!/bin/bash\nprintf '%s\\n' \"$@\" > \"$ROUTE_INVOCATION_LOG\"\n"
  );
  writeExecutable(
    join(fixtureMigrateScripts, "run-tsx.sh"),
    "#!/bin/bash\nexit 99\n"
  );
  writeFileSync(join(fixtureMigrateSource, "standard-route-jobs.ts"), "");
  const fakeNpmMarker = join(fixture, "fake-npm-ran");
  writeExecutable(
    join(fakeBin, "npm"),
    "#!/bin/sh\nprintf '%s\\n' fake > \"$FAKE_NPM_MARKER\"\nexit 97\n"
  );
  const preloadMarker = join(fixture, "node-preload-ran");
  const preload = join(fixture, "preload.cjs");
  writeFileSync(
    preload,
    "require('node:fs').writeFileSync(process.env.NODE_PRELOAD_MARKER, 'loaded');\n"
  );

  const result = spawnSync(
    "/bin/bash",
    [fixtureRouteJobs, "show", "--limit", "1"],
    {
      cwd: fixture,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        NODE_OPTIONS: `--require=${preload}`,
        FAKE_NPM_MARKER: fakeNpmMarker,
        NODE_PRELOAD_MARKER: preloadMarker,
        ROUTE_INVOCATION_LOG: invocationLog,
      },
    }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readFileSync(invocationLog, "utf8").trim().split("\n"), [
    join(fixture, "cloud-sql/migrate/scripts/run-tsx.sh"),
    join(fixture, "cloud-sql/migrate/src/standard-route-jobs.ts"),
    "show",
    "--limit",
    "1",
  ]);
  assert.equal(existsSync(fakeNpmMarker), false);
  assert.equal(existsSync(preloadMarker), false);

  const routeJobs = readFileSync(routeJobsPath, "utf8");
  assert.doesNotMatch(routeJobs, /\bnpm\b/);
  assert.match(
    routeJobs,
    /exec "\$script_dir\/with_route_db\.sh"[\s\\]*"\$repo_root\/cloud-sql\/migrate\/scripts\/run-tsx\.sh"[\s\\]*"\$repo_root\/cloud-sql\/migrate\/src\/standard-route-jobs\.ts"[\s\\]*"\$\{args\[@\]\}"/
  );
});

test("database wrapper scrubs the process before target configuration", () => {
  const wrapper = readFileSync(withRouteDatabasePath, "utf8");
  const sourceEnvironment = wrapper.indexOf(
    'builtin source "$initial_script_dir/route_worker_environment.sh"'
  );
  const disableXtrace = wrapper.indexOf("set +x");
  const passwordSelection = wrapper.indexOf("selected_database_password=");
  const sanitize = wrapper.indexOf("sanitize_route_worker_environment");
  const resolveCanonicalPaths = wrapper.indexOf(
    'script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"'
  );
  const configure = wrapper.indexOf(
    'configure_route_database_target "$credential_profile"'
  );
  const preflight = wrapper.indexOf(
    '"$script_dir/worker_preflight.sh" >/dev/null'
  );
  const authorize = wrapper.indexOf('require_worker_command "$@"');
  const loadPassword = wrapper.indexOf(
    'source "$script_dir/load_route_db_password.sh"'
  );
  assert.ok(
    disableXtrace >= 0 &&
      disableXtrace < passwordSelection &&
      sourceEnvironment >= 0 &&
      sourceEnvironment < sanitize &&
      sanitize < resolveCanonicalPaths &&
      resolveCanonicalPaths < configure &&
      configure < preflight &&
      preflight < authorize &&
      authorize < loadPassword
  );
});

test("database wrapper executes the resolved trusted worker command", (t) => {
  const fixture = mkdtempSync(join(tmpdir(), "peaks-worker-command-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const fixtureScripts = join(
    fixture,
    ".agents/skills/peaks-route-factory/scripts"
  );
  const trustedRunner = join(fixture, "cloud-sql/migrate/scripts/run-tsx.sh");
  const trustedJob = join(
    fixture,
    "cloud-sql/migrate/src/standard-route-jobs.ts"
  );
  const trustedOsmBuilder = join(
    fixture,
    ".claude/skills/peaks-standard-route-backfill/scripts/build_osm_route_candidate.mts"
  );
  const trustedAudit = join(
    fixture,
    ".agents/skills/peaks-route-factory/scripts/audit_route_candidates.mts"
  );
  const trustedImporter = join(
    fixture,
    ".claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts"
  );
  const trustedRenderer = join(
    fixture,
    ".claude/skills/peaks-standard-route-backfill/scripts/render_route_candidate_local_map.mts"
  );
  const trustedTerrainCache = join(
    fixture,
    ".claude/skills/peaks-standard-route-backfill/scripts/cache_route_terrain_tiles.mts"
  );
  const workerArtifactDirectory = join(
    fixture,
    "cloud-sql/migrate/route-candidates/luna/worker-artifacts"
  );
  const foreignRoot = join(fixture, "foreign");
  const foreignRunner = join(
    foreignRoot,
    "cloud-sql/migrate/scripts/run-tsx.sh"
  );
  const foreignJob = join(
    foreignRoot,
    "cloud-sql/migrate/src/standard-route-jobs.ts"
  );
  for (const directory of [
    fixtureScripts,
    join(fixture, "cloud-sql/migrate/scripts"),
    join(fixture, "cloud-sql/migrate/src"),
    join(
      fixture,
      ".claude/skills/peaks-standard-route-backfill/scripts"
    ),
    workerArtifactDirectory,
    join(foreignRoot, "cloud-sql/migrate/scripts"),
    join(foreignRoot, "cloud-sql/migrate/src"),
  ]) {
    mkdirSync(directory, { recursive: true });
  }

  const fixtureWrapper = join(fixtureScripts, "with_route_db.sh");
  const wrapper = readFileSync(withRouteDatabasePath, "utf8");
  const connectionCheck = wrapper.indexOf("if ! (echo >/dev/tcp/");
  const finalExec = wrapper.indexOf("\nexec ", connectionCheck);
  assert.ok(connectionCheck >= 0 && finalExec > connectionCheck);
  writeExecutable(
    fixtureWrapper,
    `${wrapper.slice(0, connectionCheck)}:\n${wrapper.slice(finalExec + 1)}`
  );
  writeFileSync(
    join(fixtureScripts, "route_worker_environment.sh"),
    [
      readFileSync(routeWorkerEnvironmentPath, "utf8"),
      "sanitize_route_worker_environment() { :; }",
      "configure_route_database_target() {",
      "  export DB_HOST=127.0.0.1",
      "  export DB_PORT=5432",
      "  export DB_NAME=peaks",
      "}",
      "",
    ].join("\n")
  );
  writeExecutable(
    join(fixtureScripts, "resolve_worker_checkout.sh"),
    "#!/bin/bash\nprintf '%s\\n' route-factory\n"
  );
  writeExecutable(
    join(fixtureScripts, "worker_preflight.sh"),
    "#!/bin/bash\nexit 0\n"
  );
  writeFileSync(
    join(fixtureScripts, "load_route_db_password.sh"),
    "printf '%s\\n' loaded > \"$PASSWORD_LOAD_LOG\"\nexport DB_PASS=fixture-secret\n"
  );
  const trustedLog = join(fixture, "trusted.log");
  const foreignLog = join(fixture, "foreign.log");
  const passwordLoadLog = join(fixture, "password-load.log");
  writeExecutable(
    trustedRunner,
    "#!/bin/bash\nif [[ -n \"${selected_database_password-}\" ]]; then printf leaked > \"$SECRET_LEAK_LOG\"; fi\nif [[ -n \"${ELEVATION_LOG-}\" ]]; then printf '%s|%s|%s|%s|%s\\n' \"${PEAKS_ELEVATION_SOURCE-}\" \"${PEAKS_TERRAIN_TILE_CACHE-}\" \"${TMPDIR-}\" \"${TMP-}\" \"${TEMP-}\" > \"$ELEVATION_LOG\"; fi\nprintf '%s|%s\\n' \"${DB_PASS-}\" \"$*\" > \"$TRUSTED_LOG\"\n"
  );
  writeExecutable(
    foreignRunner,
    "#!/bin/bash\nprintf '%s|%s\\n' \"$DB_PASS\" \"$*\" > \"$FOREIGN_LOG\"\n"
  );
  writeFileSync(trustedJob, "");
  writeFileSync(trustedOsmBuilder, "");
  writeFileSync(trustedAudit, "");
  writeFileSync(trustedImporter, "");
  writeFileSync(trustedRenderer, "");
  writeFileSync(trustedTerrainCache, "");
  writeFileSync(foreignJob, "");

  const result = spawnSync(
    fixtureWrapper,
    [
      "cloud-sql/migrate/scripts/run-tsx.sh",
      "cloud-sql/migrate/src/standard-route-jobs.ts",
      "show",
      "--limit",
      "1",
    ],
    {
      cwd: foreignRoot,
      encoding: "utf8",
      env: {
        ...cleanWorkerTargetEnvironment(),
        TRUSTED_LOG: trustedLog,
        FOREIGN_LOG: foreignLog,
        PASSWORD_LOAD_LOG: passwordLoadLog,
      },
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    readFileSync(trustedLog, "utf8").trim(),
    `fixture-secret|${join(
      realpathSync(fixture),
      "cloud-sql/migrate/src/standard-route-jobs.ts"
    )} show --limit 1`
  );
  assert.equal(existsSync(foreignLog), false);
  assert.equal(existsSync(passwordLoadLog), true);

  const tracedSecret = "must-not-appear-in-xtrace";
  const traced = spawnSync(
    "/bin/bash",
    [
      "-x",
      fixtureWrapper,
      "cloud-sql/migrate/scripts/run-tsx.sh",
      "cloud-sql/migrate/src/standard-route-jobs.ts",
      "show",
    ],
    {
      cwd: foreignRoot,
      encoding: "utf8",
      env: {
        ...cleanWorkerTargetEnvironment({
          PEAKS_ROUTE_FACTORY_DB_PASS: tracedSecret,
        }),
        TRUSTED_LOG: trustedLog,
        FOREIGN_LOG: foreignLog,
        PASSWORD_LOAD_LOG: passwordLoadLog,
      },
    }
  );
  assert.equal(traced.status, 0, traced.stderr || traced.stdout);
  assert.doesNotMatch(`${traced.stdout}\n${traced.stderr}`, new RegExp(tracedSecret));

  rmSync(passwordLoadLog, { force: true });
  const outsideOutput = join(fixture, "outside.geojson");
  const rejectedOutside = spawnSync(
    fixtureWrapper,
    [
      "cloud-sql/migrate/scripts/run-tsx.sh",
      ".claude/skills/peaks-standard-route-backfill/scripts/build_osm_route_candidate.mts",
      "--output",
      outsideOutput,
    ],
    {
      cwd: foreignRoot,
      encoding: "utf8",
      env: {
        ...cleanWorkerTargetEnvironment(),
        TRUSTED_LOG: trustedLog,
        FOREIGN_LOG: foreignLog,
        PASSWORD_LOAD_LOG: passwordLoadLog,
      },
    }
  );
  assert.equal(rejectedOutside.status, 2, rejectedOutside.stderr);
  assert.match(rejectedOutside.stderr, /worker-owned root/);
  assert.equal(existsSync(passwordLoadLog), false);
  assert.equal(existsSync(outsideOutput), false);

  const symlinkTarget = join(fixture, "symlink-target.geojson");
  const symlinkOutput = join(workerArtifactDirectory, "linked.geojson");
  writeFileSync(symlinkTarget, "outside");
  symlinkSync(symlinkTarget, symlinkOutput);
  const rejectedSymlink = spawnSync(
    fixtureWrapper,
    [
      "cloud-sql/migrate/scripts/run-tsx.sh",
      ".claude/skills/peaks-standard-route-backfill/scripts/build_osm_route_candidate.mts",
      "--output",
      "cloud-sql/migrate/route-candidates/luna/worker-artifacts/linked.geojson",
    ],
    {
      cwd: foreignRoot,
      encoding: "utf8",
      env: {
        ...cleanWorkerTargetEnvironment(),
        TRUSTED_LOG: trustedLog,
        FOREIGN_LOG: foreignLog,
        PASSWORD_LOAD_LOG: passwordLoadLog,
      },
    }
  );
  assert.equal(rejectedSymlink.status, 2, rejectedSymlink.stderr);
  assert.match(rejectedSymlink.stderr, /must not (?:use|contain) symlinks?/);
  assert.equal(existsSync(passwordLoadLog), false);
  assert.equal(readFileSync(symlinkTarget, "utf8"), "outside");
  rmSync(symlinkOutput);

  const auditCandidate = join(workerArtifactDirectory, "audit.geojson");
  const secretLeakLog = join(fixture, "secret-leak.log");
  writeFileSync(auditCandidate, "{}");
  const nonDatabase = spawnSync(
    fixtureWrapper,
    [
      "cloud-sql/migrate/scripts/run-tsx.sh",
      ".agents/skills/peaks-route-factory/scripts/audit_route_candidates.mts",
      "--file",
      "cloud-sql/migrate/route-candidates/luna/worker-artifacts/audit.geojson",
    ],
    {
      cwd: foreignRoot,
      encoding: "utf8",
      env: {
        ...cleanWorkerTargetEnvironment({
          DB_PASS: "inherited-secret",
          PEAKS_ROUTE_FACTORY_DB_PASS: "lane-secret",
          selected_database_password: "force-export-attribute",
        }),
        TRUSTED_LOG: trustedLog,
        FOREIGN_LOG: foreignLog,
        PASSWORD_LOAD_LOG: passwordLoadLog,
        SECRET_LEAK_LOG: secretLeakLog,
      },
    }
  );
  assert.equal(nonDatabase.status, 0, nonDatabase.stderr || nonDatabase.stdout);
  assert.equal(existsSync(passwordLoadLog), false);
  assert.equal(existsSync(secretLeakLog), false);
  assert.equal(
    readFileSync(trustedLog, "utf8").trim(),
    `|${join(
      realpathSync(fixture),
      ".agents/skills/peaks-route-factory/scripts/audit_route_candidates.mts"
    )} --file ${join(
      realpathSync(fixture),
      "cloud-sql/migrate/route-candidates/luna/worker-artifacts/audit.geojson"
    )}`
  );

  const renderResult = spawnSync(
    fixtureWrapper,
    [
      "cloud-sql/migrate/scripts/run-tsx.sh",
      ".claude/skills/peaks-standard-route-backfill/scripts/render_route_candidate_local_map.mts",
      "--geojson",
      "cloud-sql/migrate/route-candidates/luna/worker-artifacts/audit.geojson",
      "--output",
      "cloud-sql/migrate/route-candidates/luna/worker-artifacts/audit.png",
    ],
    {
      cwd: foreignRoot,
      encoding: "utf8",
      env: {
        ...cleanWorkerTargetEnvironment({ TMPDIR: foreignRoot }),
        TRUSTED_LOG: trustedLog,
        FOREIGN_LOG: foreignLog,
        PASSWORD_LOAD_LOG: passwordLoadLog,
      },
    }
  );
  assert.equal(renderResult.status, 0, renderResult.stderr || renderResult.stdout);
  assert.equal(
    readFileSync(trustedLog, "utf8").trim(),
    `|${join(
      realpathSync(fixture),
      ".claude/skills/peaks-standard-route-backfill/scripts/render_route_candidate_local_map.mts"
    )} --geojson ${join(
      realpathSync(fixture),
      "cloud-sql/migrate/route-candidates/luna/worker-artifacts/audit.geojson"
    )} --output ${join(
      realpathSync(fixture),
      "cloud-sql/migrate/route-candidates/luna/worker-artifacts/audit.png"
    )} --tile-cache ${join(
      workerCacheRoot,
      "osm-map-tiles"
    )}`
  );

  const terrainResult = spawnSync(
    fixtureWrapper,
    [
      "cloud-sql/migrate/scripts/run-tsx.sh",
      ".claude/skills/peaks-standard-route-backfill/scripts/cache_route_terrain_tiles.mts",
      "--candidate",
      "cloud-sql/migrate/route-candidates/luna/worker-artifacts/audit.geojson",
    ],
    {
      cwd: foreignRoot,
      encoding: "utf8",
      env: {
        ...cleanWorkerTargetEnvironment({ TMPDIR: foreignRoot }),
        TRUSTED_LOG: trustedLog,
        FOREIGN_LOG: foreignLog,
        PASSWORD_LOAD_LOG: passwordLoadLog,
      },
    }
  );
  assert.equal(terrainResult.status, 0, terrainResult.stderr || terrainResult.stdout);
  assert.equal(
    readFileSync(trustedLog, "utf8").trim(),
    `|${join(
      realpathSync(fixture),
      ".claude/skills/peaks-standard-route-backfill/scripts/cache_route_terrain_tiles.mts"
    )} --candidate ${join(
      realpathSync(fixture),
      "cloud-sql/migrate/route-candidates/luna/worker-artifacts/audit.geojson"
    )} --output-dir ${join(
      workerCacheRoot,
      "terrain"
    )}`
  );
  const cacheStats = statSync(workerCacheRoot);
  if (typeof process.getuid === "function") {
    assert.equal(cacheStats.uid, process.getuid());
  }
  assert.equal(cacheStats.mode & 0o777, 0o700);

  rmSync(passwordLoadLog, { force: true });
  const elevationLog = join(fixture, "elevation.log");
  const importResult = spawnSync(
    fixtureWrapper,
    [
      "cloud-sql/migrate/scripts/run-tsx.sh",
      ".claude/skills/peaks-standard-route-backfill/scripts/import_standard_route_from_osm_candidate.mts",
      "--candidate",
      "cloud-sql/migrate/route-candidates/luna/worker-artifacts/audit.geojson",
      "--result-file",
      "cloud-sql/migrate/route-candidates/luna/worker-artifacts/import.json",
    ],
    {
      cwd: foreignRoot,
      encoding: "utf8",
      env: {
        ...cleanWorkerTargetEnvironment({
          PEAKS_ELEVATION_SOURCE: "usgs-3dep",
          PEAKS_TERRAIN_TILE_CACHE: foreignRoot,
          PEAKS_ELEVATION_CACHE_DIR: foreignRoot,
          TMPDIR: foreignRoot,
        }),
        TRUSTED_LOG: trustedLog,
        FOREIGN_LOG: foreignLog,
        PASSWORD_LOAD_LOG: passwordLoadLog,
        ELEVATION_LOG: elevationLog,
      },
    }
  );
  assert.equal(importResult.status, 0, importResult.stderr || importResult.stdout);
  assert.equal(existsSync(passwordLoadLog), true);
  assert.equal(
    readFileSync(elevationLog, "utf8").trim(),
    `terrain-cache|${workerSystemTemporaryRoot}/peaks-route-worker/terrain|${workerSystemTemporaryRoot}|${workerSystemTemporaryRoot}|${workerSystemTemporaryRoot}`
  );
});

test("credential-bearing shell entrypoints start in privileged mode", () => {
  for (const path of [
    withRouteDatabasePath,
    ...directWorkerShellPaths,
    join(repositoryRoot, "cloud-sql/migrate/scripts/run-tsx.sh"),
    join(
      repositoryRoot,
      ".claude/skills/peaks-standard-route-backfill/scripts/accept_pending_route_with_segments.sh"
    ),
    join(
      repositoryRoot,
      ".claude/skills/peaks-standard-route-backfill/scripts/find_osm_trail_geometry.sh"
    ),
    join(
      repositoryRoot,
      ".claude/skills/peaks-standard-route-backfill/scripts/find_public_trail_geometry.sh"
    ),
  ]) {
    assert.equal(
      readFileSync(path, "utf8").split("\n", 1)[0],
      "#!/bin/bash -p",
      `${path} must ignore BASH_ENV and exported shell functions at startup`
    );
  }
});

test("direct worker shells scrub their environment before external commands", () => {
  for (const path of [withRouteDatabasePath, ...directWorkerShellPaths]) {
    const script = readFileSync(path, "utf8");
    const sourceEnvironment = script.indexOf(
      'builtin source "$initial_script_dir/route_worker_environment.sh"'
    );
    const sanitize = script.indexOf("sanitize_route_worker_environment");
    const firstExternalCommand = script.indexOf(
      'script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")"'
    );
    assert.ok(
      sourceEnvironment >= 0 &&
        sourceEnvironment < sanitize &&
        sanitize < firstExternalCommand,
      `${path} must source and run the trusted sanitizer before external commands`
    );
  }
});

test("database wrapper ignores BASH_ENV before its sanitizer runs", (t) => {
  const fixture = mkdtempSync(join(tmpdir(), "peaks-worker-bash-env-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const sentinel = join(fixture, "bash-env-ran");
  const bashEnvironment = join(fixture, "bash-environment.sh");
  writeFileSync(
    bashEnvironment,
    `#!/bin/bash\nprintf '%s\\n' sourced > ${shellQuote(sentinel)}\n`
  );

  const result = spawnSync(withRouteDatabasePath, [], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      BASH_ENV: bashEnvironment,
    },
  });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr, /with_route_db\.sh requires a command/);
  assert.equal(existsSync(sentinel), false);
});
