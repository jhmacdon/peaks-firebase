// Shared guard for the `next` redirect query param on the auth pages.
// Only an internal, single-slash path is safe to redirect to — anything
// else (a protocol-relative "//evil.com" or an absolute "https://evil.com"
// URL) could send a signed-in user off-site, so it falls back to a default.
//
// Two more bypasses beyond a bare "//" leading slash:
//  - A backslash right after the leading slash ("/\evil.com"). WHATWG URL
//    parsing treats "/" and "\" interchangeably at the start of a relative
//    reference, so "/\evil.com" resolves exactly like "//evil.com" once a
//    router turns it into a URL.
//  - A tab/CR/LF anywhere in the value ("/\t/evil.com"). URL parsing strips
//    those characters before resolving, so "/\t/evil.com" collapses to the
//    protocol-relative "//evil.com".
// `searchParams.get("next")` already URL-decodes its value, so a real
// "next=%2F%5Cevil.com" query arrives here as the literal backslash form
// above — there is no separate percent-decoding step for this function to
// worry about.

export const DEFAULT_NEXT_PATH = "/discover";

const SAFE_LEADING_SLASH = /^\/(?!\/|\\)/;
const HAS_STRIPPABLE_CONTROL_CHAR = /[\t\r\n]/;

export function safeNextPath(
  value: string | null | undefined,
  fallback: string = DEFAULT_NEXT_PATH
): string {
  if (
    value &&
    SAFE_LEADING_SLASH.test(value) &&
    !HAS_STRIPPABLE_CONTROL_CHAR.test(value)
  ) {
    return value;
  }
  return fallback;
}
