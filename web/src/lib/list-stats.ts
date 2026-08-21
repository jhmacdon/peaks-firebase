const METERS_TO_FEET = 3.28084;

export interface ListToplineFacts {
  count: number;
  highestFt: number | null;
  highestName: string | null;
  states: number;
  countries: number;
}

/**
 * Pure roster stats for a list's topline metrics: destination count, the
 * highest peak (name + elevation in feet, unrounded — UI rounds), and the
 * count of distinct states and countries represented. Null elevations/
 * state/country codes are skipped rather than treated as a value.
 *
 * `states` and `countries` are independent tallies over two different
 * columns — a state_code is only meaningful within its own country
 * (Nepal's "P1" and Washington's "WA" are both non-null state_codes but
 * describe unrelated things), so the page picks one stat or the other by
 * `countries`, never both. See buildListToplineFacts.test's multi-country
 * case.
 */
export function buildListToplineFacts(
  destinations: Array<{
    name: string | null;
    elevation: number | null;
    state_code: string | null;
    country_code: string | null;
  }>
): ListToplineFacts {
  let highestElevation: number | null = null;
  let highestName: string | null = null;

  for (const destination of destinations) {
    if (
      destination.elevation != null &&
      (highestElevation === null || destination.elevation > highestElevation)
    ) {
      highestElevation = destination.elevation;
      highestName = destination.name;
    }
  }

  const states = new Set(
    destinations
      .map((destination) => destination.state_code)
      .filter((code): code is string => code != null)
  );

  const countries = new Set(
    destinations
      .map((destination) => destination.country_code)
      .filter((code): code is string => code != null)
  );

  return {
    count: destinations.length,
    highestFt: highestElevation != null ? highestElevation * METERS_TO_FEET : null,
    highestName,
    states: states.size,
    countries: countries.size,
  };
}
