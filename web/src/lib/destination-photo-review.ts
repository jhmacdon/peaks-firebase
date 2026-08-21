export type DestinationPhotoDecision = "approve" | "deny";

export interface DestinationPhotoFraming {
  focalX: number;
  focalY: number;
}

export function requestedDestinationPhotoFraming(
  decision: DestinationPhotoDecision,
  focalX: number,
  focalY: number
): DestinationPhotoFraming | undefined {
  return decision === "approve" ? { focalX, focalY } : undefined;
}

export function approvedDestinationPhotoFraming(
  decision: DestinationPhotoDecision,
  requestedFraming: DestinationPhotoFraming | undefined,
  savedFraming: DestinationPhotoFraming
): DestinationPhotoFraming | null {
  if (decision !== "approve") return null;
  return requestedFraming ?? savedFraming;
}
