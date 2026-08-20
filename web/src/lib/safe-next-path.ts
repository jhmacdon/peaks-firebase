/**
 * Constrain a `next` redirect parameter to a local path so auth pages cannot
 * be used as an open redirect. Browsers treat `//host` and `/\host` as
 * protocol-relative URLs, so both are rejected along with anything that does
 * not start with `/`.
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback = "/discover"
): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}
