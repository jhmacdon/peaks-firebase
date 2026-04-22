"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth-context";

const authenticatedNavItems = [
  { href: "/discover", label: "Discover" },
  { href: "/map", label: "Map" },
  { href: "/log", label: "Log" },
  { href: "/plans", label: "Plans" },
  { href: "/account", label: "Account" },
];

const guestNavItems = [
  { href: "/discover", label: "Discover" },
  { href: "/map", label: "Map" },
  { href: "/lists", label: "Lists" },
  { href: "/login", label: "Sign In" },
];

export default function AppNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const navItems = user ? authenticatedNavItems : guestNavItems;

  return (
    <>
      {/* Desktop top nav */}
      <header className="hidden md:block border-b border-gray-200 dark:border-gray-800 bg-white/90 backdrop-blur dark:bg-gray-900/90">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/discover" className="text-lg font-bold tracking-tight">
              Peaks
            </Link>
            <nav className="flex gap-1">
              {navItems.map((item) => {
                const isActive =
                  item.href === "/discover"
                    ? pathname === "/discover" || pathname === "/"
                    : item.href === "/login"
                      ? pathname === "/login" || pathname === "/register"
                      : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {user ? (
              <span className="text-sm text-gray-500">
                {user.displayName || user.email}
              </span>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
                >
                  Sign In
                </Link>
                <Link
                  href="/register"
                  className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  Create Account
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 safe-area-bottom">
        <div className="flex justify-around py-2">
          {navItems.map((item) => {
            const isActive =
              item.href === "/discover"
                ? pathname === "/discover" || pathname === "/"
                : item.href === "/login"
                  ? pathname === "/login" || pathname === "/register"
                  : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-0.5 px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                <NavIcon name={item.label} active={isActive} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

function NavIcon({ name, active }: { name: string; active: boolean }) {
  const color = active ? "currentColor" : "currentColor";
  const strokeWidth = active ? 2.5 : 2;

  switch (name) {
    case "Discover":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    case "Map":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
      );
    case "Log":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case "Lists":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M3 6h.01" />
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
        </svg>
      );
    case "Plans":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "Account":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    case "Sign In":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
          <polyline points="10 17 15 12 10 7" />
          <line x1="15" y1="12" x2="3" y2="12" />
        </svg>
      );
    default:
      return null;
  }
}
