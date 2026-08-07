import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
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
import {
  addReviewWebEvidence,
  buildRouteReviewPacket,
  fetchPublicPage,
  isPublicAddress,
} from "../../../../.agents/skills/peaks-route-factory/scripts/build_route_review_packet.mjs";

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

const routeCatalogWorker = fileURLToPath(
  new URL("./audit_catalog_routes_worker.sh", import.meta.url)
);

const routeAuditJobsWrapper = fileURLToPath(
  new URL("./route_audit_jobs.sh", import.meta.url)
);

const routeIdentityWorker = fileURLToPath(
  new URL("./fetch_destination_identity_worker.sh", import.meta.url)
);

const routeIdentityScript = fileURLToPath(
  new URL("./fetch_destination_identity.mjs", import.meta.url)
);

const routeAuditOutputWriter = fileURLToPath(
  new URL("./write_audit_output_atomically.mjs", import.meta.url)
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

const routeImporterWrapper = fileURLToPath(
  new URL(
    "../../../../.agents/skills/peaks-route-factory/scripts/import_route_candidate.sh",
    import.meta.url
  )
);

const routeSourceCheckWrapper = fileURLToPath(
  new URL(
    "../../../../.agents/skills/peaks-route-factory/scripts/check_pending_route_source.sh",
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

const routeJobsWrapper = fileURLToPath(
  new URL(
    "../../../../.agents/skills/peaks-route-factory/scripts/route_jobs.sh",
    import.meta.url
  )
);

const routeWorkerIdResolver = fileURLToPath(
  new URL(
    "../../../../.agents/skills/peaks-route-factory/scripts/resolve_route_worker_id.sh",
    import.meta.url
  )
);

const routeRepairLunaPrompt = fileURLToPath(
  new URL(
    "../../../../.agents/skills/peaks-route-factory/references/luna-repair-goal-prompt.md",
    import.meta.url
  )
);

const routeFactoryStageCommands = fileURLToPath(
  new URL(
    "../../../../.agents/skills/peaks-route-factory/references/stage-commands.md",
    import.meta.url
  )
);

const routeReviewerConfig = fileURLToPath(
  new URL(
    "../../../../.codex/agents/peaks-route-reviewer.toml",
    import.meta.url
  )
);

const osmDiscoveryHelper = fileURLToPath(
  new URL(
    "../../peaks-standard-route-backfill/scripts/find_osm_trail_geometry.sh",
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
      "/Users/josiahm/projects/peaks/.workers/firebase-route-repair",
      "route-repair",
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
    "/Users/josiahm/projects/peaks/.workers/firebase-route-repair-02",
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

test("route importer wrapper owns terrain settings and the fixed importer", () => {
  const wrapper = readFileSync(routeImporterWrapper, "utf8");
  const stageCommands = readFileSync(routeFactoryStageCommands, "utf8");

  assert.match(wrapper, /export PEAKS_ELEVATION_SOURCE="terrain-cache"/);
  assert.match(
    wrapper,
    /export PEAKS_TERRAIN_TILE_CACHE="\/private\/tmp\/peaks-route-worker\/terrain"/
  );
  assert.match(wrapper, /exec "\$script_dir\/with_route_db\.sh"/);
  assert.match(wrapper, /import_standard_route_from_osm_candidate\.mts/);
  assert.match(wrapper, /"\$@"/);
  assert.doesNotMatch(
    stageCommands,
    /PEAKS_ELEVATION_SOURCE=terrain-cache[\s\S]{0,160}import_route_candidate/
  );
  assert.match(
    stageCommands,
    /Call `import_route_candidate\.sh` directly[\s\S]*Do not prefix it/i
  );
});

test("route source-check wrapper owns checker choice and result path", () => {
  const wrapper = readFileSync(routeSourceCheckWrapper, "utf8");
  const stageCommands = readFileSync(routeFactoryStageCommands, "utf8");
  const syntax = spawnSync("bash", ["-n", routeSourceCheckWrapper], {
    encoding: "utf8",
  });

  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(wrapper, /check_pending_osm_routes\.mts/);
  assert.match(wrapper, /check_pending_usgs_routes\.mts/);
  assert.match(
    wrapper,
    /output_file="\$output_dir\/\$destination_id-\$lease_token-source-check\.json"/
  );
  assert.match(wrapper, /worker-artifacts/);
  assert.match(wrapper, /checker_status.*-ne 0.*-ne 2/s);
  assert.match(wrapper, /mv "\$temporary_file" "\$output_file"/);
  assert.doesNotMatch(
    stageCommands,
    /check_pending_(?:osm|usgs)_routes\.mts[\s\S]{0,160}>/
  );
  assert.match(
    stageCommands,
    /Call `check_pending_route_source\.sh` directly[\s\S]*do not[\s\S]*redirection/i
  );
});

test("route reviewer gets a small packet and a bounded useful window", async () => {
  const reviewer = readFileSync(routeReviewerConfig, "utf8");
  const stageCommands = readFileSync(routeFactoryStageCommands, "utf8");
  const discardedUrl = "https://discarded.example/route";
  const conflictUrl = "https://www.alltrails.com/trail/example";
  const candidate = {
    route_name: "Mount Example via Standard Route",
    route_shape: "out_and_back",
    identity_sources: [
      { type: "official", url: "https://www.nps.gov/example" },
      { type: "route_guide", url: "https://www.wta.org/go-hiking/example" },
      { type: "summitpost", url: "https://www.summitpost.org/example" },
      { type: "peakbagger", url: "https://www.peakbagger.com/peak.aspx?pid=1" },
      { type: "alltrails", url: conflictUrl },
      { type: "guide", url: discardedUrl },
      { type: "guide", url: "https://another.example/route" },
    ],
    identity_conflicts: [
      { url: conflictUrl, note: "This publisher names a different route." },
    ],
    geometry: {
      source_kind: "openstreetmap",
      source_url: "https://www.openstreetmap.org/way/1",
      license: "ODbL 1.0",
    },
    access: {
      status: "open",
      source_url: "https://www.nps.gov/example/access",
    },
    comparison: {
      private_reference_used: false,
      ignored_url: discardedUrl,
    },
    map_review: { passed: true, notes: "Correct summit and trailhead." },
  };
  const packetArgs = {
    sourceCheck: {
      verdict: "PASS",
      results: [
        {
          metrics: {
            start_connector_m: 1,
            end_connector_m: 2,
            core_max_offset_m: 3,
            core_p95_offset_m: 2.5,
            core_coverage_pct: 100,
            ignored_metric: 9,
          },
        },
      ],
    },
    destinationId: "destination",
    destinationName: "Mount Example",
    trailheadId: "trailhead",
    trailheadName: "Example Trailhead",
    routeId: "route",
  };
  const packet = buildRouteReviewPacket({
    candidate,
    ...packetArgs,
  });

  assert.match(reviewer, /model_reasoning_effort = "medium"/);
  assert.match(reviewer, /Read exactly one file/);
  assert.match(reviewer, /Do not\s+load a skill, documentation/);
  assert.doesNotMatch(reviewer, /Use \$peaks-route-factory|Read references\//);
  assert.match(reviewer, /filtered review-packet/);
  assert.match(reviewer, /Do not open URLs, browse, search/);
  assert.match(reviewer, /only the packet's compact fields and web_evidence/);
  assert.match(reviewer, /Finish within two minutes/);
  assert.match(reviewer, /Copy the packet's review_result_template/);
  assert.match(reviewer, /HTTP 200 proves only that the page was fetched/);
  assert.match(reviewer, /core p95 <= 2 m/);
  assert.match(reviewer, /standard route name, named trailhead, route shape/);
  assert.match(reviewer, /scrambling, glacier, avalanche, climbing/);
  assert.match(
    reviewer,
    /unknown, disputed, closed,\s+seasonal, permit, guide, or private-land/
  );
  assert.match(reviewer, /source-check\s+access or permit warning/);
  assert.match(reviewer, /Return only the JSON object/);
  assert.match(stageCommands, /Never attach or\s+quote the full candidate result/);
  assert.match(stageCommands, /with one prompt field/);
  assert.match(stageCommands, /Do not also supply an input, items, files/);
  assert.equal(packet.candidate.identity_sources.length, 2);
  assert.equal(packet.review_result_template.verdict, null);
  assert.equal(packet.review_result_template.reviewer, "peaks_route_reviewer");
  assert.equal(packet.review_result_template.route_id, "route");
  assert.equal(packet.review_result_template.source_check, "osm");
  assert.deepEqual(
    Object.keys(packet.review_result_template.gates),
    [
      "route_identity",
      "geometry_rights",
      "access",
      "map_review",
      "source_geometry",
      "pending_route",
      "endpoints",
      "provenance",
    ]
  );
  assert.ok(
    Object.values(packet.review_result_template.gates).every(
      (value) => value === null
    )
  );
  assert.deepEqual(packet.review_result_template.measurements, {
    start_connector_m: 1,
    end_connector_m: 2,
    core_max_offset_m: 3,
    core_p95_offset_m: 2.5,
    core_coverage_pct: 100,
  });
  assert.match(
    packet.review_contract.evidence_rule,
    /proves only that a page was fetched/
  );
  const usgsPacket = buildRouteReviewPacket({
    candidate: {
      ...candidate,
      geometry: {
        source_kind: "usgs-national-map",
        source_url: "https://apps.nationalmap.gov/",
        license: "Public domain",
      },
    },
    ...packetArgs,
  });
  assert.equal(usgsPacket.review_result_template.source_check, "usgs");
  assert.ok(
    packet.candidate.identity_sources.some((source) => source.url === conflictUrl)
  );
  assert.equal(packet.candidate.identity_conflicts.length, 1);
  assert.equal(packet.candidate.access.source_url, "https://www.nps.gov/example/access");
  assert.doesNotMatch(JSON.stringify(packet), new RegExp(discardedUrl));
  const rankedPacket = buildRouteReviewPacket({
    candidate: {
      ...candidate,
      identity_sources: [
        { type: "unofficial_blog", url: "https://blog.example/route" },
        { type: "official", url: "https://www.nps.gov/example" },
        { type: "route_guide", url: "https://www.wta.org/go-hiking/example" },
      ],
      identity_conflicts: [],
    },
    ...packetArgs,
  });
  assert.deepEqual(
    rankedPacket.candidate.identity_sources.map((source) => source.type),
    ["official", "route_guide"]
  );
  const samePublisherUrls = [
    "https://conflicts.example/route-one",
    "https://conflicts.example/route-two",
    "https://conflicts.example/route-three",
  ];
  const samePublisherPacket = buildRouteReviewPacket({
    candidate: {
      ...candidate,
      identity_sources: [
        ...samePublisherUrls.map((url) => ({ type: "guide", url })),
        { type: "official", url: "https://www.nps.gov/example" },
      ],
      identity_conflicts: samePublisherUrls.map((url, index) => ({
        url,
        note: `Conflict ${index + 1}.`,
      })),
    },
    ...packetArgs,
  });
  assert.equal(samePublisherPacket.candidate.identity_conflicts.length, 1);
  assert.equal(
    samePublisherPacket.candidate.identity_conflicts[0].url,
    samePublisherUrls[0]
  );
  assert.match(
    samePublisherPacket.candidate.identity_conflicts[0].note,
    /Conflict 1\. Conflict 2\. Conflict 3\./
  );
  assert.doesNotMatch(
    JSON.stringify(samePublisherPacket),
    /route-two|route-three/
  );
  const requestedUrls = [];
  const evidencePacket = await addReviewWebEvidence(
    packet,
    {
      resolveHost: async () => [
        { address: "93.184.216.34", family: 4 },
      ],
      requestHop: async (url, address) => {
        requestedUrls.push(url);
        assert.equal(address, "93.184.216.34");
        if (url.endsWith("/access")) {
          return {
            status: 403,
            content_type: "text/html",
            location: null,
            body: "",
          };
        }
        return {
          status: 200,
          content_type: "text/html; charset=utf-8",
          location: null,
          body:
            "<html><head><title>Mount Example Route</title>" +
            '<meta name="description" content="Standard route from the trailhead.">' +
            "</head><body><script>discard me</script>Public route facts.</body></html>",
        };
      },
    }
  );
  assert.equal(requestedUrls.length, 3);
  assert.equal(evidencePacket.web_evidence.length, 3);
  assert.equal(
    evidencePacket.web_evidence.filter((evidence) => evidence.ok).length,
    2
  );
  assert.ok(
    evidencePacket.web_evidence.some(
      (evidence) =>
        evidence.roles.includes("access") &&
        evidence.ok === false &&
        evidence.http_status === 403
    )
  );
  assert.match(JSON.stringify(evidencePacket), /Mount Example Route/);
  assert.doesNotMatch(JSON.stringify(evidencePacket), /discard me|<html>/);
  let redirectRequests = 0;
  await assert.rejects(
    fetchPublicPage("https://public.example/start", {
      resolveHost: async (hostname) => [
        {
          address:
            hostname === "www.public.example"
              ? "10.0.0.8"
              : "93.184.216.34",
          family: 4,
        },
      ],
      requestHop: async () => {
        redirectRequests += 1;
        return {
          status: 302,
          content_type: "text/html",
          location: "https://www.public.example/secret",
          body: "",
        };
      },
    }),
    /resolved to a private address/
  );
  assert.equal(redirectRequests, 1);
  await assert.rejects(
    fetchPublicPage("https://private-dns.example/route", {
      resolveHost: async () => [{ address: "fd00::1", family: 6 }],
      requestHop: async () => assert.fail("private DNS must not be requested"),
    }),
    /resolved to a private address/
  );
  assert.equal(isPublicAddress("fd00::1"), false);
  assert.equal(isPublicAddress("fe80::1"), false);
  assert.equal(isPublicAddress("::ffff:10.0.0.1"), false);
  assert.equal(isPublicAddress("::ffff:a00:1"), false);
  assert.equal(isPublicAddress("fec0::1"), false);
  assert.equal(isPublicAddress("192.0.2.1"), false);
  assert.equal(isPublicAddress("198.51.100.1"), false);
  assert.equal(isPublicAddress("203.0.113.1"), false);
  assert.equal(isPublicAddress("3fff::1"), false);
  assert.equal(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946"), true);
  let abortedRequest = false;
  await assert.rejects(
    fetchPublicPage("https://slow.example/route", {
      resolveHost: async () => [
        { address: "93.184.216.34", family: 4 },
      ],
      requestHop: async (_url, _address, _family, _timeoutMs, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              abortedRequest = true;
              reject(signal.reason);
            },
            { once: true }
          );
        }),
      timeoutMs: 20,
    }),
    /timed out/
  );
  assert.equal(abortedRequest, true);
  let crossPublisherRequests = 0;
  await assert.rejects(
    fetchPublicPage("https://public.example/start", {
      resolveHost: async () => [
        { address: "93.184.216.34", family: 4 },
      ],
      requestHop: async () => {
        crossPublisherRequests += 1;
        return {
          status: 302,
          content_type: "text/html",
          location: "https://another.example/route",
          body: "",
        };
      },
    }),
    /another publisher/
  );
  assert.equal(crossPublisherRequests, 1);
  let redirectHops = 0;
  await assert.rejects(
    fetchPublicPage("https://redirects.example/start", {
      resolveHost: async () => [
        { address: "93.184.216.34", family: 4 },
      ],
      requestHop: async () => {
        redirectHops += 1;
        return {
          status: 302,
          content_type: "text/html",
          location: "/next",
          body: "",
        };
      },
      redirectLimit: 3,
    }),
    /redirect limit/
  );
  assert.equal(redirectHops, 4);
  assert.throws(
    () =>
      buildRouteReviewPacket({
        candidate: {
          ...candidate,
          identity_sources: [
            { type: "official", url: "https://127.0.0.1/private" },
          ],
          identity_conflicts: [],
        },
        ...packetArgs,
      }),
    /must use a public host/
  );
  assert.throws(
    () =>
      buildRouteReviewPacket({
        candidate: {
          ...candidate,
          identity_conflicts: candidate.identity_sources.slice(0, 3).map(
            (source) => ({ url: source.url, note: "Known conflict." })
          ),
        },
        ...packetArgs,
      }),
    /needs human review/
  );
  assert.match(
    stageCommands,
    /Wait no more than two minutes[\s\S]*one\s+more minute/
  );
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

test("audit queue wrapper owns every recurring lease selector", () => {
  const root = mkdtempSync(join(tmpdir(), "peaks-audit-lease-wrapper-"));
  const skillScripts = join(
    root,
    ".claude/skills/peaks-route-catalog-audit/scripts"
  );
  const factoryScripts = join(
    root,
    ".agents/skills/peaks-route-factory/scripts"
  );
  const bin = join(root, "bin");
  try {
    mkdirSync(skillScripts, { recursive: true });
    mkdirSync(factoryScripts, { recursive: true });
    mkdirSync(bin);
    const wrapper = join(skillScripts, "route_audit_jobs.sh");
    copyFileSync(routeAuditJobsWrapper, wrapper);
    writeFileSync(
      join(factoryScripts, "resolve_worker_checkout.sh"),
      "#!/usr/bin/env bash\nprintf '%s\\n' luna-route-audit-03\n"
    );
    writeFileSync(
      join(factoryScripts, "with_route_db.sh"),
      "#!/usr/bin/env bash\nexec \"$@\"\n"
    );
    writeFileSync(
      join(bin, "npm"),
      "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\n"
    );
    for (const executable of [
      wrapper,
      join(factoryScripts, "resolve_worker_checkout.sh"),
      join(factoryScripts, "with_route_db.sh"),
      join(bin, "npm"),
    ]) chmodSync(executable, 0o755);
    const environment = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
    };

    for (const args of [
      ["claim", "--apply"],
      ["heartbeat", "--lease-minutes", "30"],
      ["complete", "--destination-id", "peak-1", "--apply"],
      ["release", "--message", "test"],
    ]) {
      const output = execFileSync(wrapper, args, {
        encoding: "utf8",
        env: environment,
      });
      assert.match(
        output,
        /--worker-id\nluna-route-audit-03/,
        `${args[0]} must use the checkout-derived worker ID`
      );
    }

    const matching = execFileSync(
      wrapper,
      ["heartbeat", "--worker-id", "luna-route-audit-03"],
      { encoding: "utf8", env: environment }
    );
    assert.equal(
      matching.match(/--worker-id/g)?.length,
      1,
      "a matching explicit worker ID must not be duplicated"
    );
    for (const args of [
      ["heartbeat", "--worker-id", "luna-route-audit-01"],
      [
        "release",
        "--worker-id", "luna-route-audit-03",
        "--worker-id", "luna-route-audit-03",
      ],
    ]) {
      assert.throws(
        () => execFileSync(wrapper, args, {
          encoding: "utf8",
          env: environment,
          stdio: "pipe",
        }),
        /Command failed/
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repair lane owns its claim identity and cannot claim ordinary work", () => {
  const root = mkdtempSync(join(tmpdir(), "peaks-route-repair-wrapper-"));
  const factoryScripts = join(
    root,
    ".agents/skills/peaks-route-factory/scripts"
  );
  const bin = join(root, "bin");
  try {
    mkdirSync(factoryScripts, { recursive: true });
    mkdirSync(bin);
    const wrapper = join(factoryScripts, "route_jobs.sh");
    copyFileSync(routeJobsWrapper, wrapper);
    copyFileSync(
      routeWorkerIdResolver,
      join(factoryScripts, "resolve_route_worker_id.sh")
    );
    writeFileSync(
      join(factoryScripts, "resolve_worker_checkout.sh"),
      "#!/usr/bin/env bash\nprintf '%s\\n' route-factory\n"
    );
    writeFileSync(
      join(factoryScripts, "with_route_db.sh"),
      "#!/usr/bin/env bash\nexec \"$@\"\n"
    );
    writeFileSync(
      join(bin, "npm"),
      "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\n"
    );
    for (const executable of [
      wrapper,
      join(factoryScripts, "resolve_route_worker_id.sh"),
      join(factoryScripts, "resolve_worker_checkout.sh"),
      join(factoryScripts, "with_route_db.sh"),
      join(bin, "npm"),
    ]) chmodSync(executable, 0o755);
    const environment = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
    };
    for (const [kind, workerId] of [
      ["route-factory", "luna-route-worker-01"],
      ["route-factory-02", "luna-route-worker-02"],
      ["route-factory-03", "luna-route-worker-03"],
      ["route-factory-04", "luna-route-worker-04"],
    ]) {
      writeFileSync(
        join(factoryScripts, "resolve_worker_checkout.sh"),
        `#!/usr/bin/env bash\nprintf '%s\\n' ${kind}\n`
      );
      const generalOutput = execFileSync(
        wrapper,
        ["claim", "--stage", "next", "--apply"],
        { encoding: "utf8", env: environment }
      );
      assert.match(
        generalOutput,
        new RegExp(`--worker-id\\n${workerId}`)
      );
      assert.doesNotMatch(generalOutput, /--integrity-repairs-only/);
    }
    assert.throws(
      () => execFileSync(
        wrapper,
        [
          "transition",
          "--destination-id", "peak-1",
          "--lease-token", "lease-1",
          "--to", "candidate_ready",
          "--artifact-path", "/private/tmp/peaks-route-worker/peak-1.geojson",
          "--result-file", "/private/tmp/peaks-route-worker/peak-1.json",
          "--apply",
        ],
        { encoding: "utf8", env: environment, stdio: "pipe" }
      ),
      /Command failed/
    );
    const isolatedOutput = execFileSync(
      wrapper,
      [
        "transition",
        "--destination-id", "peak-1",
        "--lease-token", "lease-1",
        "--to", "candidate_ready",
        "--artifact-path",
        "cloud-sql/migrate/route-candidates/luna/worker-artifacts/peak-1-lease-1.geojson",
        "--result-file",
        "cloud-sql/migrate/route-candidates/luna/worker-artifacts/peak-1-lease-1.json",
        "--apply",
      ],
      { encoding: "utf8", env: environment }
    );
    assert.match(isolatedOutput, /worker-artifacts/);
    assert.throws(
      () => execFileSync(
        wrapper,
        [
          "materialize",
          "--destination-id", "peak-1",
          "--lease-token", "lease-1",
          "--output",
          "cloud-sql/migrate/route-candidates/luna/worker-artifacts/../escape.geojson",
        ],
        { encoding: "utf8", env: environment, stdio: "pipe" }
      ),
      /Command failed/
    );
    const artifactDirectory = join(
      root,
      "cloud-sql/migrate/route-candidates/luna/worker-artifacts"
    );
    mkdirSync(artifactDirectory, { recursive: true });
    symlinkSync(
      join(root, "outside.json"),
      join(artifactDirectory, "linked.json")
    );
    assert.throws(
      () => execFileSync(
        wrapper,
        [
          "materialize-result",
          "--destination-id", "peak-1",
          "--lease-token", "lease-1",
          "--kind", "candidate",
          "--output",
          "cloud-sql/migrate/route-candidates/luna/worker-artifacts/linked.json",
        ],
        { encoding: "utf8", env: environment, stdio: "pipe" }
      ),
      /Command failed/
    );
    writeFileSync(
      join(factoryScripts, "resolve_worker_checkout.sh"),
      "#!/usr/bin/env bash\nprintf '%s\\n' route-repair\n"
    );
    const output = execFileSync(
      wrapper,
      ["claim", "--stage", "next", "--apply"],
      { encoding: "utf8", env: environment }
    );
    assert.match(output, /--worker-id\nluna-route-repair-01/);
    assert.match(output, /--integrity-repairs-only/);
    assert.equal(
      output.match(/--integrity-repairs-only/g)?.length,
      1,
      "the repair wrapper must add its lane filter exactly once"
    );
    assert.throws(
      () => execFileSync(
        wrapper,
        [
          "claim",
          "--worker-id", "luna-route-worker-01",
          "--integrity-repairs-only",
          "--apply",
        ],
        { encoding: "utf8", env: environment, stdio: "pipe" }
      ),
      /Command failed/
    );

    writeFileSync(
      join(factoryScripts, "resolve_worker_checkout.sh"),
      "#!/usr/bin/env bash\nprintf '%s\\n' canonical\n"
    );
    const canonicalOutput = execFileSync(
      wrapper,
      ["claim", "--worker-id", "supervisor-route-claim", "--apply"],
      { encoding: "utf8", env: environment }
    );
    assert.match(canonicalOutput, /--worker-id\nsupervisor-route-claim/);
    assert.doesNotMatch(canonicalOutput, /--integrity-repairs-only/);
    assert.throws(
      () => execFileSync(
        wrapper,
        ["claim", "--apply"],
        { encoding: "utf8", env: environment, stdio: "pipe" }
      ),
      /Command failed/
    );
    assert.throws(
      () => execFileSync(
        wrapper,
        [
          "claim",
          "--worker-id", "supervisor-route-claim",
          "--integrity-repairs-only",
          "--apply",
        ],
        { encoding: "utf8", env: environment, stdio: "pipe" }
      ),
      /Command failed/
    );

    const prompt = readFileSync(routeRepairLunaPrompt, "utf8");
    assert.match(prompt, /at exact\s+`origin\/main`/i);
    assert.match(prompt, /--integrity-repairs-only/);
    assert.match(prompt, /Do not set\s+`sandbox_permissions`/i);
    assert.match(prompt, /one job|one lease/i);
    assert.match(prompt, /more than 5 m/i);
    assert.match(prompt, /must also end within 5 m/i);
    assert.match(prompt, /exact preflighted discovery\s+commands/i);
    assert.match(prompt, /terminal transition[\s\S]*ends the turn/i);

    const stageCommands = readFileSync(routeFactoryStageCommands, "utf8");
    for (const helper of [
      "find_osm_trail_geometry.sh",
      "find_public_trail_geometry.sh",
    ]) {
      assert.match(
        stageCommands,
        new RegExp(
          String.raw`with_route_db\.sh[\s\S]{1,160}${helper.replace(".", String.raw`\.`)}`
        )
      );
    }
    assert.match(stageCommands, /do not add `bash`[\s\S]*raw public-source request/i);
    assert.match(stageCommands, /tries two approved public Overpass/i);
    assert.match(
      stageCommands,
      /Every claim authorizes only its returned stage[\s\S]*new\s+lease/i
    );
    assert.match(
      stageCommands,
      /candidate_ready[\s\S]*ends the research turn[\s\S]*Do not materialize/i
    );

    const osmDiscovery = readFileSync(osmDiscoveryHelper, "utf8");
    assert.match(osmDiscovery, /https:\/\/overpass-api\.de\/api\/interpreter/);
    assert.match(
      osmDiscovery,
      /https:\/\/overpass\.private\.coffee\/api\/interpreter/
    );
    assert.match(osmDiscovery, /for candidate_url in "\$\{overpass_urls\[@\]\}"/);
    assert.match(osmDiscovery, /All approved Overpass endpoints failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("OSM discovery falls back after a malformed primary response", () => {
  const root = mkdtempSync(join(tmpdir(), "peaks-overpass-fallback-"));
  const bin = join(root, "bin");
  const curlCount = join(root, "curl-count");
  try {
    mkdirSync(bin);
    const psql = join(bin, "psql");
    const curl = join(bin, "curl");
    writeFileSync(
      psql,
      "#!/usr/bin/env bash\nprintf 'Mount Bierstadt\\t39.582596\\t-105.668814\\n'\n"
    );
    writeFileSync(
      curl,
      [
        "#!/usr/bin/env bash",
        "count=0",
        "if [[ -f \"$FAKE_CURL_COUNT_FILE\" ]]; then",
        "  count=\"$(tr -d '[:space:]' <\"$FAKE_CURL_COUNT_FILE\")\"",
        "fi",
        "count=$((count + 1))",
        "printf '%s\\n' \"$count\" >\"$FAKE_CURL_COUNT_FILE\"",
        "if [[ \"$count\" == \"1\" ]]; then",
        "  printf '%s\\n' '<html>temporary gateway error</html>'",
        "else",
        "  printf '%s\\n' '{\"elements\":[]}'",
        "fi",
        "",
      ].join("\n")
    );
    chmodSync(psql, 0o755);
    chmodSync(curl, 0o755);

    const result = spawnSync(
      osmDiscoveryHelper,
      [
        "--destination-id", "BM4y2gvTbqY6R9bGJjUl",
        "--radius-m", "5000",
        "--format", "table",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DB_PASS: "test-password",
          FAKE_CURL_COUNT_FILE: curlCount,
          PATH: `${bin}:${process.env.PATH}`,
        },
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(curlCount, "utf8").trim(), "2");
    assert.match(
      result.stderr,
      /Source: https:\/\/overpass\.private\.coffee\/api\/interpreter/
    );
    assert.doesNotMatch(result.stderr, /parse error|temporary gateway error/i);
    assert.match(result.stdout, /^way_id\tname\thighway/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test("recurring catalog checks use the approved preflighted database wrapper", () => {
  const root = mkdtempSync(join(tmpdir(), "peaks-audit-wrapper-"));
  const token = randomUUID();
  const outputFile = join(
    "/tmp",
    `peaks-route-audit-${token}.catalog.json`
  );
  const workerOutputFile = join(
    "/tmp",
    `peaks-route-audit-worker03-${token}.catalog.json`
  );
  const nestedOutputRoot = mkdtempSync(
    "/tmp/peaks-route-audit-parent."
  );
  const symlinkParent = join(
    "/tmp",
    `peaks-route-audit-${token}-parent`
  );
  const symlinkTarget = mkdtempSync(join(tmpdir(), "peaks-audit-output-target-"));
  const skillScripts = join(
    root,
    ".claude/skills/peaks-route-catalog-audit/scripts"
  );
  const factoryScripts = join(
    root,
    ".agents/skills/peaks-route-factory/scripts"
  );
  const preflightLog = join(root, "preflight-log");
  try {
    mkdirSync(skillScripts, { recursive: true });
    mkdirSync(factoryScripts, { recursive: true });
    const wrapper = join(skillScripts, "audit_catalog_routes_worker.sh");
    const checker = join(skillScripts, "audit_catalog_routes.sh");
    copyFileSync(routeCatalogWorker, wrapper);
    copyFileSync(
      routeAuditOutputWriter,
      join(skillScripts, "write_audit_output_atomically.mjs")
    );
    writeFileSync(
      checker,
      "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\n"
    );
    writeFileSync(
      join(factoryScripts, "resolve_worker_checkout.sh"),
      "#!/usr/bin/env bash\nprintf '%s\\n' luna-route-audit-01\n"
    );
    writeFileSync(
      join(factoryScripts, "with_route_db.sh"),
      "#!/usr/bin/env bash\nprintf '%s\\n' preflight >>\"$PREFLIGHT_LOG\"\nexec \"$@\"\n"
    );
    for (const executable of [
      wrapper,
      checker,
      join(factoryScripts, "resolve_worker_checkout.sh"),
      join(factoryScripts, "with_route_db.sh"),
    ]) chmodSync(executable, 0o755);
    const output = execFileSync(
      wrapper,
      ["--destination-id", "destination-1", "--print-sql"],
      {
        encoding: "utf8",
        env: { ...process.env, PREFLIGHT_LOG: preflightLog },
      }
    );
    assert.match(output, /--destination-id\ndestination-1\n--print-sql/);
    assert.equal(readFileSync(preflightLog, "utf8"), "preflight\n");

    const redirectedOutput = execFileSync(
      wrapper,
      [
        "--destination-id", "destination-2",
        "--format", "json",
        "--output", outputFile,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PREFLIGHT_LOG: preflightLog },
      }
    );
    assert.equal(redirectedOutput.trim(), "");
    assert.match(
      readFileSync(outputFile, "utf8"),
      /--destination-id\ndestination-2\n--format\njson/
    );
    assert.equal(readFileSync(preflightLog, "utf8"), "preflight\npreflight\n");
    assert.equal(statSync(outputFile).mode & 0o777, 0o600);

    execFileSync(
      wrapper,
      [
        "--destination-id", "destination-worker-prefix",
        "--format", "json",
        "--output", workerOutputFile,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PREFLIGHT_LOG: preflightLog },
      }
    );
    assert.match(
      readFileSync(workerOutputFile, "utf8"),
      /destination-worker-prefix/
    );

    rmSync(outputFile);
    symlinkSync(symlinkTarget, outputFile, "dir");
    execFileSync(
      wrapper,
      [
        "--destination-id", "destination-symlink",
        "--format", "json",
        "--output", outputFile,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PREFLIGHT_LOG: preflightLog },
      }
    );
    assert.equal(lstatSync(outputFile).isSymbolicLink(), false);
    assert.match(readFileSync(outputFile, "utf8"), /destination-symlink/);
    assert.deepEqual(readdirSync(symlinkTarget), []);

    rmSync(outputFile);
    mkdirSync(outputFile);
    assert.throws(
      () => execFileSync(
        wrapper,
        [
          "--destination-id", "destination-directory",
          "--output", outputFile,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, PREFLIGHT_LOG: preflightLog },
          stdio: "pipe",
        }
      ),
      /Command failed/
    );
    assert.equal(statSync(outputFile).isDirectory(), true);
    assert.deepEqual(readdirSync(outputFile), []);

    symlinkSync(symlinkTarget, symlinkParent, "dir");
    assert.throws(
      () => execFileSync(
        wrapper,
        [
          "--destination-id", "destination-parent-symlink",
          "--output", join(symlinkParent, "catalog.json"),
        ],
        {
          encoding: "utf8",
          env: { ...process.env, PREFLIGHT_LOG: preflightLog },
          stdio: "pipe",
        }
      ),
      /Command failed/
    );
    assert.deepEqual(readdirSync(symlinkTarget), []);

    assert.throws(
      () => execFileSync(
        wrapper,
        [
          "--destination-id", "destination-nested",
          "--output", join(nestedOutputRoot, "catalog.json"),
        ],
        {
          encoding: "utf8",
          env: { ...process.env, PREFLIGHT_LOG: preflightLog },
          stdio: "pipe",
        }
      ),
      /Command failed/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outputFile, { recursive: true, force: true });
    rmSync(workerOutputFile, { recursive: true, force: true });
    rmSync(nestedOutputRoot, { recursive: true, force: true });
    rmSync(symlinkParent, { force: true });
    rmSync(symlinkTarget, { recursive: true, force: true });
  }
});

test("recurring identity checks use the approved preflighted network wrapper", () => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "peaks-identity-wrapper-"))
  );
  const token = randomUUID();
  const catalogFile = join(
    "/tmp",
    `peaks-route-audit-${token}.catalog.json`
  );
  const identityFile = join(
    "/tmp",
    `peaks-route-audit-${token}.identity.json`
  );
  const linkedCatalogFile = join(
    "/tmp",
    `peaks-route-audit-${token}-linked.catalog.json`
  );
  const linkedIdentityFile = join(
    "/tmp",
    `peaks-route-audit-${token}-linked.identity.json`
  );
  const skillScripts = join(
    root,
    ".claude/skills/peaks-route-catalog-audit/scripts"
  );
  const factoryScripts = join(
    root,
    ".agents/skills/peaks-route-factory/scripts"
  );
  const preflightLog = join(root, "preflight-log");
  try {
    mkdirSync(skillScripts, { recursive: true });
    mkdirSync(factoryScripts, { recursive: true });
    const wrapper = join(
      skillScripts,
      "fetch_destination_identity_worker.sh"
    );
    copyFileSync(routeIdentityWorker, wrapper);
    copyFileSync(
      routeIdentityScript,
      join(skillScripts, "fetch_destination_identity.mjs")
    );
    copyFileSync(
      routeAuditOutputWriter,
      join(skillScripts, "write_audit_output_atomically.mjs")
    );
    writeFileSync(
      join(factoryScripts, "resolve_worker_checkout.sh"),
      "#!/usr/bin/env bash\nprintf '%s\\n' luna-route-audit-02\n"
    );
    writeFileSync(
      join(factoryScripts, "worker_preflight.sh"),
      "#!/usr/bin/env bash\nprintf '%s\\n' preflight >>\"$PREFLIGHT_LOG\"\n"
    );
    writeFileSync(catalogFile, JSON.stringify({
      records: [{
        type: "identity",
        destination_id: "destination-identity",
        metrics: {
          stored_name: "Test Peak",
          country_code: "US",
        },
      }],
    }));
    for (const executable of [
      wrapper,
      join(factoryScripts, "resolve_worker_checkout.sh"),
      join(factoryScripts, "worker_preflight.sh"),
    ]) chmodSync(executable, 0o755);
    execFileSync(
      wrapper,
      ["--catalog", catalogFile, "--output", identityFile],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PREFLIGHT_LOG: preflightLog,
        },
      }
    );
    const identity = JSON.parse(readFileSync(identityFile, "utf8"));
    assert.equal(identity.destination_id, "destination-identity");
    assert.equal(identity.stored_name, "Test Peak");
    assert.equal(readFileSync(preflightLog, "utf8"), "preflight\n");

    const linkedTarget = join(root, "linked-catalog.json");
    writeFileSync(linkedTarget, readFileSync(catalogFile));
    symlinkSync(linkedTarget, linkedCatalogFile);
    assert.throws(
      () => execFileSync(
        wrapper,
        ["--catalog", linkedCatalogFile, "--output", linkedIdentityFile],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PREFLIGHT_LOG: preflightLog,
          },
          stdio: "pipe",
        }
      ),
      /Command failed/
    );
    assert.equal(existsSync(linkedIdentityFile), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(catalogFile, { force: true });
    rmSync(identityFile, { force: true });
    rmSync(linkedCatalogFile, { force: true });
    rmSync(linkedIdentityFile, { force: true });
  }
});

test("audit completion reads only no-follow direct temp result files", () => {
  const source = readFileSync(routeAuditJobs, "utf8");
  assert.match(source, /O_NOFOLLOW/);
  assert.match(source, /direct system temp file/);
  assert.match(source, /peaks-route-audit-.*\\\.result\\\.json/);
  assert.match(source, /readAuditResultFile\(resultFile\)/);
});

test("Luna proves setup from a fresh wrapper call and uses bounded leases", () => {
  const skill = readFileSync(routeAuditSkill, "utf8");
  const prompt = readFileSync(routeAuditLunaPrompt, "utf8");
  for (const instructions of [skill, prompt]) {
    assert.match(instructions, /fresh run/i);
    assert.match(instructions, /never reuse|never reuse or infer/i);
    assert.match(instructions, /(?:current|this) turn/i);
    assert.match(instructions, /directly on (?:its|the) first attempt/i);
    assert.match(instructions, /Do\s+not set `?sandbox_permissions`?/i);
    assert.doesNotMatch(instructions, /require_escalated/);
    assert.match(instructions, /every `?route_audit_jobs\.sh`? call/i);
    assert.match(instructions, /audit_catalog_routes_worker\.sh/);
    assert.match(instructions, /fetch_destination_identity_worker\.sh/);
    assert.match(instructions, /catalog\.json/);
    assert.match(instructions, /--output/);
    assert.match(instructions, /Never use\s+shell\s+redirection/i);
    assert.match(instructions, /Never create an evidence\s+directory/i);
    assert.match(
      instructions,
      /(?:peaks-route-audit-DESTINATION_ID|AUDIT_PREFIX)\.result\.json/i
    );
    assert.match(instructions, /Never prepend.*(?:bash|`bash`)/is);
    assert.match(instructions, /claim --lease-minutes 30\s+--apply/);
  }
  assert.match(prompt, /Heartbeat .*--lease-minutes 30/i);
  assert.match(prompt, /Never copy, retain, reconstruct, or pass.*lease_token/is);
  assert.match(prompt, /Complete and release without a lease token/i);
  assert.doesNotMatch(
    skill,
    /complete[\s\S]{0,160}--lease-token/i
  );
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
  assert.match(source, /const MAX_LEASE_MINUTES = 30/);
  assert.match(source, /--lease-minutes must not exceed/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /outcome: "existing_live_lease"/);
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
