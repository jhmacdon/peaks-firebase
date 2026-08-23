export interface OfficialNationalPark {
  name: string;
  stateCodes: readonly string[];
}

/**
 * The National Park Service's 63 units designated as national parks.
 *
 * PAD-US describes land parcels, not the legal roster. Its designation column
 * can therefore call a real park an MPA, conservation easement, or NCA. Keep
 * the roster here and use PAD-US only to choose the boundary-backed area page.
 * Source: https://www.nps.gov/aboutus/national-park-system.htm
 */
export const OFFICIAL_NATIONAL_PARKS: readonly OfficialNationalPark[] = [
  { name: "Acadia National Park", stateCodes: ["ME"] },
  { name: "Arches National Park", stateCodes: ["UT"] },
  { name: "Badlands National Park", stateCodes: ["SD"] },
  { name: "Big Bend National Park", stateCodes: ["TX"] },
  { name: "Biscayne National Park", stateCodes: ["FL"] },
  { name: "Black Canyon of the Gunnison National Park", stateCodes: ["CO"] },
  { name: "Bryce Canyon National Park", stateCodes: ["UT"] },
  { name: "Canyonlands National Park", stateCodes: ["UT"] },
  { name: "Capitol Reef National Park", stateCodes: ["UT"] },
  { name: "Carlsbad Caverns National Park", stateCodes: ["NM"] },
  { name: "Channel Islands National Park", stateCodes: ["CA"] },
  { name: "Congaree National Park", stateCodes: ["SC"] },
  { name: "Crater Lake National Park", stateCodes: ["OR"] },
  { name: "Cuyahoga Valley National Park", stateCodes: ["OH"] },
  { name: "Death Valley National Park", stateCodes: ["CA", "NV"] },
  { name: "Denali National Park", stateCodes: ["AK"] },
  { name: "Dry Tortugas National Park", stateCodes: ["FL"] },
  { name: "Everglades National Park", stateCodes: ["FL"] },
  { name: "Gates of the Arctic National Park", stateCodes: ["AK"] },
  { name: "Gateway Arch National Park", stateCodes: ["IL", "MO"] },
  { name: "Glacier Bay National Park", stateCodes: ["AK"] },
  { name: "Glacier National Park", stateCodes: ["MT"] },
  { name: "Grand Canyon National Park", stateCodes: ["AZ"] },
  { name: "Grand Teton National Park", stateCodes: ["WY"] },
  { name: "Great Basin National Park", stateCodes: ["NV"] },
  { name: "Great Sand Dunes National Park", stateCodes: ["CO"] },
  { name: "Great Smoky Mountains National Park", stateCodes: ["NC", "TN"] },
  { name: "Guadalupe Mountains National Park", stateCodes: ["TX"] },
  { name: "Haleakalā National Park", stateCodes: ["HI"] },
  { name: "Hawai'i Volcanoes National Park", stateCodes: ["HI"] },
  { name: "Hot Springs National Park", stateCodes: ["AR"] },
  { name: "Indiana Dunes National Park", stateCodes: ["IN"] },
  { name: "Isle Royale National Park", stateCodes: ["MI"] },
  { name: "Joshua Tree National Park", stateCodes: ["CA"] },
  { name: "Katmai National Park", stateCodes: ["AK"] },
  { name: "Kenai Fjords National Park", stateCodes: ["AK"] },
  { name: "Kings Canyon National Park", stateCodes: ["CA"] },
  { name: "Kobuk Valley National Park", stateCodes: ["AK"] },
  { name: "Lake Clark National Park", stateCodes: ["AK"] },
  { name: "Lassen Volcanic National Park", stateCodes: ["CA"] },
  { name: "Mammoth Cave National Park", stateCodes: ["KY"] },
  { name: "Mesa Verde National Park", stateCodes: ["CO"] },
  { name: "Mount Rainier National Park", stateCodes: ["WA"] },
  { name: "National Park of American Samoa", stateCodes: ["AS"] },
  { name: "New River Gorge National Park and Preserve", stateCodes: ["WV"] },
  { name: "North Cascades National Park", stateCodes: ["WA"] },
  { name: "Olympic National Park", stateCodes: ["WA"] },
  { name: "Petrified Forest National Park", stateCodes: ["AZ"] },
  { name: "Pinnacles National Park", stateCodes: ["CA"] },
  { name: "Redwood National Park", stateCodes: ["CA"] },
  { name: "Rocky Mountain National Park", stateCodes: ["CO"] },
  { name: "Saguaro National Park", stateCodes: ["AZ"] },
  { name: "Sequoia National Park", stateCodes: ["CA"] },
  { name: "Shenandoah National Park", stateCodes: ["VA"] },
  { name: "Theodore Roosevelt National Park", stateCodes: ["ND"] },
  { name: "Virgin Islands National Park", stateCodes: ["VI"] },
  { name: "Voyageurs National Park", stateCodes: ["MN"] },
  { name: "White Sands National Park", stateCodes: ["NM"] },
  { name: "Wind Cave National Park", stateCodes: ["SD"] },
  { name: "Wrangell-St. Elias National Park", stateCodes: ["AK"] },
  { name: "Yellowstone National Park", stateCodes: ["ID", "MT", "WY"] },
  { name: "Yosemite National Park", stateCodes: ["CA"] },
  { name: "Zion National Park", stateCodes: ["UT"] },
] as const;

export interface NationalParkAreaCandidate {
  id: string;
  searchName: string;
  boundaryAreaSquareMeters: number;
  destinationCount: number;
}

export interface NationalParkIndexRow {
  id: string;
  name: string;
  kind: "national_park";
  designation: "NP";
  stateCode: string;
  destinationCount: number;
}

export interface NationalParkIndexState {
  code: string;
  count: number;
}

export interface NationalParkIndexResult {
  areas: NationalParkIndexRow[];
  states: NationalParkIndexState[];
  totalMatching: number;
}

// Must match cloud-sql/migrate/src/padus-area-utils.ts. The general web
// search normalizer expands abbreviations but does not strip punctuation or
// accents, so it cannot be used to join against areas.search_name.
function normalizePadusSearchName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function officialNationalParkSearchNames(): string[] {
  return OFFICIAL_NATIONAL_PARKS.map((park) => normalizePadusSearchName(park.name));
}

function candidateRank(candidate: NationalParkAreaCandidate): readonly [number, number, string] {
  return [candidate.boundaryAreaSquareMeters, candidate.destinationCount, candidate.id];
}

function compareCandidates(
  left: NationalParkAreaCandidate,
  right: NationalParkAreaCandidate
): number {
  const leftRank = candidateRank(left);
  const rightRank = candidateRank(right);
  return (
    rightRank[0] - leftRank[0] ||
    rightRank[1] - leftRank[1] ||
    leftRank[2].localeCompare(rightRank[2])
  );
}

/**
 * Builds the National Park index from the legal NPS roster and the best
 * boundary row for each park. It throws if PAD-US lacks a park so a broken
 * import stays visible instead of becoming a shorter, plausible-looking list.
 */
export function buildNationalParkIndex(
  candidates: readonly NationalParkAreaCandidate[],
  options: {
    search?: string;
    stateCode?: string;
    statesLimit: number;
    perStateLimit: number;
  }
): NationalParkIndexResult {
  const candidatesByName = new Map<string, NationalParkAreaCandidate[]>();
  for (const candidate of candidates) {
    const bucket = candidatesByName.get(candidate.searchName) ?? [];
    bucket.push(candidate);
    candidatesByName.set(candidate.searchName, bucket);
  }

  const missing: string[] = [];
  const selected = OFFICIAL_NATIONAL_PARKS.map((park) => {
    const searchName = normalizePadusSearchName(park.name);
    const matches = candidatesByName.get(searchName) ?? [];
    if (matches.length === 0) {
      missing.push(park.name);
      return null;
    }
    return { park, candidate: [...matches].sort(compareCandidates)[0] };
  }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (missing.length > 0) {
    throw new Error(`Missing PAD-US rows for national parks: ${missing.join(", ")}`);
  }

  const normalizedSearch = normalizePadusSearchName(options.search ?? "");
  const searched = normalizedSearch
    ? selected.filter(({ park }) => normalizePadusSearchName(park.name).includes(normalizedSearch))
    : selected;
  const matching = options.stateCode
    ? searched.filter(({ park }) => park.stateCodes.includes(options.stateCode!))
    : searched;

  const stateCounts = new Map<string, number>();
  for (const { park } of matching) {
    for (const stateCode of park.stateCodes) {
      stateCounts.set(stateCode, (stateCounts.get(stateCode) ?? 0) + 1);
    }
  }
  const states = [...stateCounts]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
    .filter((state) => !options.stateCode || state.code === options.stateCode)
    .slice(0, options.statesLimit);
  const areas = states.flatMap((state) =>
    matching
      .filter(({ park }) => park.stateCodes.includes(state.code))
      .sort(
        (left, right) =>
          right.candidate.destinationCount - left.candidate.destinationCount ||
          left.park.name.localeCompare(right.park.name)
      )
      .slice(0, options.perStateLimit)
      .map(({ park, candidate }) => ({
        id: candidate.id,
        name: park.name,
        kind: "national_park" as const,
        designation: "NP" as const,
        stateCode: state.code,
        destinationCount: candidate.destinationCount,
      }))
  );

  return { areas, states, totalMatching: matching.length };
}
