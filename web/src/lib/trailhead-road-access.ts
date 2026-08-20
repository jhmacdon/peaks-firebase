// The drive in, as a reader sees it.
//
// One row: what the road asks of a car and what it is made of, read as a
// single answer, with the gate dates and the last rough stretch as sentences
// under it. The same words the iOS route page prints, composed the same way,
// so a trailhead does not describe itself differently in two places.
//
// Everything here reads unvalidated JSONB out of `destinations.amenities`.
// Nothing is trusted: a leaf is used only when its value is the shape the
// contract says it is, and an absent or unusable leaf prints nothing at all.
// There are no placeholders and no "Unknown" — the catalog not knowing is not
// a fact worth a line.

import type { TrailheadRoadAccess } from "./amenities";

/** Who told us, and where to read it. */
export interface AmenityCredit {
  name: string;
  url?: string;
}

/** One labeled fact: a short answer, the sentences that qualify it, its sources. */
export interface AmenityRow {
  label: string;
  value: string;
  captions?: string[];
  credits?: AmenityCredit[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value inside a `SourcedValue`, or undefined when the leaf is malformed. */
export function leafValue(leaf: unknown): unknown {
  return isRecord(leaf) ? leaf.value : undefined;
}

/**
 * The credit for one leaf.
 *
 * A source with no name credits nobody, so it is dropped rather than printed
 * as an empty link. Only http(s) links are kept: the field is data, and a
 * `javascript:` href in a page's markup is not a citation.
 */
export function leafCredit(leaf: unknown): AmenityCredit | null {
  if (!isRecord(leaf) || !isRecord(leaf.source)) return null;
  const { name, url } = leaf.source;
  if (typeof name !== "string" || name.trim().length === 0) return null;
  const link = typeof url === "string" && /^https?:\/\//i.test(url.trim()) ? url.trim() : undefined;
  return link ? { name: name.trim(), url: link } : { name: name.trim() };
}

/** Credits in printed order, one per source rather than one per leaf. */
export function dedupeCredits(credits: Array<AmenityCredit | null | undefined>): AmenityCredit[] {
  const seen = new Set<string>();
  const out: AmenityCredit[] = [];
  for (const credit of credits) {
    if (!credit || seen.has(credit.name)) continue;
    seen.add(credit.name);
    out.push(credit);
  }
  return out;
}

/**
 * What the road asks of the car.
 *
 * The catalog answers in two leaves and a driver needs only the strongest of
 * them, so they collapse into one demand. Four driven wheels outrank clearance:
 * a road that needs them needs the clearance too, and a `four_wheel_drive:
 * false` sitting under a clearance leaf adds nothing that leaf has not said —
 * it is only spoken when it arrives alone.
 */
export function vehicleDemand(highClearance: unknown, fourWheelDrive: unknown): string | null {
  if (fourWheelDrive === true) return "4WD required";
  switch (highClearance) {
    case "required":
      return "High-clearance required";
    case "recommended":
      return "High-clearance recommended";
    case "not_required":
      return "Passenger car OK";
    default:
      return fourWheelDrive === false ? "4WD not required" : null;
  }
}

/**
 * What the road is made of, and whether that word is a thing or a description
 * of one. "Gravel" and "dirt" are things a road is built from, so a demand can
 * lean on one as an adjective — "High-clearance gravel". "Paved" describes the
 * road instead, and "High-clearance paved" is not English.
 *
 * The importer normalizes the agency codes into words, so the codes are here
 * only in case one arrives un-normalized. Anything else is the agency's own
 * wording and prints as it came: it knows its road better than a guess at
 * which bucket the road belongs in.
 */
export function roadSurface(raw: unknown): { label: string; isNoun: boolean } | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  switch (trimmed.toLowerCase()) {
    case "ac":
    case "asphalt":
    case "asphalt concrete":
    case "paved":
    case "pavement":
    case "concrete":
      return { label: "Paved", isNoun: false };
    case "agg":
    case "aggregate":
    case "gravel":
    case "crushed rock":
      return { label: "Gravel", isNoun: true };
    case "nat":
    case "native":
    case "native material":
    case "dirt":
      return { label: "Dirt", isNoun: true };
    default:
      return { label: trimmed.charAt(0).toUpperCase() + trimmed.slice(1), isNoun: false };
  }
}

/** A word that led a phrase, put back in the middle of one. An acronym keeps its capitals. */
function midSentence(label: string): string {
  const firstWord = label.split(" ")[0] ?? label;
  const isAcronym = firstWord.length > 1 && firstWord === firstWord.toUpperCase();
  return isAcronym ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * Car and surface as one answer. Either half may be missing, and the half that
 * survives says the whole of what the catalog knows — nothing is filled in
 * around it.
 */
export function roadValue(
  demand: string | null,
  surface: { label: string; isNoun: boolean } | null
): string | null {
  if (!demand && !surface) return null;
  if (!demand) return surface!.label;
  if (!surface) return demand;
  if (demand === "High-clearance required" && surface.isNoun) {
    return `High-clearance ${midSentence(surface.label)}`;
  }
  return `${demand}, ${midSentence(surface.label)}`;
}

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * One end of the gate window as a month and a day, or null when it is not a
 * date at all. The importer writes ISO days; `MM/DD` is read too, because that
 * is what a provider leaves behind when nobody normalized it, and everything
 * else — `N/A`, `TBD`, `13/45` — is a placeholder wearing a date's clothes.
 */
export function seasonalDateLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const day = raw.trim().split(/[T ]/)[0] ?? "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const monthDay = /^(\d{2})[/-](\d{2})$/.exec(day);
  // A year-less window is printed month and day only, so which year it is read
  // against cannot show — except on February 29, which needs a leap year to
  // exist at all.
  const year = iso ? Number(iso[1]) : 2024;
  const month = iso ? Number(iso[2]) : Number(monthDay?.[1]);
  const date = iso ? Number(iso[3]) : Number(monthDay?.[2]);
  if (!Number.isFinite(month) || !Number.isFinite(date)) return null;
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== date
  ) {
    return null;
  }
  return MONTH_DAY.format(parsed);
}

/**
 * The months the gate is open. "Typically" is not hedging for its own sake:
 * this is a published schedule, and a slide or a late snowpack keeps a road
 * shut through a date the calendar says is open.
 *
 * Both ends must read as dates or the whole caption goes. A window is a span,
 * and half of one printed as "Gate typically open Jun 2 – N/A" is worse than
 * silence: it dresses a provider's placeholder up as the day the gate shuts.
 */
export function seasonalCaption(window: unknown): string | null {
  if (!isRecord(window)) return null;
  const opens = seasonalDateLabel(window.opens);
  const closes = seasonalDateLabel(window.closes);
  if (!opens || !closes) return null;
  return `Gate typically open ${opens} – ${closes}`;
}

/**
 * The whole road row, or null when the block says nothing worth printing.
 *
 * With no vehicle demand and no surface there is no short answer, so the first
 * sentence takes the answer's place rather than standing under an empty line —
 * the same rule the iOS row follows.
 */
export function roadAccessRow(block: TrailheadRoadAccess | undefined | null): AmenityRow | null {
  if (!isRecord(block)) return null;

  const demand = vehicleDemand(leafValue(block.high_clearance), leafValue(block.four_wheel_drive));
  const surface = roadSurface(leafValue(block.surface));
  const captions: string[] = [];
  const credits: Array<AmenityCredit | null> = [];

  if (surface) credits.push(leafCredit(block.surface));
  if (demand) {
    credits.push(
      demand.startsWith("4WD") ? leafCredit(block.four_wheel_drive) : leafCredit(block.high_clearance)
    );
  }

  const seasonal = seasonalCaption(leafValue(block.seasonal_window));
  if (seasonal) {
    captions.push(seasonal);
    credits.push(leafCredit(block.seasonal_window));
  }

  const segment = leafValue(block.limiting_segment_ref);
  if (typeof segment === "string" && segment.trim().length > 0) {
    captions.push(`Last rough stretch: ${segment.trim()}`);
    credits.push(leafCredit(block.limiting_segment_ref));
  }

  let value = roadValue(demand, surface);
  if (value === null && captions.length > 0) value = captions.shift() as string;
  if (value === null) return null;

  return { label: "Road", value, captions, credits: dedupeCredits(credits) };
}

/** The road row as one short chip, for the admin page's badge list. */
export function roadAccessBadge(block: TrailheadRoadAccess | undefined | null): string | null {
  const row = roadAccessRow(block);
  if (!row) return null;
  return `road: ${midSentence(row.value)}`;
}
