/**
 * How a hiker reaches a route's start: by car (parking), by lift, or by
 * public transport. Stored on the start (trailhead) destination as
 * `destinations.metadata.start_access`; served to clients as the typed
 * `start_access` field. Contract: docs/start-access.md.
 *
 * A missing or unreadable value means parking, so every route loaded before
 * this field existed keeps its car directions.
 */

export const START_ACCESS_KINDS = ["parking", "lift", "transit"] as const;
export type StartAccessKind = (typeof START_ACCESS_KINDS)[number];

export const START_ACCESS_MODES = [
  "train",
  "bus",
  "tram",
  "boat",
  "cable_car",
  "gondola",
  "funicular",
  "chair_lift",
] as const;
export type StartAccessMode = (typeof START_ACCESS_MODES)[number];

export interface StartAccess {
  kind: StartAccessKind;
  mode: StartAccessMode | null;
  station_name: string | null;
  operator: string | null;
}

/** Select the stored value as JSONB, so it serializes as an object. */
export function startAccessSql(alias = "d"): string {
  return `${alias}.metadata->'start_access' AS start_access`;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validate a stored value into the served shape, or null.
 *
 * An unknown kind serves null (parking) rather than a guess. An unknown mode
 * keeps the kind and drops the mode: a lift start with an unreadable mode is
 * still a lift start and must never fall back to car directions. A parking
 * start carries no mode or station.
 */
export function normalizeStartAccess(raw: unknown): StartAccess | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const kind = START_ACCESS_KINDS.find((k) => k === value.kind);
  if (!kind) return null;
  if (kind === "parking") {
    return { kind, mode: null, station_name: null, operator: null };
  }
  const mode = START_ACCESS_MODES.find((m) => m === value.mode) ?? null;
  return {
    kind,
    mode,
    station_name: textOrNull(value.station_name),
    operator: textOrNull(value.operator),
  };
}

/** A copy of `row` whose `start_access` is normalized. Always sets the key,
 *  so a parking start sends an explicit null rather than dropping it. */
export function withStartAccess<T extends Record<string, unknown>>(
  row: T
): T & { start_access: StartAccess | null } {
  return { ...row, start_access: normalizeStartAccess(row.start_access) };
}
