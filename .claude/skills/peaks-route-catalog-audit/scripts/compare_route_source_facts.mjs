#!/usr/bin/env node

import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SHAPES = new Set(["out_and_back", "loop", "point_to_point", "lollipop"]);
const DISTANCE_BASES = new Set(["one_way", "round_trip"]);

function option(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : null;
}

function normalizeName(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) ||
      value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
}

function flattenStoredNames(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flattenStoredNames);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(flattenStoredNames);
  }
  return [];
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function expectedOneWayMeters(standardRoute) {
  if (standardRoute.distance_basis === "one_way") {
    return standardRoute.distance_m;
  }
  if (standardRoute.shape === "out_and_back") {
    return standardRoute.distance_m / 2;
  }
  if (standardRoute.shape === "loop" || standardRoute.shape === "lollipop") {
    return standardRoute.distance_m;
  }
  throw new Error("point_to_point source distance cannot be round_trip");
}

export function validateSourceFacts(facts) {
  assertString(facts.destination_id, "destination_id");
  assertString(facts.preferred_display_name, "preferred_display_name");
  assertStringArray(facts.local_names, "local_names");
  assertStringArray(facts.aliases, "aliases");
  const route = facts.standard_route;
  if (!route || typeof route !== "object") throw new Error("standard_route is required");
  assertString(route.name, "standard_route.name");
  if (route.aliases != null) assertStringArray(route.aliases, "standard_route.aliases");
  assertString(route.trailhead_name, "standard_route.trailhead_name");
  assertString(route.activity, "standard_route.activity");
  assertString(route.access, "standard_route.access");
  if (!Number.isFinite(route.distance_m) || route.distance_m <= 0) {
    throw new Error("standard_route.distance_m must be positive");
  }
  if (!SHAPES.has(route.shape)) throw new Error("standard_route.shape is invalid");
  if (!DISTANCE_BASES.has(route.distance_basis)) {
    throw new Error("standard_route.distance_basis is invalid");
  }
  if (!Number.isFinite(route.gain_m) || route.gain_m < 0) {
    throw new Error("standard_route.gain_m must be nonnegative");
  }
  expectedOneWayMeters(route);

  if (!Array.isArray(facts.sources) || facts.sources.length < 2) {
    throw new Error("At least two independent sources are required");
  }
  const supported = new Set();
  const publishers = new Set();
  for (const [index, source] of facts.sources.entries()) {
    assertString(source.publisher, `sources[${index}].publisher`);
    assertString(source.url, `sources[${index}].url`);
    if (!/^https?:\/\/\S+$/.test(source.url)) {
      throw new Error(`sources[${index}].url must be HTTP(S)`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source.retrieved_at ?? "")) {
      throw new Error(`sources[${index}].retrieved_at must be YYYY-MM-DD`);
    }
    if (!Array.isArray(source.supports) || source.supports.length === 0) {
      throw new Error(`sources[${index}].supports must not be empty`);
    }
    publishers.add(normalizeName(source.publisher));
    for (const field of source.supports) supported.add(field);
  }
  if (publishers.size < 2) throw new Error("Sources must use two independent publishers");
  for (const field of [
    "route_identity", "trailhead", "distance", "shape", "gain", "activity", "access",
  ]) {
    if (!supported.has(field)) throw new Error(`Sources do not support ${field}`);
  }
}

function issue(type, severity, details = {}) {
  return { type, severity, ...details };
}

export function compareRouteSourceFacts(catalogAudit, identityAudit, facts) {
  const evidenceGaps = Array.isArray(facts.evidence_gaps)
    ? facts.evidence_gaps.filter((gap) => typeof gap === "string" && gap.trim())
    : [];
  if (evidenceGaps.length === 0) {
    validateSourceFacts(facts);
  } else {
    assertString(facts.destination_id, "destination_id");
    assertString(facts.preferred_display_name, "preferred_display_name");
    assertStringArray(facts.local_names, "local_names");
    assertStringArray(facts.aliases, "aliases");
    if (!Array.isArray(facts.sources)) {
      throw new Error("sources must be an array for incomplete evidence");
    }
  }
  if (facts.destination_id !== identityAudit.destination_id) {
    throw new Error("Source facts destination does not match identity evidence");
  }
  const identityRecord = (catalogAudit.records ?? []).find((record) =>
    record.type === "identity" && record.destination_id === facts.destination_id
  );
  if (!identityRecord) throw new Error("Catalog audit has no matching identity record");

  const routes = (catalogAudit.records ?? []).filter((record) => record.type === "route");
  const selection = (catalogAudit.records ?? []).find((record) => record.type === "selection");
  const findings = [];

  const internalErrors = (catalogAudit.records ?? []).filter((record) =>
    record.severity === "ERROR" &&
    (record.type !== "route" || record.metrics?.status === "active")
  );
  if (internalErrors.length > 0) {
    findings.push(issue("catalog_internal_errors", "ERROR", {
      records: internalErrors.map((record) => ({
        type: record.type,
        item_id: record.item_id,
        issues: record.issues,
      })),
    }));
  }
  const unresolvedCatalogReviews = (catalogAudit.records ?? []).filter((record) =>
    (record.severity === "WARN" || record.severity === "REVIEW") &&
    (record.type !== "route" || record.metrics?.status === "active")
  );
  if (unresolvedCatalogReviews.length > 0) {
    findings.push(issue("unresolved_catalog_reviews", "REVIEW", {
      records: unresolvedCatalogReviews.map((record) => ({
        type: record.type,
        item_id: record.item_id,
        other_id: record.other_id,
        issues: record.issues,
      })),
    }));
  }

  if ((identityAudit.findings ?? []).includes("identity_source_errors")) {
    findings.push(issue("identity_source_errors", "REVIEW", {
      sources: identityAudit.source_errors ?? [],
    }));
  }

  if (normalizeName(identityAudit.stored_name) !==
      normalizeName(facts.preferred_display_name)) {
    findings.push(issue("display_name_mismatch", "ERROR", {
      stored_name: identityAudit.stored_name,
      preferred_display_name: facts.preferred_display_name,
    }));
  }

  if ((identityAudit.findings ?? []).includes("english_name_sources_disagree")) {
    findings.push(issue("english_name_sources_disagree", "REVIEW", {
      candidates: identityAudit.english_candidates,
    }));
  }

  if (evidenceGaps.length > 0) {
    findings.push(issue("incomplete_source_evidence", "REVIEW", {
      gaps: evidenceGaps,
    }));
    const incompleteRoutes = routes.map((record) => ({
      route_id: record.item_id,
      route_name: record.item_name,
      status: record.metrics?.status ?? null,
      findings: record.issues ?? [],
      action: record.metrics?.status !== "active" ||
        record.issues?.includes("legacy_route_coverage_import")
        ? "supersede"
        : record.severity === "ERROR" ? "repair" : "needs human review",
    }));
    const hasError = findings.some((finding) => finding.severity === "ERROR");
    return {
      audited_at: new Date().toISOString(),
      destination_id: facts.destination_id,
      stored_name: identityAudit.stored_name,
      preferred_display_name: facts.preferred_display_name,
      local_names: facts.local_names,
      aliases: facts.aliases,
      standard_route: facts.standard_route ?? null,
      verdict: hasError ? "FAIL" : "REVIEW",
      state: hasError ? "needs_repair" : "needs_human",
      findings,
      routes: incompleteRoutes,
      sources: facts.sources,
    };
  }

  const expectedMeters = expectedOneWayMeters(facts.standard_route);

  const requiredCatalogNames = [
    facts.preferred_display_name,
    ...facts.local_names,
    ...facts.aliases,
  ];
  const catalogNameText = [
    identityAudit.stored_name,
    identityRecord.metrics?.search_name,
    ...flattenStoredNames(identityRecord.metrics?.names),
  ].map((name) => normalizeName(name ?? "")).filter(Boolean).join(" ");
  const missingCatalogNames = requiredCatalogNames.filter((name) =>
    !catalogNameText.includes(normalizeName(name))
  );
  if (missingCatalogNames.length > 0) {
    findings.push(issue("catalog_names_not_searchable", "ERROR", {
      names: missingCatalogNames,
    }));
  }
  const linkedIdentityNames = new Set(
    (identityAudit.known_names ?? []).map(normalizeName)
  );
  const unlinkedSourceNames = requiredCatalogNames.filter((name) =>
    !linkedIdentityNames.has(normalizeName(name))
  );
  if (linkedIdentityNames.size > 0 && unlinkedSourceNames.length > 0) {
    findings.push(issue("source_names_missing_from_linked_identity", "REVIEW", {
      names: unlinkedSourceNames,
    }));
  }

  const routeComparisons = routes.map((record) => {
    const distance = numberOrNull(record.metrics?.one_way_m);
    const ratio = distance == null ? null : distance / expectedMeters;
    const routeFindings = [];
    if (record.severity === "WARN" || record.severity === "REVIEW") {
      routeFindings.push(...(record.issues ?? []));
    }
    const standardRouteNames = [
      facts.standard_route.name,
      ...(facts.standard_route.aliases ?? []),
    ].map(normalizeName);
    const storedRouteName = normalizeName(record.item_name ?? "");
    if (!storedRouteName) {
      routeFindings.push("missing_route_name");
    } else if (
        !standardRouteNames.includes(storedRouteName)) {
      routeFindings.push("route_name_differs_from_standard");
    }
    const storedTrailhead = record.metrics?.trailhead;
    if (!storedTrailhead) {
      routeFindings.push("missing_route_trailhead");
    } else if (
        normalizeName(storedTrailhead) !==
          normalizeName(facts.standard_route.trailhead_name)) {
      routeFindings.push("trailhead_name_differs_from_standard");
    }
    const storedShape = record.metrics?.shape;
    if (!storedShape) {
      routeFindings.push("missing_route_shape");
    } else if (storedShape !== facts.standard_route.shape) {
      routeFindings.push("shape_differs_from_standard");
    }
    const storedGain = numberOrNull(record.metrics?.gain_m);
    const gainRatio = storedGain != null && facts.standard_route.gain_m > 0
      ? storedGain / facts.standard_route.gain_m
      : null;
    if (storedGain == null) {
      routeFindings.push("missing_route_gain");
    }
    if (gainRatio != null) {
      if (gainRatio > 3 || gainRatio < 0.3) {
        routeFindings.push("gain_far_from_standard");
      } else if (gainRatio > 1.7 || gainRatio < 0.6) {
        routeFindings.push("gain_differs_from_standard");
      }
    }
    if (ratio == null) routeFindings.push("missing_route_distance");
    else {
      if (ratio > 4) routeFindings.push("far_longer_than_standard");
      else if (ratio > 1.7) routeFindings.push("longer_than_standard");
      if (ratio < 0.4) routeFindings.push("far_shorter_than_standard");
      else if (ratio < 0.6) routeFindings.push("shorter_than_standard");
    }
    const status = record.metrics?.status ?? null;
    const mustSupersede = status !== "active" ||
      record.issues?.includes("legacy_route_coverage_import") ||
      routeFindings.includes("far_longer_than_standard") ||
      routeFindings.includes("far_shorter_than_standard");
    const needsSourceReview =
      record.severity === "WARN" ||
      record.severity === "REVIEW" ||
      routeFindings.some((finding) => [
      "longer_than_standard",
      "shorter_than_standard",
      "route_name_differs_from_standard",
      "trailhead_name_differs_from_standard",
      "gain_differs_from_standard",
      ].includes(finding));
    const mustRepairFromSource = routeFindings.some((finding) => [
      "missing_route_name",
      "missing_route_trailhead",
      "missing_route_shape",
      "missing_route_gain",
      "shape_differs_from_standard",
      "gain_far_from_standard",
    ].includes(finding));
    return {
      route_id: record.item_id,
      route_name: record.item_name,
      status,
      one_way_m: distance,
      gain_m: storedGain,
      gain_ratio: gainRatio == null ? null : Math.round(gainRatio * 100) / 100,
      expected_one_way_m: Math.round(expectedMeters),
      distance_ratio: ratio == null ? null : Math.round(ratio * 100) / 100,
      findings: routeFindings,
      action: mustSupersede
        ? "supersede"
        : record.severity === "ERROR" || mustRepairFromSource
          ? "repair"
          : needsSourceReview ? "needs human review" : "keep",
    };
  });

  const activeRoutes = routeComparisons.filter((route) => route.status === "active");
  const activeRoutesToSupersede = activeRoutes.filter((route) =>
    route.action === "supersede"
  );
  if (activeRoutesToSupersede.length > 0) {
    findings.push(issue("active_routes_require_supersede", "ERROR", {
      routes: activeRoutesToSupersede.map((route) => ({
        route_id: route.route_id,
        findings: route.findings,
      })),
    }));
  }
  const activeRoutesToRepairFromSource = activeRoutes.filter((route) =>
    route.action === "repair" &&
    route.findings.some((finding) => [
      "missing_route_name",
      "missing_route_trailhead",
      "missing_route_shape",
      "missing_route_gain",
      "shape_differs_from_standard",
      "gain_far_from_standard",
    ].includes(finding))
  );
  if (activeRoutesToRepairFromSource.length > 0) {
    findings.push(issue("active_route_source_errors", "ERROR", {
      routes: activeRoutesToRepairFromSource.map((route) => ({
        route_id: route.route_id,
        findings: route.findings,
      })),
    }));
  }
  const activeRoutesForReview = activeRoutes.filter((route) =>
    route.action === "needs human review"
  );
  if (activeRoutesForReview.length > 0) {
    findings.push(issue("active_route_source_conflicts", "REVIEW", {
      routes: activeRoutesForReview.map((route) => ({
        route_id: route.route_id,
        findings: route.findings,
      })),
    }));
  }
  const plausibleRoutes = activeRoutes.filter((route) =>
    route.distance_ratio != null &&
    route.distance_ratio >= 0.6 &&
    route.distance_ratio <= 1.7
  );
  if (plausibleRoutes.length === 0) {
    findings.push(issue("no_plausible_standard_route", "ERROR", {
      expected_one_way_m: Math.round(expectedMeters),
    }));
  }

  const selected = routeComparisons.find((route) => route.route_id === selection?.item_id);
  if (selected && (
    selected.distance_ratio == null ||
    selected.distance_ratio < 0.5 ||
    selected.distance_ratio > 2
  )) {
    findings.push(issue("default_route_distance_implausible", "ERROR", {
      route_id: selected.route_id,
      distance_ratio: selected.distance_ratio,
    }));
  }

  const hasError = findings.some((finding) => finding.severity === "ERROR");
  const hasReview = findings.some((finding) => finding.severity === "REVIEW");
  return {
    audited_at: new Date().toISOString(),
    destination_id: facts.destination_id,
    stored_name: identityAudit.stored_name,
    preferred_display_name: facts.preferred_display_name,
    local_names: facts.local_names,
    aliases: facts.aliases,
    standard_route: {
      ...facts.standard_route,
      expected_one_way_m: Math.round(expectedMeters),
    },
    verdict: hasError ? "FAIL" : hasReview ? "REVIEW" : "PASS",
    state: hasError ? "needs_repair" : hasReview ? "needs_human" : "passed",
    findings,
    routes: routeComparisons,
    sources: facts.sources,
  };
}

async function main(argv = process.argv.slice(2)) {
  const catalogPath = option(argv, "catalog");
  const identityPath = option(argv, "identity");
  const factsPath = option(argv, "facts");
  const outputPath = option(argv, "output");
  if (!catalogPath || !identityPath || !factsPath) {
    throw new Error(
      "Usage: compare_route_source_facts.mjs --catalog FILE --identity FILE " +
      "--facts FILE [--output FILE]"
    );
  }
  const [catalogAudit, identityAudit, facts] = await Promise.all(
    [catalogPath, identityPath, factsPath].map(async (file) =>
      JSON.parse(await fs.readFile(file, "utf8"))
    )
  );
  const result = compareRouteSourceFacts(catalogAudit, identityAudit, facts);
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) await fs.writeFile(outputPath, text);
  else process.stdout.write(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
