"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminBrand } from "./admin/admin-brand";
import { AdminIcon } from "./admin/admin-icons";
import { useAuth } from "../lib/auth-context";
import { ADMIN_NAV_ITEMS, isAdminPathActive } from "../lib/admin-navigation";

function NavLink({
  href,
  label,
  description,
  icon,
  active,
}: (typeof ADMIN_NAV_ITEMS)[number] & { active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-3 rounded-ctl px-3 py-2.5 transition-colors ${
        active ? "bg-fill text-ink" : "text-ink-2 hover:bg-fill hover:text-ink"
      }`}
    >
      {active ? (
        <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" aria-hidden />
      ) : null}
      <AdminIcon name={icon} className={active ? "text-accent-text" : "text-muted"} />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block truncate text-[12px] text-muted">{description}</span>
      </span>
    </Link>
  );
}

export default function AdminNav() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const mobileNavRef = useRef<HTMLElement>(null);
  const activeMobileLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const nav = mobileNavRef.current;
      const activeLink = activeMobileLinkRef.current;
      if (!nav || !activeLink) return;

      const centeredLeft =
        activeLink.offsetLeft - (nav.clientWidth - activeLink.clientWidth) / 2;
      nav.scrollTo({ left: Math.max(0, centeredLeft), behavior: "auto" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
        <div className="px-6 py-6">
          <AdminBrand />
        </div>

        <nav aria-label="Admin sections" className="flex-1 space-y-1 px-3 py-4">
          {ADMIN_NAV_ITEMS.map((item) => (
            <NavLink key={item.href} {...item} active={isAdminPathActive(pathname, item.href)} />
          ))}
        </nav>

        <div className="space-y-4 border-t border-hairline px-5 py-5">
          <Link
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center gap-2 text-sm text-ink-2 transition-colors hover:text-ink hover:underline"
          >
            View public site
            <AdminIcon name="external" size={15} />
          </Link>
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-[12px] text-muted">{user?.email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label="Sign out"
              title="Sign out"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ctl text-muted transition-colors hover:bg-fill hover:text-ink"
            >
              <AdminIcon name="logout" size={16} />
            </button>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-40 border-b border-border bg-page lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <AdminBrand />
          <div className="flex items-center gap-2">
            <Link
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View public site"
              className="flex h-10 w-10 items-center justify-center rounded-ctl text-muted transition-colors hover:bg-fill hover:text-ink"
            >
              <AdminIcon name="external" size={16} />
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label="Sign out"
              className="flex h-10 w-10 items-center justify-center rounded-ctl text-muted transition-colors hover:bg-fill hover:text-ink"
            >
              <AdminIcon name="logout" size={16} />
            </button>
          </div>
        </div>
        <nav
          ref={mobileNavRef}
          aria-label="Admin sections"
          className="flex gap-5 overflow-x-auto border-t border-hairline px-4"
        >
          {ADMIN_NAV_ITEMS.map((item) => {
            const active = isAdminPathActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                ref={active ? activeMobileLinkRef : undefined}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-10 shrink-0 items-center border-b-2 text-[13px] font-medium transition-colors ${
                  active
                    ? "border-accent text-accent-text"
                    : "border-transparent text-ink-2 hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
