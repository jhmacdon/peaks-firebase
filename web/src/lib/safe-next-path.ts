// Shared guard for the `next` redirect query param on the auth pages.
// Only an internal, single-slash path is safe to redirect to — anything
// else (a protocol-relative "//evil.com" or an absolute "https://evil.com"
// URL) could send a signed-in user off-site, so it falls back to a default.

export const DEFAULT_NEXT_PATH = "/discover";

export function safeNextPath(
  value: string | null | undefined,
  fallback: string = DEFAULT_NEXT_PATH
): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return fallback;
}
