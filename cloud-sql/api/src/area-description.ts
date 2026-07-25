export interface AreaDescriptionInput {
  name: string;
  kind: string;
  manager?: string | null;
  stateCodes?: string[] | null;
  peakNames?: string[] | null;
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "Washington, D.C.", FL: "Florida", GA: "Georgia", HI: "Hawaii",
  ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  AS: "American Samoa", GU: "Guam", MP: "the Northern Mariana Islands",
  PR: "Puerto Rico", VI: "the U.S. Virgin Islands",
};

const KIND_LABELS: Record<string, string> = {
  national_park: "national park",
  national_monument: "national monument",
  national_forest: "national forest",
  national_grassland: "national grassland",
  wilderness: "wilderness area",
  national_recreation_area: "national recreation area",
  national_conservation_area: "national conservation area",
  wildlife_refuge: "wildlife refuge",
  wild_and_scenic_river: "wild and scenic river",
  other_federal_area: "protected area",
};

function cleanStrings(values: string[] | null | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

export function formatEnglishList(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function placeText(stateCodes: string[] | null | undefined): string {
  const states = cleanStrings(stateCodes).map((code) => STATE_NAMES[code] ?? code);
  return states.length > 0 ? ` in ${formatEnglishList(states)}` : "";
}

/**
 * Writes a useful fallback from the area's designation, location, and linked
 * peaks. Public source text replaces this when an exact source match exists.
 */
export function buildAreaDescription(input: AreaDescriptionInput): string {
  const place = placeText(input.stateCodes);
  const firstSentence = (() => {
    switch (input.kind) {
      case "national_park":
        return `${input.name} protects a nationally important landscape${place}.`;
      case "national_monument":
        return `${input.name} protects notable natural or cultural features${place}.`;
      case "national_forest":
        return `${input.name} spans public forest, mountain, and watershed country${place}.`;
      case "national_grassland":
        return `${input.name} protects open grassland and prairie habitat${place}.`;
      case "wilderness":
        return `${input.name} preserves undeveloped wild country${place}.`;
      case "national_recreation_area":
        return `${input.name} sets aside public land and water for outdoor recreation${place}.`;
      case "national_conservation_area":
        return `${input.name} protects public land valued for its wildlife, scenery, and history${place}.`;
      case "wildlife_refuge":
        return `${input.name} protects habitat for native fish and wildlife${place}.`;
      case "wild_and_scenic_river":
        return `${input.name} protects a free-flowing river and its surrounding corridor${place}.`;
      default: {
        const kind = KIND_LABELS[input.kind] ?? "protected area";
        return `${input.name} is a ${kind} that protects sensitive public land${place}.`;
      }
    }
  })();

  const peaks = cleanStrings(input.peakNames).slice(0, 3);
  if (peaks.length === 0) return firstSentence;
  return `${firstSentence} Notable high points include ${formatEnglishList(peaks)}.`;
}

const SCENIC_TERMS = [
  "alpine", "canyon", "coast", "desert", "forest", "glacier", "grassland",
  "habitat", "island", "lake", "meadow", "mountain", "peak", "prairie",
  "river", "valley", "volcano", "waterfall", "wetland", "wildlife",
];

const ADMIN_TERMS = [
  " act ", "congress", "designated", "established", "management act",
  "modified in", "visitors in", "was created",
];

function sentenceList(text: string): string[] {
  const Segmenter = (Intl as any).Segmenter;
  if (typeof Segmenter === "function") {
    const segmenter = new Segmenter("en", { granularity: "sentence" });
    return Array.from(segmenter.segment(text), (entry: any) => entry.segment.trim())
      .filter(Boolean);
  }
  return text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((value) => value.trim()) ?? [];
}

function scenicScore(sentence: string): number {
  const lower = ` ${sentence.toLowerCase()} `;
  let score = SCENIC_TERMS.reduce(
    (total, term) => total + (lower.includes(term) ? 1 : 0),
    0
  );
  if (ADMIN_TERMS.some((term) => lower.includes(term))) score -= 4;
  if (/\b(18|19|20)\d{2}\b/.test(sentence)) score -= 1;
  return score;
}

function truncateAtWord(text: string, maximumLength: number): string {
  if (text.length <= maximumLength) return text;
  const shortened = text.slice(0, maximumLength - 1);
  const breakIndex = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, Math.max(0, breakIndex))}…`;
}

function stripOpeningAside(text: string): string {
  return text.replace(
    /^([^()]*)\s+\([^)]*\)(?=\s+(?:is|are|was)\b)/,
    "$1"
  );
}

/**
 * Keep the opening fact and, when present, the best landscape sentence from a
 * public source introduction. The caller must retain source and license data.
 */
export function selectSourceDescription(extract: string, maximumLength = 520): string | null {
  const clean = stripOpeningAside(extract.replace(/\s+/g, " ").trim());
  const sentences = sentenceList(clean);
  if (sentences.length === 0) return null;
  const first = sentences[0];
  const scenic = sentences
    .slice(1)
    .map((sentence, index) => ({ sentence, index, score: scenicScore(sentence) }))
    .filter((entry) => entry.score > 0)
    .sort((lhs, rhs) => rhs.score - lhs.score || lhs.index - rhs.index)[0]?.sentence;
  const selected = scenic ? `${first} ${scenic}` : first;
  return truncateAtWord(selected, maximumLength);
}
