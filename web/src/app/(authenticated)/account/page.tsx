"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/auth-context";
import { getProfile } from "../../../lib/actions/profile";
import type { UserProfile } from "../../../lib/actions/profile";
import { LOADING_LABEL } from "../../../lib/constants";
import Avatar from "../../../components/avatar";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";

const LINKS = [
  {
    href: "/account/profile",
    label: "Profile",
    description: "Your name and avatar",
  },
  {
    href: "/saved",
    label: "Saved",
    description: "Peaks and places you want to visit",
  },
  {
    href: "/account/friends",
    label: "Friends",
    description: "Friends and invites",
  },
];

/** One tidy page: who you are, where to go, and the way out.
 *
 * Each destination used to be its own bordered card, which put a box beside
 * a box beside a box (design-tokens.md law 1). They share one container now,
 * separated by hairlines — the shape the detail pages already use for a list
 * of rows. Sign out is a plain outline button, not a filled red one: it is
 * reversible, so it doesn't earn destructive weight.
 */
export default function AccountPage() {
  const { user, signOut, getIdToken } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Sign in to see your account.");
          return;
        }
        const data = await getProfile(token);
        setProfile(data);
      } catch {
        setError("Couldn’t load your account. Try again.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [getIdToken]);

  const name = profile?.name || user?.displayName || "No name set";
  const email = profile?.email || user?.email || "";

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-medium text-ink">Account</h1>

      {loading ? (
        <EmptyState className="mt-6">{LOADING_LABEL}</EmptyState>
      ) : error ? (
        <p role="alert" className="mt-6 text-sm text-alert">
          {error}
        </p>
      ) : (
        <>
          <div className="mt-8 flex items-center gap-4">
            <Avatar
              name={profile?.name || user?.displayName || null}
              avatarUrl={profile?.avatarUrl || null}
              size="lg"
            />
            <div className="min-w-0">
              <p className="truncate text-lg font-medium text-ink">{name}</p>
              {email ? (
                <p className="truncate text-sm text-muted">{email}</p>
              ) : null}
              {profile?.createdAt ? (
                <p className="mt-0.5 text-xs text-faint">
                  Member since{" "}
                  {new Date(profile.createdAt).toLocaleDateString("en-US", {
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              ) : null}
            </div>
          </div>

          <nav
            className="mt-10 divide-y divide-hairline overflow-hidden rounded-media border border-border"
            aria-label="Account sections"
          >
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-fill"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">
                    {link.label}
                  </span>
                  <span className="block text-xs text-muted">
                    {link.description}
                  </span>
                </span>
                <span aria-hidden="true" className="shrink-0 text-faint">
                  ›
                </span>
              </Link>
            ))}
          </nav>

          <div className="mt-10">
            <Button variant="secondary" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
