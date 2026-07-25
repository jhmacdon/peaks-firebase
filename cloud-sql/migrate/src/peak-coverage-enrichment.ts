import {
  parseElevationMeters,
  PeakMatch,
  rankCoverageCandidate,
  SessionProximityEvidence,
} from "./peak-coverage";
import { OverpassElement } from "./audit-peak-coverage";

export const DEFAULT_MINIMUM_PROMINENCE_M = 300 * 0.3048;
export const DEFAULT_POPULAR_WIKIPEDIA_SITELINKS = 5;

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const METRE_UNIT = "Q11573";
const FOOT_UNIT = "Q3710";

interface WikidataQuantity {
  amount?: string;
  unit?: string;
}

interface WikidataClaim {
  rank?: "preferred" | "normal" | "deprecated";
  mainsnak?: {
    snaktype?: string;
    datavalue?: { value?: WikidataQuantity };
  };
}

interface WikidataEntity {
  missing?: string;
  claims?: Record<string, WikidataClaim[]>;
  sitelinks?: Record<string, unknown>;
}

interface WikidataResponse {
  entities?: Record<string, WikidataEntity>;
}

export interface WikidataPeakFacts {
  wikidataId: string;
  prominenceM: number | null;
  elevationM: number | null;
  wikipediaSitelinks: number;
}

export interface PeakSelection {
  match: PeakMatch;
  decision: "add" | "defer";
  elevationM: number | null;
  prominenceM: number | null;
  prominenceSource: "osm" | "wikidata" | null;
  wikipediaSitelinks: number;
  popularitySignals: string[];
  reasons: string[];
  reviewFlags: string[];
}

export function parseWikidataQuantityMeters(value: WikidataQuantity | null | undefined): number | null {
  if (!value?.amount || !value.unit) return null;
  const amount = Number.parseFloat(value.amount);
  if (!Number.isFinite(amount)) return null;
  const unit = value.unit.split("/").pop();
  if (unit === METRE_UNIT) return amount;
  if (unit === FOOT_UNIT) return amount * 0.3048;
  return null;
}

function preferredQuantity(claims: WikidataClaim[] | undefined): number | null {
  const usable = (claims ?? []).filter((claim) =>
    claim.rank !== "deprecated" &&
    claim.mainsnak?.snaktype !== "novalue" &&
    claim.mainsnak?.snaktype !== "somevalue"
  );
  const preferred = usable.filter((claim) => claim.rank === "preferred");
  for (const claim of preferred.length ? preferred : usable) {
    const parsed = parseWikidataQuantityMeters(claim.mainsnak?.datavalue?.value);
    if (parsed != null) return parsed;
  }
  return null;
}

export function parseWikidataEntity(
  wikidataId: string,
  entity: WikidataEntity | null | undefined
): WikidataPeakFacts {
  const wikipediaSitelinks = Object.keys(entity?.sitelinks ?? {}).filter((key) =>
    key.endsWith("wiki") && key !== "commonswiki" && key !== "specieswiki"
  ).length;
  return {
    wikidataId,
    prominenceM: preferredQuantity(entity?.claims?.P2660),
    elevationM: preferredQuantity(entity?.claims?.P2044),
    wikipediaSitelinks,
  };
}

export async function fetchWikidataPeakFacts(
  wikidataIds: string[],
  fetchImpl: typeof fetch = fetch
): Promise<Map<string, WikidataPeakFacts>> {
  const uniqueIds = [...new Set(wikidataIds.filter((id) => /^Q\d+$/.test(id)))];
  const facts = new Map<string, WikidataPeakFacts>();
  for (let offset = 0; offset < uniqueIds.length; offset += 50) {
    const ids = uniqueIds.slice(offset, offset + 50);
    const url = new URL(WIKIDATA_API);
    url.searchParams.set("action", "wbgetentities");
    url.searchParams.set("ids", ids.join("|"));
    url.searchParams.set("props", "claims|sitelinks");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      try {
        const response = await fetchImpl(url, {
          headers: {
            "User-Agent": "PeaksApp-coverage-import/1.0 (https://github.com/jhmacdon/peaks-firebase)",
          },
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = new Error(`Wikidata HTTP ${response.status}`);
          if (response.status !== 429 && response.status < 500) throw error;
          lastError = error;
        } else {
          const body = await response.json() as WikidataResponse;
          for (const id of ids) facts.set(id, parseWikidataEntity(id, body.entities?.[id]));
          lastError = null;
          break;
        }
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
    }
    if (lastError) throw lastError;
  }
  return facts;
}

export function parseOsmProminenceMeters(element: OverpassElement | undefined): number | null {
  const tags = element?.tags ?? {};
  if (tags["prominence:ft"]) return parseElevationMeters(`${tags["prominence:ft"]} ft`);
  if (tags["prominence:meters"]) return parseElevationMeters(tags["prominence:meters"]);
  return parseElevationMeters(tags.prominence);
}

export function selectPeakCandidate(
  match: PeakMatch,
  evidence: SessionProximityEvidence,
  element: OverpassElement | undefined,
  wikidata: WikidataPeakFacts | undefined,
  minimumProminenceM = DEFAULT_MINIMUM_PROMINENCE_M,
  popularWikipediaSitelinks = DEFAULT_POPULAR_WIKIPEDIA_SITELINKS
): PeakSelection {
  if (match.method != null) throw new Error("Only unmatched peaks can be selected for insertion");
  const ranked = rankCoverageCandidate(match, evidence);
  const osmProminenceM = parseOsmProminenceMeters(element);
  const wikidataProminenceM = wikidata?.prominenceM ?? null;
  const prominenceConflict = osmProminenceM != null && wikidataProminenceM != null &&
    Math.abs(osmProminenceM - wikidataProminenceM) > Math.max(30, Math.min(osmProminenceM, wikidataProminenceM) * 0.25);
  const prominenceM = wikidataProminenceM ?? osmProminenceM;
  const prominenceSource = wikidataProminenceM != null
    ? "wikidata" as const
    : osmProminenceM != null ? "osm" as const : null;
  const elevationM = match.reference.elevationM ?? wikidata?.elevationM ?? null;
  const wikipediaSitelinks = wikidata?.wikipediaSitelinks ?? 0;
  const popularitySignals: string[] = [];
  if (evidence.sessionsWithin30m > 0) popularitySignals.push("peaks_session_within_30m");
  if (match.reference.wikipedia) popularitySignals.push("osm_wikipedia");
  if (wikipediaSitelinks >= popularWikipediaSitelinks) {
    popularitySignals.push(`wikidata_wikipedia_sitelinks:${wikipediaSitelinks}`);
  }

  const reasons: string[] = [];
  if (ranked.reviewFlags.includes("generic_name")) reasons.push("generic_name");
  if (ranked.reviewFlags.includes("possible_subpeak")) reasons.push("possible_subpeak");
  if (ranked.reviewFlags.includes("near_existing_destination")) reasons.push("near_existing_destination");
  if (prominenceConflict) reasons.push("prominence_source_conflict");
  if (elevationM == null) reasons.push("missing_elevation");

  const prominent = prominenceM != null && prominenceM > minimumProminenceM;
  if (!prominent && popularitySignals.length === 0) reasons.push("no_prominence_or_popularity_signal");
  return {
    match,
    decision: reasons.length === 0 ? "add" : "defer",
    elevationM,
    prominenceM,
    prominenceSource,
    wikipediaSitelinks,
    popularitySignals,
    reasons,
    reviewFlags: ranked.reviewFlags,
  };
}
