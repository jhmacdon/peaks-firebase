import { DestinationPhotoSourceError } from "./destination-photo-storage";

export function destinationPhotoActionErrorMessage(
  error: unknown,
  fallback: string
): string {
  return error instanceof DestinationPhotoSourceError ? error.message : fallback;
}
