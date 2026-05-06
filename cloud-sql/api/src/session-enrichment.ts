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

function contributionScopeKey(contribution: JsonObject): string {
  return [
    "source",
    "external_id",
    "original_start_date",
    "original_end_date",
    "fragment_start_date",
    "fragment_end_date",
  ].map((key) => stringValue(contribution[key])).join("\u001f");
}

function mergeContribution(existing: JsonObject, incoming: JsonObject): JsonObject {
  const existingTypes = Array.isArray(existing.contribution_types)
    ? existing.contribution_types.map(String)
    : [];
  const incomingTypes = Array.isArray(incoming.contribution_types)
    ? incoming.contribution_types.map(String)
    : [];

  return {
    ...existing,
    ...incoming,
    contribution_types: Array.from(new Set([...existingTypes, ...incomingTypes])).sort(),
    summary: asObject(incoming.summary) ?? asObject(existing.summary) ?? undefined,
  };
}

export function mergeSourceContributions(existing: unknown, incoming: unknown): JsonObject[] {
  const merged = [...asArray(existing)];
  for (const incomingContribution of asArray(incoming)) {
    const incomingKey = contributionScopeKey(incomingContribution);
    const existingIndex = merged.findIndex((contribution) => (
      contributionScopeKey(contribution) === incomingKey
    ));

    if (existingIndex >= 0) {
      merged[existingIndex] = mergeContribution(merged[existingIndex], incomingContribution);
    } else {
      merged.push(incomingContribution);
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
