export interface ActivityPhotoGroup {
  reportId: string;
  activityName: string;
  date: string;
  activityType: string | null;
  authorName: string;
  photos: { id: string; url: string; caption: string | null }[];
}

/** Keep a small, even spread of each outing, including its first and last photo. */
export function selectActivityPhotos<T>(photos: T[], limit = 3): T[] {
  if (limit <= 0) return [];
  if (photos.length <= limit) return photos;
  if (limit === 1) return [photos[0]];
  return Array.from({ length: limit }, (_, index) => photos[Math.round(index * (photos.length - 1) / (limit - 1))]);
}
