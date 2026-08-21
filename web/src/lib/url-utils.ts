/** True for an absolute http(s) URL — the signal `ui/button.tsx` uses to
 * decide whether an `href` needs a plain `<a target="_blank">` (external,
 * e.g. the App Store) instead of a Next `<Link>` (internal route). */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}
