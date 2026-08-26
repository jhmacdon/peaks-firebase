import { DestinationPhotoSourceError } from "./destination-photo-storage";

const REVIEW_FALLBACK = "Could not review this photo. Try again.";

export function destinationPhotoReviewErrorMessage(error: unknown): string {
  return error instanceof DestinationPhotoSourceError ? error.message : REVIEW_FALLBACK;
}
