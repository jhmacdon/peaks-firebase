const METERS_TO_FEET = 3.28084;

export interface ListToplineFacts {
  count: number;
  highestFt: number | null;
  highestName: string | null;
  states: number;
}

/**
 * Pure roster stats for a list's topline metrics: destination count, the
 * highest peak (name + elevation in feet, unrounded — UI rounds), and the
 * count of distinct states represented. Null elevations/state codes are
 * skipped rather than treated as a value.
 */
export function buildListToplineFacts(
  destinations: Array<{
    name: string | null;
    elevation: number | null;
    state_code: string | null;
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

  return {
    count: destinations.length,
    highestFt: highestElevation != null ? highestElevation * METERS_TO_FEET : null,
    highestName,
    states: states.size,
  };
}
