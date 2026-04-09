"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/auth-context";
import { getProfile } from "../../../lib/actions/profile";
import type { UserProfile } from "../../../lib/actions/profile";
import Avatar from "../../../components/avatar";

export default function AccountPage() {
  const { user, signOut, getIdToken } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const token = await getIdToken();
      if (!token) return;
      const data = await getProfile(token);
      setProfile(data);
      setLoading(false);
    }
    load();
  }, [getIdToken]);

  const handleSignOut = async () => {
    await signOut();
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-semibold mb-6">Account</h1>
        <div className="text-gray-500 py-12 text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold mb-6">Account</h1>

      {/* Profile Card */}
      <div className="p-6 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 mb-6">
        <div className="flex items-center gap-4">
          <Avatar
            name={profile?.name || user?.displayName || null}
            avatarUrl={profile?.avatarUrl || null}
            size="lg"
          />
          <div className="min-w-0">
            <div className="text-lg font-semibold truncate">
              {profile?.name || user?.displayName || "No name set"}
            </div>
            <div className="text-sm text-gray-500 truncate">
              {profile?.email || user?.email || ""}
            </div>
            {profile?.createdAt && (
              <div className="text-xs text-gray-400 mt-1">
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
          className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
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
              className="text-gray-500"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <div>
              <div className="font-medium text-sm">Edit Profile</div>
              <div className="text-xs text-gray-500">
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
            className="text-gray-400"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>

        <Link
          href="/account/friends"
          className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
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
              className="text-gray-500"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <div>
              <div className="font-medium text-sm">Friends</div>
              <div className="text-xs text-gray-500">
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
            className="text-gray-400"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      </div>

      {/* Sign Out */}
      <button
        onClick={handleSignOut}
        className="w-full py-3 px-4 text-sm font-medium text-red-600 dark:text-red-400 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl hover:border-red-300 dark:hover:border-red-700 transition-colors"
      >
        Sign Out
      </button>
    </div>
  );
}
