"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth-context";
import Avatar from "./avatar";
import { Button } from "./ui/button";

// AppNav — the chrome on every non-admin page. See web/docs/design-tokens.md.
//
// Three bars, one component:
//   • desktop (md+): a 56px sticky bar, flat until the page scrolls
//   • mobile: a 48px sticky top bar (wordmark + one action) …
//   • …plus the fixed bottom tab bar
// The wordmark and the primary CTA used to disappear below md, which left the
// brand invisible on phones — the top bar fixes that.
//
// Exactly one sign-in affordance is visible per viewport: the desktop bar's
// quiet "Log in", or the mobile tab bar's "Sign In" tab. Neither viewport
// shows both.

const APP_STORE_URL =
  "https://apps.apple.com/us/app/peaks-track-your-climb/id1497469000";

type NavLink = { href: string; label: string };

/** Catalog links — the left group on desktop, the first three tabs on mobile. */
const BROWSE_LINKS: NavLink[] = [
  { href: "/discover", label: "Discover" },
  { href: "/map", label: "Map" },
  { href: "/lists", label: "Lists" },
  { href: "/areas", label: "Areas" },
];

/** A signed-in user's own records. Right group on desktop, tabs on mobile. */
const ACTIVITY_LINKS: NavLink[] = [
  { href: "/log", label: "Log" },
  { href: "/plans", label: "Plans" },
];

// Areas has no tab of its own — five is the most a 375px bar seats
// comfortably, and Areas is one tap away from Discover and the footer.
const MOBILE_BROWSE_TABS = BROWSE_LINKS.filter((link) => link.href !== "/areas");

const ACCOUNT_MENU_LINKS: NavLink[] = [
  { href: "/account", label: "Account" },
  { href: "/saved", label: "Saved" },
  { href: "/account/friends", label: "Friends" },
];

// `/` redirects to `/discover`, so the two share an active state. Everything
// else matches on whole path segments — a bare `startsWith` would light up
// "Log" on `/login`.
function isActivePath(pathname: string, href: string): boolean {
  if (href === "/discover" && pathname === "/") return true;
  // Sign-in and create-account are one destination as far as the tab bar is
  // concerned.
  if (href === "/login" && pathname === "/register") return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const NAV_LINK_BASE = "text-sm font-medium transition-colors";

function navLinkClasses(active: boolean): string {
  return active
    ? `${NAV_LINK_BASE} nav-underline text-accent-text`
    : `${NAV_LINK_BASE} text-ink-2 hover:text-ink`;
}

/**
 * True once the page has scrolled off the top. A zero-cost sentinel at the
 * very top of the document beats a scroll listener: the observer only fires
 * on the two crossings, where a listener fires on every frame of every
 * scroll. `-mb-px` cancels the sentinel's own 1px so it costs no layout.
 */
function useStuck() {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return { sentinelRef, stuck };
}

/**
 * Desktop-only search affordance: one quiet icon-link to Discover, which is
 * where the search field lives. Icon-only, so the accessible name is an
 * `aria-label` and the glyph is hidden from the tree. Neutral ink, not
 * accent — the accent budget is spent on the primary action and the active
 * nav marker. Mobile doesn't get one: its Discover tab already sits in the
 * bottom bar, one tap from anywhere.
 *
 * `/discover` renders SearchBar, which syncs to a `?q=` param and has no
 * hash-based focus hook — so this links to the page, not to a focused field.
 * If a `#search` focus target lands later, point the href at it.
 */
function SearchLink() {
  return (
    <Link
      href="/discover"
      aria-label="Search"
      className="flex h-8 w-8 items-center justify-center text-ink-2 transition-colors hover:text-ink"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    </Link>
  );
}

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      // The display face at 20px is a deliberate exception to the
      // "display face at 32px and up" rule — this is the brand mark, not a
      // heading. `translate-y-px` is optical, not geometric: "Peaks" has no
      // descender, so box-centering parks its cap height a hair high.
      className={`translate-y-px font-display text-[20px] font-[650] leading-none tracking-[-0.015em] text-ink ${className}`.trim()}
    >
      Peaks
    </Link>
  );
}

export default function AppNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { sentinelRef, stuck } = useStuck();
  const signedIn = user !== null;
  const shadow = stuck ? "shadow-float" : "";

  // Signed in, the avatar in the top bar is the account affordance, so the
  // tab bar spends its fifth slot on Plans rather than a second route to
  // Account — and Lists stops disappearing the moment a user signs in.
  const tabs: NavLink[] = signedIn
    ? [...MOBILE_BROWSE_TABS, ...ACTIVITY_LINKS]
    : [...MOBILE_BROWSE_TABS, { href: "/login", label: "Sign In" }];

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="-mb-px h-px" />

      {/* Mobile: slim top bar. Carries the brand and one action; the tab bar
          below carries navigation. */}
      <header
        className={`sticky top-0 z-50 border-b border-hairline bg-page md:hidden ${shadow}`}
      >
        <div className="flex h-12 items-center justify-between px-4">
          <Wordmark />
          {signedIn ? (
            <Link
              href="/account"
              aria-label="Account"
              className="flex items-center rounded-full"
            >
              <Avatar
                name={user.displayName || user.email}
                avatarUrl={user.photoURL}
                size="sm"
              />
            </Link>
          ) : (
            <Button href={APP_STORE_URL} variant="primary" size="sm" external>
              Get the app
            </Button>
          )}
        </div>
      </header>

      {/* Desktop bar */}
      <header
        className={`sticky top-0 z-50 hidden border-b border-hairline bg-page md:block ${shadow}`}
      >
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-8 px-6">
          <Wordmark />

          <nav aria-label="Browse" className="flex items-center gap-6">
            {BROWSE_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActivePath(pathname, link.href) ? "page" : undefined}
                className={navLinkClasses(isActivePath(pathname, link.href))}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-5">
            {signedIn ? (
              <>
                <nav aria-label="Your activity" className="flex items-center gap-6">
                  {ACTIVITY_LINKS.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={
                        isActivePath(pathname, link.href) ? "page" : undefined
                      }
                      className={navLinkClasses(isActivePath(pathname, link.href))}
                    >
                      {link.label}
                    </Link>
                  ))}
                </nav>
                <SearchLink />
                <AccountMenu />
              </>
            ) : (
              <>
                <SearchLink />
                <div className="flex items-center gap-2">
                  <Button href="/login" variant="quiet" size="sm">
                    Log in
                  </Button>
                  <Button href={APP_STORE_URL} variant="primary" size="sm" external>
                    Get the app
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Mobile: bottom tab bar */}
      <nav
        aria-label="Sections"
        className="safe-area-bottom fixed inset-x-0 bottom-0 z-50 border-t border-hairline bg-page md:hidden"
      >
        <div className="flex h-13 items-stretch">
          {tabs.map((tab) => {
            const active = isActivePath(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium leading-none transition-colors ${
                  active ? "text-accent-text" : "text-muted"
                }`}
              >
                <NavIcon name={tab.label} active={active} />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

/**
 * Avatar trigger + popover. A disclosure, not a WAI-ARIA menu: the items are
 * ordinary links that Tab reaches in DOM order, so promising `role="menu"`
 * would commit to arrow-key roving focus this doesn't implement. Closes on
 * outside pointer-down, on Escape (returning focus to the trigger), and on
 * navigation — the links don't unmount the popover on their own.
 */
function AccountMenu() {
  const { user, signOut } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // A hard navigation, not `router.push`: on an authenticated page the
  // sign-out flips `user` to null, and UserAuthGuard's own effect races a
  // client transition with `router.replace("/login?next=<page just left>")`.
  // Reloading onto a public page settles it and drops every scrap of
  // signed-in client state with it.
  const handleSignOut = useCallback(async () => {
    setOpen(false);
    await signOut();
    window.location.assign("/discover");
  }, [signOut]);

  if (!user) return null;

  const name = user.displayName || user.email;

  return (
    <div className="relative">
      {/* A disclosure button: a fixed accessible name plus `aria-expanded`,
          which already carries the open/closed state. No `aria-haspopup`,
          which would advertise menu semantics this doesn't implement. The
          name comes from `aria-label` alone — one mechanism, not two. An
          sr-only span alongside would concatenate with the avatar's own
          initial and be read out as "Account menu J". */}
      <button
        ref={triggerRef}
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center rounded-full"
      >
        <Avatar name={name} avatarUrl={user.photoURL} size="sm" />
      </button>

      {open ? (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-50 mt-2 w-48 rounded-ctl border border-border bg-page py-1 shadow-float"
        >
          <p className="truncate px-3 py-2 text-[13px] text-muted">{name}</p>
          <div className="border-t border-hairline" />
          {ACCOUNT_MENU_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block px-3 py-2 text-sm text-ink-2 hover:bg-fill hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
          <div className="border-t border-hairline" />
          <button
            type="button"
            onClick={handleSignOut}
            className="block w-full px-3 py-2 text-left text-sm text-ink-2 hover:bg-fill hover:text-ink"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function NavIcon({ name, active }: { name: string; active: boolean }) {
  const strokeWidth = active ? 2.5 : 2;
  const props = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "Discover":
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    case "Map":
      return (
        <svg {...props}>
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
      );
    case "Lists":
      return (
        <svg {...props}>
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M3 6h.01" />
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
        </svg>
      );
    case "Log":
      return (
        <svg {...props}>
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case "Plans":
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "Sign In":
      return (
        <svg {...props}>
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
          <polyline points="10 17 15 12 10 7" />
          <line x1="15" y1="12" x2="3" y2="12" />
        </svg>
      );
    default:
      return null;
  }
}
