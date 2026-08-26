const canonicalShareOrigin = "https://getpeaks.app";

export function resolveShareUrl(
  url: string,
  origin: string = canonicalShareOrigin
): string {
  return new URL(url, origin).toString();
}
