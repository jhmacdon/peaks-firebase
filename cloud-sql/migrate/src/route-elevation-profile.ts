const REVERSAL_DEAD_BAND_METRES = 4;

function roundMetres(elevation: number): number {
  return elevation < 0 ? -Math.round(-elevation) : Math.round(elevation);
}

export function profileIsUsable(elevations: number[]): boolean {
  if (elevations.length < 2) {
    return false;
  }

  let hasNonzeroRoundedSample = false;
  for (const elevation of elevations) {
    if (!Number.isFinite(elevation)) {
      return false;
    }
    hasNonzeroRoundedSample ||= roundMetres(elevation) !== 0;
  }

  return hasNonzeroRoundedSample;
}

export function encodeElevationProfile(elevations: number[]): string | null {
  if (!profileIsUsable(elevations)) {
    return null;
  }

  const profile = elevations.map(roundMetres).join("|");
  return Buffer.from(profile, "ascii").toString("base64");
}

export function decodeElevationProfile(
  encoded: string | null,
  expectedVertexCount?: number
): number[] {
  if (!encoded) {
    return [];
  }

  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) {
    return [];
  }

  const profile = bytes.toString("ascii");
  const samples = profile.split("|");
  if (
    samples.length === 0 ||
    samples.some((sample) => !/^(?:0|[1-9]\d*|-[1-9]\d*)$/.test(sample))
  ) {
    return [];
  }

  const elevations = samples.map(Number);
  if (
    elevations.some((elevation) => !Number.isSafeInteger(elevation)) ||
    (expectedVertexCount !== undefined &&
      (!Number.isSafeInteger(expectedVertexCount) ||
        expectedVertexCount < 0 ||
        elevations.length !== expectedVertexCount))
  ) {
    return [];
  }

  return elevations;
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
