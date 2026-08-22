export type DestinationPhotoDecision = "approve" | "deny";

export const DESTINATION_PHOTO_PAGE_SIZE = 12;

export interface DestinationPhotoPageBounds {
  page: number;
  pageSize: number;
  pageCount: number;
  offset: number;
}

export interface DestinationPhotoFraming {
  focalX: number;
  focalY: number;
}

export function destinationPhotoPageBounds(
  total: number,
  requestedPage: number,
  pageSize = DESTINATION_PHOTO_PAGE_SIZE
): DestinationPhotoPageBounds {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error("Photo total must be a non-negative whole number");
  }
  if (!Number.isInteger(requestedPage) || requestedPage < 0) {
    throw new Error("Photo page must be a non-negative whole number");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new Error("Photo page size must be a whole number from 1 to 50");
  }

  const pageCount = total === 0 ? 0 : Math.ceil(total / pageSize);
  const page = pageCount === 0 ? 0 : Math.min(requestedPage, pageCount - 1);
  return {
    page,
    pageSize,
    pageCount,
    offset: page * pageSize,
  };
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
