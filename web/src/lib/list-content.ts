// Pure helpers for rendering curated-list description text. Some imported
// list descriptions carry literal "\n" escape sequences instead of real
// newlines (an import-time encoding bug), and about a third of lists never
// got a real description and instead show a copy-pasted placeholder
// sentence. Both are display bugs, not something to fix by writing to the
// database, so they're normalized here at render time.

/** The placeholder sentence a list shows when it has no real description.
 * Treated the same as an empty description — see `isBoilerplateListDescription`. */
export const BOILERPLATE_LIST_DESCRIPTION =
  "A public checklist for planning, progress, and route research.";

/** True when a description is missing or is nothing but the copy-pasted
 * placeholder sentence — callers should omit the description entirely
 * rather than print either. */
export function isBoilerplateListDescription(
  description: string | null | undefined
): boolean {
  const trimmed = description?.trim();
  if (!trimmed) return true;
  return trimmed === BOILERPLATE_LIST_DESCRIPTION;
}

/** Coarse owner label shown when a list has no researched year/organization
 * to display instead. `owner` is `"peaks"` for the curated catalog and a
 * user id for everything else — this is a two-way split, not a lookup. */
export function listOwnerLabel(owner: string): string {
  return owner === "peaks" ? "Peaks curated" : "Community list";
}

export interface ParsedListDescription {
  /** Real body paragraphs, already split on blank-line breaks. Empty when
   * the description is missing, boilerplate, or nothing but a source line. */
  paragraphs: string[];
  /** The cited source URL, if the description ends in a "Source: <url>" line. */
  sourceUrl: string | null;
  /** Host name for the source link, e.g. "peakbagger.com". */
  sourceLabel: string | null;
}

const EMPTY_PARSED: ParsedListDescription = {
  paragraphs: [],
  sourceUrl: null,
  sourceLabel: null,
};

// Matches a trailing "Source: <url>" clause, however it's joined to the
// body text (its own line, or just appended after a sentence).
const SOURCE_CLAUSE = /\s*Source:\s*(https?:\/\/\S+)\s*$/i;

/** Turn a raw list description into render-ready paragraphs plus an
 * optional source link. Normalizes literal "\n" escape sequences (and real
 * newlines) into paragraph breaks, and pulls a trailing "Source: <url>"
 * clause out into its own field instead of leaving it as body copy. */
export function parseListDescription(
  raw: string | null | undefined
): ParsedListDescription {
  if (isBoilerplateListDescription(raw)) return EMPTY_PARSED;

  // `raw` is a literal string containing backslash-n pairs from the import,
  // not actual newline characters — normalize both forms the same way.
  const withRealNewlines = raw!.replace(/\\n/g, "\n");

  let body = withRealNewlines;
  let sourceUrl: string | null = null;
  const sourceMatch = withRealNewlines.match(SOURCE_CLAUSE);
  if (sourceMatch) {
    sourceUrl = sourceMatch[1];
    body = withRealNewlines.slice(0, sourceMatch.index).trim();
  }

  let sourceLabel: string | null = null;
  if (sourceUrl) {
    try {
      sourceLabel = new URL(sourceUrl).host.replace(/^www\./, "");
    } catch {
      // An unparseable "source" isn't worth linking — drop it rather than
      // ship a broken href.
      sourceUrl = null;
    }
  }

  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

  return { paragraphs, sourceUrl, sourceLabel };
}
