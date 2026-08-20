"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/auth-context";
import { getProfile } from "../../../lib/actions/profile";
import type { UserProfile } from "../../../lib/actions/profile";
import { LOADING_LABEL } from "../../../lib/constants";
import Avatar from "../../../components/avatar";
import { Button } from "../../../components/ui/button";

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

  const handleSignOut = async () => {
    await signOut();
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-semibold mb-6 text-ink">Account</h1>
        <div className="text-muted py-12 text-center">{LOADING_LABEL}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-semibold mb-6 text-ink">Account</h1>
        <p role="alert" className="text-alert py-12 text-center text-sm">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold mb-6 text-ink">Account</h1>

      {/* Profile Card */}
      <div className="p-6 rounded-media border border-border bg-surface mb-6">
        <div className="flex items-center gap-4">
          <Avatar
            name={profile?.name || user?.displayName || null}
            avatarUrl={profile?.avatarUrl || null}
            size="lg"
          />
          <div className="min-w-0">
            <div className="text-lg font-semibold truncate text-ink">
              {profile?.name || user?.displayName || "No name set"}
            </div>
            <div className="text-sm text-muted truncate">
              {profile?.email || user?.email || ""}
            </div>
            {profile?.createdAt && (
              <div className="text-xs text-faint mt-1">
                Member since{" "}
                {new Date(profile.createdAt).toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <div className="space-y-3 mb-8">
        <Link
          href="/account/profile"
          className="flex items-center justify-between p-4 rounded-media border border-border bg-surface hover:bg-fill transition-colors"
        >
          <div className="flex items-center gap-3">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <div>
              <div className="font-medium text-sm text-ink">Edit Profile</div>
              <div className="text-xs text-muted">
                Update your name and avatar
              </div>
            </div>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-faint"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>

        <Link
          href="/account/friends"
          className="flex items-center justify-between p-4 rounded-media border border-border bg-surface hover:bg-fill transition-colors"
        >
          <div className="flex items-center gap-3">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <div>
              <div className="font-medium text-sm text-ink">Friends</div>
              <div className="text-xs text-muted">
                Manage your friends and invites
              </div>
            </div>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-faint"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>

        <Link
          href="/saved"
          className="flex items-center justify-between p-4 rounded-media border border-border bg-surface hover:bg-fill transition-colors"
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-5 w-5 items-center justify-center text-lg leading-none text-muted"
            >
              ★
            </span>
            <div>
              <div className="font-medium text-sm text-ink">Saved destinations</div>
              <div className="text-xs text-muted">
                View your saved peaks and places
              </div>
            </div>
          </div>
          <span aria-hidden="true" className="text-faint">
            ›
          </span>
        </Link>
      </div>

      {/* Sign Out */}
      <Button onClick={handleSignOut} variant="danger" className="w-full">
        Sign Out
      </Button>
    </div>
  );
}
