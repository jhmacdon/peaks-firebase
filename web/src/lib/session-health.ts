export interface HeartRateSample {
  time: number;
  value: number;
}

export interface SessionHealthSummary {
  heartRates: HeartRateSample[];
  averageHeartRate: number | null;
  maximumHeartRate: number | null;
  activeCalories: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function epochSeconds(value: unknown): number | null {
  const numeric = finiteNumber(value);
  if (numeric != null) {
    return numeric > 10_000_000_000 ? numeric / 1000 : numeric;
  }
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds / 1000 : null;
}

export function summarizeSessionHealthData(
  raw: unknown
): SessionHealthSummary {
  if (!isRecord(raw)) {
    return {
      heartRates: [],
      averageHeartRate: null,
      maximumHeartRate: null,
      activeCalories: null,
    };
  }

  const rawHeartRates = Array.isArray(raw.heartRates)
    ? raw.heartRates
    : Array.isArray(raw.heart_rates)
      ? raw.heart_rates
      : [];
  const heartRates = rawHeartRates
    .flatMap((entry): HeartRateSample[] => {
      if (!isRecord(entry)) return [];
      const time = epochSeconds(entry.date);
      const value = finiteNumber(entry.heartRate ?? entry.heart_rate);
      if (time == null || value == null || value <= 0) return [];
      return [{ time, value }];
    })
    .sort((left, right) => left.time - right.time);

  const rawCalories = Array.isArray(raw.calories) ? raw.calories : [];
  const calories = rawCalories.flatMap((entry): number[] => {
    if (!isRecord(entry)) return [];
    const value = finiteNumber(entry.calories);
    return value != null && value >= 0 ? [value] : [];
  });

  const heartRateTotal = heartRates.reduce(
    (total, sample) => total + sample.value,
    0
  );
  return {
    heartRates,
    averageHeartRate:
      heartRates.length > 0
        ? Math.round(heartRateTotal / heartRates.length)
        : null,
    maximumHeartRate:
      heartRates.length > 0
        ? Math.round(
            heartRates.reduce(
              (maximum, sample) => Math.max(maximum, sample.value),
              0
            )
          )
        : null,
    activeCalories:
      calories.length > 0
        ? Math.round(calories.reduce((total, value) => total + value, 0))
        : null,
  };
}

export function heartRateAtTime(
  samples: HeartRateSample[],
  targetTime: number
): number | null {
  if (samples.length === 0) return null;
  if (targetTime <= samples[0].time) return Math.round(samples[0].value);
  if (targetTime >= samples[samples.length - 1].time) {
    return Math.round(samples[samples.length - 1].value);
  }

  let low = 0;
  let high = samples.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const sampleTime = samples[middle].time;
    if (sampleTime === targetTime) return Math.round(samples[middle].value);
    if (sampleTime < targetTime) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const before = Math.max(0, high);
  const after = Math.min(samples.length - 1, low);
  const nearest =
    targetTime - samples[before].time <= samples[after].time - targetTime
      ? samples[before]
      : samples[after];
  return Math.round(nearest.value);
}
