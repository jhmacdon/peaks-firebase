// Pure meta-description sentence builders for the public detail pages
// (destinations, routes, areas, lists, reports, log activities). Kept
// free of DB/Firestore calls so they're unit-testable and so every
// `generateMetadata` reads the same rounding + omission rules instead of
// each page inventing its own copy.

import { formatFeet, formatMiles } from "./seo";

function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function capitalize(text: string): string {
  return text.length > 0 ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

/** "Mount Si: 4,167 ft summit in Washington. Routes, conditions,
 * seasonality, and 312 recorded ascents on Peaks." Any missing fact
 * (elevation, feature, region) is omitted rather than printed as a gap. */
export function describeDestination(input: {
  name: string;
  elevationMeters: number | null | undefined;
  featureWord: string | null;
  region: string | null;
  sessionCount: number;
}): string {
  const { name, elevationMeters, featureWord, region, sessionCount } = input;
  const factBits = [formatFeet(elevationMeters), featureWord].filter(Boolean).join(" ");

  let lead: string;
  if (factBits && region) lead = `${name}: ${factBits} in ${region}.`;
  else if (factBits) lead = `${name}: ${factBits}.`;
  else if (region) lead = `${name}: in ${region}.`;
  else lead = `${name} on Peaks.`;

  const tail =
    sessionCount > 0
      ? `Routes, conditions, seasonality, and ${sessionCount.toLocaleString("en-US")} recorded ${pluralize(sessionCount, "ascent")} on Peaks.`
      : "Routes, conditions, and seasonality on Peaks.";

  return `${lead} ${tail}`;
}

/** "Camp Muir Route: 4.1 mi, 4,677 ft gain on Mount Rainier. Route guide
 * with elevation profile and waypoints." */
export function describeRoute(input: {
  name: string;
  distanceMeters: number | null | undefined;
  gainMeters: number | null | undefined;
  primaryDestinationName: string | null;
}): string {
  const { name, distanceMeters, gainMeters, primaryDestinationName } = input;
  const gainText = gainMeters != null ? `${formatFeet(gainMeters)} gain` : null;
  const factBits = [formatMiles(distanceMeters), gainText].filter(Boolean).join(", ");

  let lead: string;
  if (factBits && primaryDestinationName) {
    lead = `${name}: ${factBits} on ${primaryDestinationName}.`;
  } else if (factBits) {
    lead = `${name}: ${factBits}.`;
  } else if (primaryDestinationName) {
    lead = `${name}: on ${primaryDestinationName}.`;
  } else {
    lead = `${name} on Peaks.`;
  }

  return `${lead} Route guide with elevation profile and waypoints.`;
}

/** Highest-elevation named destination on a route — the mountain the route
 * is "on" even when the route itself stops short of the summit (e.g. Camp
 * Muir Route tops out at Camp Muir, on Mount Rainier). Falls back to the
 * first waypoint by ordinal when none of the destinations carry an
 * elevation. */
export function pickPrimaryRouteDestinationName(
  destinations: Array<{ name: string | null; elevation: number | null }>
): string | null {
  const named = destinations.filter(
    (d): d is { name: string; elevation: number | null } => Boolean(d.name)
  );
  if (named.length === 0) return null;

  const withElevation = named.filter((d) => d.elevation != null);
  if (withElevation.length > 0) {
    return withElevation.reduce((best, d) => (d.elevation! > best.elevation! ? d : best)).name;
  }
  return named[0].name;
}

/** "Mount Rainier National Park: National Park in Washington. 42
 * destinations and 12 routes on Peaks." */
export function describeArea(input: {
  name: string;
  designationLabel: string;
  region: string | null;
  destinationCount: number;
  routeCount: number;
}): string {
  const { name, designationLabel, region, destinationCount, routeCount } = input;
  const lead = region
    ? `${name}: ${designationLabel} in ${region}.`
    : `${name}: ${designationLabel}.`;

  const countBits: string[] = [];
  if (destinationCount > 0) {
    countBits.push(`${destinationCount.toLocaleString("en-US")} ${pluralize(destinationCount, "destination")}`);
  }
  if (routeCount > 0) {
    countBits.push(`${routeCount.toLocaleString("en-US")} ${pluralize(routeCount, "route")}`);
  }

  const tail = countBits.length > 0 ? `${countBits.join(" and ")} on Peaks.` : "Boundary and activity on Peaks.";

  return `${lead} ${tail}`;
}

/** "Seven Summits: the tallest peak on each continent. 7 destinations on
 * Peaks." Falls back to a plain "curated list" lead when the list has no
 * source description to summarize. */
export function describeList(input: {
  name: string;
  description: string | null;
  destinationCount: number;
}): string {
  const { name, description, destinationCount } = input;
  const snippet = description
    ? description.replace(/\s+/g, " ").trim().replace(/\.+$/, "")
    : null;

  const lead = snippet ? `${name}: ${snippet}.` : `${name}: a curated list.`;
  const destinationsPhrase = `${destinationCount.toLocaleString("en-US")} ${pluralize(destinationCount, "destination")}`;

  return `${lead} ${capitalize(destinationsPhrase)} on Peaks.`;
}

/** "Summit Day: trip report by Jane Doe, Aug 27, 2022. 2 destinations and
 * 6 photos on Peaks." */
export function describeTripReport(input: {
  title: string;
  authorName: string;
  formattedDate: string;
  destinationCount: number;
  photoCount: number;
}): string {
  const { title, authorName, formattedDate, destinationCount, photoCount } = input;
  const lead = `${title}: trip report by ${authorName}, ${formattedDate}.`;

  const detailBits: string[] = [];
  if (destinationCount > 0) {
    detailBits.push(`${destinationCount.toLocaleString("en-US")} ${pluralize(destinationCount, "destination")}`);
  }
  if (photoCount > 0) {
    detailBits.push(`${photoCount.toLocaleString("en-US")} ${pluralize(photoCount, "photo")}`);
  }

  const tail = detailBits.length > 0 ? `${capitalize(detailBits.join(" and "))} on Peaks.` : "Conditions and route notes on Peaks.";

  return `${lead} ${tail}`;
}

/** Mirrors the log detail page's own name derivation: an explicit session
 * name wins, otherwise the reached (or, failing that, goal) destinations
 * sorted highest-first, otherwise "Untitled Session" — the same fallback
 * text the page itself shows so metadata and h1 never disagree. */
export function deriveActivityDisplayName(
  sessionName: string | null,
  destinations: Array<{ name: string | null; elevation: number | null; relation: string }>
): string {
  if (sessionName) return sessionName;

  const reached = destinations.filter((d) => d.relation === "reached");
  const goal = destinations.filter((d) => d.relation === "goal");
  const naming = reached.length > 0 ? reached : goal;

  const joined = naming
    .filter((d): d is { name: string; elevation: number | null; relation: string } => Boolean(d.name))
    .sort((a, b) => (b.elevation ?? 0) - (a.elevation ?? 0))
    .map((d) => d.name)
    .join(", ");

  return joined || "Untitled Session";
}

/** "6h 40m" style duration for a recorded activity — not the quarter-hour
 * estimate rounding used for route time ranges, since this is an exact
 * recorded value, not a guess. */
export function formatSessionDuration(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** "Mount Si: 4.1 mi, 2,200 ft gain, 3h 15m. Recorded activity on Peaks." */
export function describeSessionActivity(input: {
  name: string;
  distanceMeters: number | null | undefined;
  gainMeters: number | null | undefined;
  totalTimeSeconds: number | null | undefined;
}): string {
  const { name, distanceMeters, gainMeters, totalTimeSeconds } = input;
  const factBits = [
    formatMiles(distanceMeters),
    gainMeters != null ? `${formatFeet(gainMeters)} gain` : null,
    totalTimeSeconds != null ? formatSessionDuration(totalTimeSeconds) : null,
  ].filter(Boolean);

  const lead = factBits.length > 0 ? `${name}: ${factBits.join(", ")}.` : `${name}:`;
  return `${lead} Recorded activity on Peaks.`;
}
