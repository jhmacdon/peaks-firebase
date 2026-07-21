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

const MANAGER_NAMES: Record<string, string> = {
  NPS: "The National Park Service",
  USFS: "The U.S. Forest Service",
  BLM: "The Bureau of Land Management",
  FWS: "The U.S. Fish and Wildlife Service",
  USBR: "The Bureau of Reclamation",
  DOD: "The Department of Defense",
  OTHF: "A federal agency",
  JNT: "Several agencies",
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

function managerName(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return MANAGER_NAMES[value] ?? value;
}

/**
 * Writes a short area summary from catalog facts only. Keep this plain: the
 * source data names the place, land type, manager, states, and linked peaks.
 */
export function buildAreaDescription(input: AreaDescriptionInput): string {
  const kind = KIND_LABELS[input.kind] ?? "protected area";
  const place = placeText(input.stateCodes);
  const manager = managerName(input.manager);
  const managerVerb = input.manager?.trim() === "JNT" ? "manage" : "manages";
  const firstSentence = manager
    ? `${manager} ${managerVerb} ${input.name}, a ${kind}${place}.`
    : `${input.name} is a ${kind}${place}.`;

  const peaks = cleanStrings(input.peakNames).slice(0, 3);
  if (peaks.length === 0) return firstSentence;
  return `${firstSentence} Peaks tracks ${formatEnglishList(peaks)} here.`;
}
