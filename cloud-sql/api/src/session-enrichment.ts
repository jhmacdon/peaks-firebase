type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function asArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => asObject(item) !== null)
    : [];
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

// Scope is activity identity only (source, external_id) — date fields drift
// between re-imports of the same activity and must not fragment its scope.
function contributionScopeKey(contribution: JsonObject): string {
  return ["source", "external_id"].map((key) => stringValue(contribution[key])).join("\u001f");
}

function parsedTime(value: unknown): number {
  return Date.parse(stringValue(value));
}

function widenedStart(a: unknown, b: unknown): unknown {
  const ta = parsedTime(a);
  const tb = parsedTime(b);
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a;
  return ta <= tb ? a : b;
}

// undefined/null is open-ended and therefore the widest end.
function widenedEnd(a: unknown, b: unknown): unknown {
  if (a === undefined || a === null || b === undefined || b === null) return undefined;
  const ta = parsedTime(a);
  const tb = parsedTime(b);
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a;
  return ta >= tb ? a : b;
}

function mergeContribution(existing: JsonObject, incoming: JsonObject): JsonObject {
  const existingTypes = Array.isArray(existing.contribution_types)
    ? existing.contribution_types.map(String)
    : [];
  const incomingTypes = Array.isArray(incoming.contribution_types)
    ? incoming.contribution_types.map(String)
    : [];

  const merged: JsonObject = {
    ...existing,
    ...incoming,
    original_start_date: widenedStart(existing.original_start_date, incoming.original_start_date),
    original_end_date: widenedEnd(existing.original_end_date, incoming.original_end_date),
    fragment_start_date: widenedStart(existing.fragment_start_date, incoming.fragment_start_date),
    fragment_end_date: widenedEnd(existing.fragment_end_date, incoming.fragment_end_date),
    contribution_types: Array.from(new Set([...existingTypes, ...incomingTypes])).sort(),
    summary: asObject(incoming.summary) ?? asObject(existing.summary) ?? undefined,
  };
  if (merged.fragment_end_date === undefined) delete merged.fragment_end_date;
  if (merged.original_end_date === undefined) delete merged.original_end_date;
  return merged;
}

export function mergeSourceContributions(existing: unknown, incoming: unknown): JsonObject[] {
  // The stored list can carry drifted near-duplicates written before scope
  // became identity-only, so it folds through the same merge as incoming.
  const merged: JsonObject[] = [];
  for (const contribution of [...asArray(existing), ...asArray(incoming)]) {
    const key = contributionScopeKey(contribution);
    const index = merged.findIndex((c) => contributionScopeKey(c) === key);
    if (index >= 0) {
      merged[index] = mergeContribution(merged[index], contribution);
    } else {
      merged.push(contribution);
    }
  }
  return merged;
}

function normalizedSample(sample: JsonObject, valueKey: string): JsonObject | null {
  if (valueKey === "heartRate") {
    const heartRate = sample.heartRate ?? sample.heart_rate;
    return heartRate === undefined ? null : {
      date: sample.date,
      heartRate,
    };
  }

  return sample[valueKey] === undefined ? null : sample;
}

function mergeSamples(existing: unknown, incoming: unknown, valueKey: string): JsonObject[] {
  const samplesByDate = new Map<string, JsonObject>();
  for (const sample of asArray(existing)) {
    const normalized = normalizedSample(sample, valueKey);
    if (!normalized) continue;
    const date = stringValue(sample.date);
    if (date) samplesByDate.set(date, normalized);
  }
  for (const sample of asArray(incoming)) {
    const normalized = normalizedSample(sample, valueKey);
    if (!normalized) continue;
    const date = stringValue(sample.date);
    if (date && !samplesByDate.has(date)) {
      samplesByDate.set(date, normalized);
    }
  }

  return Array.from(samplesByDate.values()).sort((a, b) => (
    stringValue(a.date).localeCompare(stringValue(b.date))
  ));
}

export function mergeHealthData(existing: unknown, incoming: unknown): JsonObject | null {
  const existingHealth = asObject(existing);
  const incomingHealth = asObject(incoming);
  if (!existingHealth && !incomingHealth) return null;

  const calories = mergeSamples(existingHealth?.calories, incomingHealth?.calories, "calories");
  const heartRates = mergeSamples(
    existingHealth?.heartRates ?? existingHealth?.heart_rates,
    incomingHealth?.heartRates ?? incomingHealth?.heart_rates,
    "heartRate"
  );

  return calories.length || heartRates.length ? { calories, heartRates } : null;
}
