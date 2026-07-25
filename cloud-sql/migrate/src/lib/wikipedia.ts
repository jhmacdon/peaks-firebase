/**
 * Pure helpers for the Wikipedia place-copy backfill.
 *
 * Everything here is network-free so it can be unit-tested without a fixture
 * server; the fetching lives in backfill-destination-descriptions.ts.
 *
 * Licensing rule that governs this whole file: we only ever store text or an
 * image we can name a source, a URL, and a licence for. Anything else returns
 * null and the caller leaves the row alone.
 */

/** Wikipedia article prose is CC BY-SA 4.0 (plus GFDL); we credit the current one. */
export const WIKIPEDIA_TEXT_LICENSE = "CC BY-SA 4.0";

export const WIKIPEDIA_SOURCE_NAME = "Wikipedia";

/** Default cap for the short place copy — two to three sentences on a phone. */
export const DEFAULT_SUMMARY_MAX_CHARS = 420;

export type WikipediaSummary = {
  title: string;
  extract: string;
  pageUrl: string;
  /** Fully-qualified `File:` title of the lead image, or null. */
  leadImageTitle: string | null;
};

export type WikipediaImageCredit = {
  imageUrl: string;
  artist: string | null;
  licenseShortName: string;
  descriptionUrl: string;
};

export type PlaceCopy = {
  description: string;
  sourceName: string;
  sourceUrl: string;
  sourceLicense: string;
};

/** Collapse runs of whitespace and trim. */
function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Words that carry a full stop of their own. A break after one of these is the
 * middle of a sentence, not the end of it.
 */
const ABBREVIATIONS = new Set([
  "mt",
  "mts",
  "st",
  "ste",
  "u.s",
  "ca",
  "approx",
  "no",
  "ft",
  "vs",
  "e.g",
  "i.e",
]);

/** The word right before a terminator, lowercased and stripped of leading punctuation. */
function tokenBeforeTerminator(upToTerminator: string): string {
  const raw = upToTerminator.match(/\S+$/)?.[0] ?? "";
  return raw.toLowerCase().replace(/^[^a-z0-9.]+/, "");
}

/**
 * True when `chunk` really ends a sentence, given the text that follows it.
 *
 * A full stop ends a sentence when it sits at the end of the text or is
 * followed by an opening quote or capital letter — and when the word carrying
 * it is neither a bare number ("4,392.1") nor a known abbreviation ("Mt.").
 */
function endsSentence(chunk: string, rest: string): boolean {
  const trimmed = chunk.trimEnd();
  if (trimmed.endsWith(".")) {
    const token = tokenBeforeTerminator(trimmed.slice(0, -1));
    if (/^\d[\d,]*$/.test(token)) return false;
    if (ABBREVIATIONS.has(token.replace(/\.$/, ""))) return false;
  }
  if (rest.trim().length === 0) return true;
  return /^\s*["'“‘(\[«]?[A-Z]/.test(rest);
}

/**
 * Split into sentences, gluing back the false breaks the coarse regex makes at
 * abbreviations and decimal points.
 */
function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let pending = "";
  let cursor = 0;
  for (const match of text.matchAll(/[^.!?]+[.!?]+(?:\s|$)/g)) {
    const chunk = match[0];
    // A full stop with no space after it — "4,392.1" — leaves a gap the regex
    // skipped. Carry it forward so no words are lost.
    pending += text.slice(cursor, match.index) + chunk;
    cursor = match.index + chunk.length;
    if (endsSentence(chunk, text.slice(cursor))) {
      sentences.push(pending);
      pending = "";
    }
  }
  pending += text.slice(cursor);
  // Only offer a trailing remainder that actually ends on a terminator; a
  // dangling fragment is what the hard-truncation path is for.
  if (/[.!?]\s*$/.test(pending)) sentences.push(pending);
  return sentences;
}

/**
 * Trim an extract to whole sentences under `maxChars`. Falls back to a
 * word-boundary cut with an ellipsis when even the first sentence overruns.
 */
export function shortenSummary(extract: string, maxChars = DEFAULT_SUMMARY_MAX_CHARS): string {
  const text = normalizeWhitespace(extract);
  if (text.length <= maxChars) return text;

  const sentences = splitSentences(text);
  let kept = "";
  for (const sentence of sentences) {
    const next = (kept + sentence).trimEnd();
    if (next.length > maxChars) break;
    kept = next + " ";
  }
  kept = kept.trim();
  if (kept.length > 0) return kept;

  // One sentence longer than the cap: cut at the last word boundary, leaving
  // room for the ellipsis.
  const hard = text.slice(0, Math.max(0, maxChars - 1));
  const lastSpace = hard.lastIndexOf(" ");
  return (lastSpace > 0 ? hard.slice(0, lastSpace) : hard).trimEnd() + "…";
}

/** Fold a place name to a comparable form: lowercase, Mt→Mount, alphanumerics only. */
function foldName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\bmt\.?\b/g, "mount")
    .replace(/\bmtn\.?\b/g, "mountain")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * True when a Wikipedia title plausibly names the same place as the catalog
 * destination. Deliberately strict: a geosearch hit 400 m away with a different
 * name is a different feature, and a wrong article is worse than none.
 */
export function namesMatch(destinationName: string, wikipediaTitle: string): boolean {
  const a = foldName(destinationName);
  const b = foldName(wikipediaTitle);
  if (a.length === 0 || b.length === 0) return false;
  return a === b;
}

export function parseSummaryResponse(json: any): WikipediaSummary | null {
  if (!json || typeof json !== "object") return null;
  if (json.type === "disambiguation") return null;

  const title = typeof json.title === "string" ? json.title.trim() : "";
  const extract = typeof json.extract === "string" ? normalizeWhitespace(json.extract) : "";
  const pageUrl =
    typeof json?.content_urls?.desktop?.page === "string" ? json.content_urls.desktop.page : "";
  if (title.length === 0 || extract.length === 0) return null;

  const pageImage = typeof json.pageimage === "string" ? json.pageimage.trim() : "";
  const leadImageTitle = pageImage.length > 0 ? `File:${pageImage}` : null;

  return { title, extract, pageUrl, leadImageTitle };
}

/** Strip HTML tags and collapse whitespace — Commons `Artist` is an HTML blob. */
function stripHtml(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]*>/g, " "));
}

/**
 * Read the url, artist, licence name, and file page out of an imageinfo reply.
 * Does not check licence freedom — callers must gate on isFreeLicense.
 */
export function parseImageInfoResponse(json: any): WikipediaImageCredit | null {
  const pages = json?.query?.pages;
  if (!pages || typeof pages !== "object") return null;

  const page: any = Object.values(pages)[0];
  const info = page?.imageinfo?.[0];
  if (!info) return null;

  const imageUrl = typeof info.url === "string" ? info.url : "";
  const descriptionUrl = typeof info.descriptionurl === "string" ? info.descriptionurl : "";
  const licenseShortName =
    typeof info?.extmetadata?.LicenseShortName?.value === "string"
      ? stripHtml(info.extmetadata.LicenseShortName.value)
      : "";
  if (imageUrl.length === 0 || descriptionUrl.length === 0 || licenseShortName.length === 0) {
    return null;
  }

  const rawArtist =
    typeof info?.extmetadata?.Artist?.value === "string" ? stripHtml(info.extmetadata.Artist.value) : "";

  return {
    imageUrl,
    artist: rawArtist.length > 0 ? rawArtist : null,
    licenseShortName,
    descriptionUrl,
  };
}

/**
 * Fold a licence label to a comparable form. Commons writes these by hand, so
 * they arrive with typographic hyphens (U+2010-U+2015) and non-breaking spaces.
 */
function normalizeLicenseLabel(value: string): string {
  return value
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * NonCommercial and NoDerivatives variants. We ship photos inside a paid app
 * and crop them to fit, so neither term is one we can honour.
 */
const NON_FREE_LICENSE_TERMS = /\bnc\b|\bnd\b|-nc|-nd|noncommercial|no ?derivat/;

/** Allow-list of licence families we are willing to redistribute a photo under. */
export function isFreeLicense(licenseShortName: string): boolean {
  const value = normalizeLicenseLabel(licenseShortName);
  if (value.length === 0) return false;
  if (value.includes("fair use") || value.includes("all rights reserved")) return false;
  // Checked before the allow-list: "CC BY-NC 2.0" starts with "cc by" but is not free.
  if (NON_FREE_LICENSE_TERMS.test(value)) return false;
  return (
    value.startsWith("cc0") ||
    value.startsWith("cc by") ||
    value.startsWith("cc-by") ||
    value.includes("public domain") ||
    value.startsWith("pd")
  );
}

export function buildImageAttribution(credit: WikipediaImageCredit): string {
  const who = credit.artist ?? "Wikimedia Commons";
  return `${who} / ${credit.licenseShortName}`;
}

export function buildPlaceCopy(
  summary: WikipediaSummary,
  maxChars = DEFAULT_SUMMARY_MAX_CHARS
): PlaceCopy | null {
  const description = shortenSummary(summary.extract, maxChars);
  if (description.length === 0) return null;
  // No page URL means no credit line on the client — refuse the copy.
  if (summary.pageUrl.trim().length === 0) return null;

  return {
    description,
    sourceName: WIKIPEDIA_SOURCE_NAME,
    sourceUrl: summary.pageUrl.trim(),
    sourceLicense: WIKIPEDIA_TEXT_LICENSE,
  };
}
