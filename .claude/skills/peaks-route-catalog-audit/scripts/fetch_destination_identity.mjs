#!/usr/bin/env node

import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

function option(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : null;
}

function compactNames(values) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))];
}

function normalizeName(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function normalizeEnglishPeakName(value) {
  return normalizeName(value)
    .replace(/^(mount|mt) /, "")
    .replace(/ (mountain|peak|summit)$/, "")
    .trim();
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": "PeaksApp-route-catalog-audit/1.0 (https://github.com/jhmacdon/peaks-firebase)",
    },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

export async function collectDestinationIdentity(catalogAudit, fetchImpl = fetch) {
  const identities = (catalogAudit.records ?? []).filter((record) =>
    record.type === "identity"
  );
  if (identities.length !== 1) {
    throw new Error(`Expected one identity record, found ${identities.length}`);
  }
  const identity = identities[0];
  const metrics = identity.metrics ?? {};
  const osmId = metrics.osm_id;
  const wikidataId = metrics.wikidata_id;
  const storedName = metrics.stored_name;
  const sourceErrors = [];
  if (!identity.destination_id || !storedName) {
    throw new Error("Identity record is missing destination id or stored name");
  }

  let osm = null;
  if (osmId) {
    try {
      if (!/^\d+$/.test(String(osmId))) {
        throw new Error(`invalid OSM node id: ${osmId}`);
      }
      const url = `https://api.openstreetmap.org/api/0.6/node/${osmId}.json`;
      const payload = await fetchJson(url, fetchImpl);
      const element = payload.elements?.find((candidate) =>
        candidate.type === "node" && String(candidate.id) === String(osmId)
      );
      if (!element) throw new Error(`OSM node ${osmId} was not returned`);
      const tags = element.tags ?? {};
      const names = Object.fromEntries(
        Object.entries(tags)
          .filter(([key, value]) => (key === "name" || key.startsWith("name:")) &&
            typeof value === "string" && value.trim())
          .sort(([left], [right]) => left.localeCompare(right))
      );
      osm = { id: String(osmId), url, names };
    } catch (error) {
      sourceErrors.push({
        source: "osm",
        id: String(osmId),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let wikidata = null;
  if (wikidataId) {
    try {
      if (!/^Q\d+$/.test(String(wikidataId))) {
        throw new Error(`invalid Wikidata id: ${wikidataId}`);
      }
      const url = `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`;
      const payload = await fetchJson(url, fetchImpl);
      const entity = payload.entities?.[wikidataId];
      if (!entity || entity.missing != null) {
        throw new Error(`Wikidata entity ${wikidataId} was not returned`);
      }
      wikidata = {
        id: String(wikidataId),
        url,
        labels: Object.fromEntries(
          Object.entries(entity.labels ?? {})
            .map(([language, value]) => [language, value?.value])
            .filter(([, value]) => typeof value === "string" && value.trim())
            .sort(([left], [right]) => left.localeCompare(right))
        ),
        aliases: Object.fromEntries(
          Object.entries(entity.aliases ?? {})
            .map(([language, values]) => [
              language,
              compactNames((values ?? []).map((value) => value?.value)),
            ])
            .filter(([, values]) => values.length > 0)
            .sort(([left], [right]) => left.localeCompare(right))
        ),
      };
    } catch (error) {
      sourceErrors.push({
        source: "wikidata",
        id: String(wikidataId),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const englishCandidates = compactNames([
    osm?.names?.["name:en"],
    wikidata?.labels?.en,
  ]);
  const knownNames = compactNames([
    ...Object.values(osm?.names ?? {}),
    ...Object.values(wikidata?.labels ?? {}),
    ...Object.values(wikidata?.aliases ?? {}).flat(),
  ]);
  const normalizedStoredName = normalizeName(storedName);
  const findings = [];
  if (!osm && !wikidata) findings.push("missing_linked_name_sources");
  if (sourceErrors.length > 0) findings.push("identity_source_errors");
  if (englishCandidates.length > 0 &&
      !englishCandidates.some((name) => normalizeName(name) === normalizedStoredName)) {
    findings.push("stored_display_name_differs_from_english_sources");
  }
  if (!knownNames.some((name) => normalizeName(name) === normalizedStoredName)) {
    findings.push("stored_name_not_found_in_linked_sources");
  }
  if (new Set(englishCandidates.map(normalizeEnglishPeakName)).size > 1) {
    findings.push("english_name_sources_disagree");
  }

  return {
    checked_at: new Date().toISOString(),
    destination_id: identity.destination_id,
    stored_name: storedName,
    country_code: metrics.country_code ?? null,
    osm,
    wikidata,
    english_candidates: englishCandidates,
    known_names: knownNames,
    source_errors: sourceErrors,
    findings,
  };
}

async function main(argv = process.argv.slice(2)) {
  const catalogPath = option(argv, "catalog");
  const outputPath = option(argv, "output");
  if (!catalogPath) {
    throw new Error("Usage: fetch_destination_identity.mjs --catalog FILE [--output FILE]");
  }
  const catalogAudit = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const result = await collectDestinationIdentity(catalogAudit);
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
