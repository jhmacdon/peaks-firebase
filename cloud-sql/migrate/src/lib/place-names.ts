// Peaks never shows "Mt", "Mtn" or "Pk". Source data (OSM, PAD-US) often
// does, so importers spell names out before writing them; the database
// rejects an abbreviated catalog name (migrations/20261014_expand_name_abbreviations.sql).
//
// "Mt" before a name is "Mount" ("Mt. Hood" → "Mount Hood"). After a name and
// before a generic word, or at the end, it is "Mountain" ("Chimney Mt Trail" →
// "Chimney Mountain Trail", "10th Mt. Div." → "10th Mountain Div."). "Mtn" is
// always "Mountain" and "Pk" always "Peak". "St" stays: it is the official
// form in many names ("Mount St. Helens").

const ABBREVIATION = /^(mtn|mt|pk)(\.?)(.*)$/i;

// Words that follow "Mt" only when "Mt" means "Mountain".
const GENERIC_AFTER_MOUNTAIN = new Set([
  "trail", "trailhead", "vista", "overlook", "outlook", "view", "viewpoint", "cliffs",
  "road", "rd", "div", "division", "lake", "lookout", "fire", "summit", "ridge",
  "range", "campground", "camp", "park", "wilderness", "area", "pass",
]);

// Words before "Mt" that start a new name, so "Mt" there is "Mount".
const CONNECTORS = new Set(["of", "at", "to", "and", "&", "/", "-", "–", "near", "on", "from", "via"]);

function bareWord(token: string | undefined): string {
  return (token ?? "").toLowerCase().replace(/[.,()]/g, "");
}

export function hasNameAbbreviation(name: string): boolean {
  return /(^|[^\p{L}\p{N}])(mt|mtn|pk)(\.|(?![\p{L}\p{N}]))/iu.test(name);
}

export function expandNameAbbreviations(name: string): string {
  const parts = name.split(/(\s+)/);
  const wordIndexes = parts.flatMap((part, index) => (part.trim() ? [index] : []));
  wordIndexes.forEach((index, position) => {
    const token = parts[index];
    // "(Mt.Shiude)" keeps its leading punctuation.
    const lead = token.match(/^[(\[“"']*/)?.[0] ?? "";
    const match = token.slice(lead.length).match(ABBREVIATION);
    if (!match) return;
    const [, abbreviation, period, rest] = match;
    // "Mtn", "Mt." or a bare word "Mt"; "Mtxyz" is a different word.
    if (rest && !period && /^[\p{L}\p{N}]/u.test(rest)) return;
    const kind = abbreviation.toLowerCase();
    let word: string;
    if (kind === "mtn") word = "Mountain";
    else if (kind === "pk") word = "Peak";
    else {
      const previous = position > 0 ? parts[wordIndexes[position - 1]] : undefined;
      const next = rest ? rest : position + 1 < wordIndexes.length ? parts[wordIndexes[position + 1]] : undefined;
      const startsName = previous === undefined || lead !== "" || CONNECTORS.has(bareWord(previous))
        || /[/(\-–]$/.test(previous);
      const genericNext = next === undefined || GENERIC_AFTER_MOUNTAIN.has(bareWord(next));
      word = !startsName && genericNext ? "Mountain" : "Mount";
    }
    // "Mt.Shiude)" → "Mount Shiude)"; a trailing "." with nothing after it goes.
    const tail = rest ? (period && /^[\p{L}\p{N}]/u.test(rest) ? ` ${rest}` : rest) : "";
    parts[index] = `${lead}${word}${tail}`;
  });
  return parts.join("");
}
