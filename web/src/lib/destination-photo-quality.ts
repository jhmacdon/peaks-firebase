export const DESTINATION_PHOTO_MIN_WIDTH = 1_600;
export const DESTINATION_PHOTO_MIN_HEIGHT = 900;

export function destinationPhotoDimensionError(
  width: number | null,
  height: number | null
): string | null {
  if (width === null || !Number.isInteger(width) || width <= 0) {
    return "Image width must be a positive whole number";
  }
  if (height === null || !Number.isInteger(height) || height <= 0) {
    return "Image height must be a positive whole number";
  }
  if (width < DESTINATION_PHOTO_MIN_WIDTH || height < DESTINATION_PHOTO_MIN_HEIGHT) {
    return (
      `Photo is ${width}×${height}; covers must be at least ` +
      `${DESTINATION_PHOTO_MIN_WIDTH}×${DESTINATION_PHOTO_MIN_HEIGHT}`
    );
  }
  return null;
}
