const REVERSAL_DEAD_BAND_METRES = 4;

export function profileIsUsable(elevations: number[]): boolean {
  if (elevations.length < 2) {
    return false;
  }

  let hasNonzeroSample = false;
  for (const elevation of elevations) {
    if (!Number.isFinite(elevation)) {
      return false;
    }
    hasNonzeroSample ||= elevation !== 0;
  }

  return hasNonzeroSample;
}

export function routeProfileHasRealRange(elevations: number[]): boolean {
  if (elevations.length < 2) {
    return false;
  }
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const elevation of elevations) {
    if (!Number.isFinite(elevation)) return false;
    minimum = Math.min(minimum, elevation);
    maximum = Math.max(maximum, elevation);
  }
  return maximum - minimum >= 1;
}

/**
 * Canonical route-profile token shared with PostgreSQL and Swift: the shortest
 * round-trippable decimal expanded to plain notation, with negative zero folded
 * to zero. Decoders still accept scientific notation from older writers.
 */
export function canonicalElevationToken(elevation: number): string | null {
  if (!Number.isFinite(elevation)) return null;
  if (Object.is(elevation, -0) || elevation === 0) return "0";

  const raw = String(elevation);
  const exponentMarker = raw.search(/[eE]/);
  if (exponentMarker < 0) return raw;

  const sign = raw.startsWith("-") ? "-" : "";
  const unsigned = sign ? raw.slice(1) : raw;
  const [coefficient, exponentText] = unsigned.toLowerCase().split("e");
  const exponent = Number(exponentText);
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = whole + fraction;
  const decimalIndex = whole.length + exponent;

  if (decimalIndex <= 0) {
    return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

export function encodeElevationProfile(elevations: number[]): string | null {
  if (!profileIsUsable(elevations)) {
    return null;
  }

  const profile = elevations.map((elevation) => canonicalElevationToken(elevation)!).join("|");
  return Buffer.from(profile, "ascii").toString("base64");
}

export type ElevationProfileDecodeFailure =
  | "missing"
  | "noncanonical_base64"
  | "invalid_sample"
  | "nonfinite_sample"
  | "out_of_range_sample"
  | "invalid_expected_count"
  | "point_count_mismatch";

export interface ElevationProfileDecodeResult {
  elevations: number[];
  failure: ElevationProfileDecodeFailure | null;
}

export function decodeElevationProfileResult(
  encoded: string | null,
  expectedVertexCount?: number
): ElevationProfileDecodeResult {
  if (!encoded) {
    return { elevations: [], failure: "missing" };
  }

  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) {
    return { elevations: [], failure: "noncanonical_base64" };
  }

  const profile = bytes.toString("ascii");
  const samples = profile.split("|");
  if (
    samples.length === 0 ||
    samples.some(
      (sample) =>
        !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(sample)
    )
  ) {
    return { elevations: [], failure: "invalid_sample" };
  }

  const elevations = samples.map(Number);
  if (elevations.some((elevation) => !Number.isFinite(elevation))) {
    return { elevations: [], failure: "nonfinite_sample" };
  }
  if (
    elevations.some((elevation) => elevation < -12_000 || elevation > 12_000)
  ) {
    return { elevations: [], failure: "out_of_range_sample" };
  }
  if (
    expectedVertexCount !== undefined &&
    (!Number.isSafeInteger(expectedVertexCount) || expectedVertexCount < 0)
  ) {
    return { elevations: [], failure: "invalid_expected_count" };
  }
  if (
    expectedVertexCount !== undefined &&
    elevations.length !== expectedVertexCount
  ) {
    return { elevations: [], failure: "point_count_mismatch" };
  }

  return { elevations, failure: null };
}

export function decodeElevationProfile(
  encoded: string | null,
  expectedVertexCount?: number
): number[] {
  return decodeElevationProfileResult(encoded, expectedVertexCount).elevations;
}

export function computeRouteElevationStats(
  elevations: number[]
): { gain: number; loss: number } {
  if (elevations.length < 2) {
    return { gain: 0, loss: 0 };
  }

  for (const elevation of elevations) {
    if (!Number.isFinite(elevation)) {
      return { gain: 0, loss: 0 };
    }
  }

  let gain = 0;
  let loss = 0;
  let pending = 0;

  for (let index = 1; index < elevations.length; index += 1) {
    const difference = elevations[index] - elevations[index - 1];

    if (
      (pending >= 0 && difference >= 0) ||
      (pending <= 0 && difference <= 0)
    ) {
      pending += difference;
      continue;
    }

    if (pending > REVERSAL_DEAD_BAND_METRES) {
      gain += pending;
    } else if (pending < -REVERSAL_DEAD_BAND_METRES) {
      loss += Math.abs(pending);
    }
    pending = difference;
  }

  if (pending > REVERSAL_DEAD_BAND_METRES) {
    gain += pending;
  } else if (pending < -REVERSAL_DEAD_BAND_METRES) {
    loss += Math.abs(pending);
  }

  return { gain, loss };
}
