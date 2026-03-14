"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { getProfile, updateProfile } from "@/lib/actions/profile";
import { uploadAvatar } from "@/lib/storage";
import type { UserProfile } from "@/lib/actions/profile";
import Avatar from "@/components/avatar";
import Link from "next/link";

export default function EditProfilePage() {
  const { user, getIdToken } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      const token = await getIdToken();
      if (!token) return;
      const data = await getProfile(token);
      if (data) {
        setProfile(data);
        setName(data.name);
        setAvatarUrl(data.avatarUrl);
      }
      setLoading(false);
    }
    load();
  }, [getIdToken]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    setMessage(null);
    try {
      const url = await uploadAvatar(user.uid, file);
      setAvatarUrl(url);

      // Also save to profile immediately
      const token = await getIdToken();
      if (token) {
        await updateProfile(token, { avatarUrl: url });
      }
      setMessage({ type: "success", text: "Avatar updated" });
    } catch {
      setMessage({ type: "error", text: "Failed to upload avatar" });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const token = await getIdToken();
    if (!token) {
      setMessage({ type: "error", text: "Not authenticated" });
      setSaving(false);
      return;
    }

    const result = await updateProfile(token, { name });
    if (result.success) {
      setMessage({ type: "success", text: "Profile updated" });
      setProfile((prev) => (prev ? { ...prev, name } : prev));
    } else {
      setMessage({ type: "error", text: "Failed to update profile" });
    }

    setSaving(false);
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-semibold mb-6">Edit Profile</h1>
        <div className="text-gray-500 py-12 text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/account"
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <h1 className="text-2xl font-semibold">Edit Profile</h1>
      </div>

      {/* Avatar Section */}
      <div className="p-6 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 mb-6">
        <div className="flex items-center gap-4">
          <Avatar name={name || null} avatarUrl={avatarUrl} size="lg" />
          <div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-4 py-2 text-sm font-medium bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {uploading ? "Uploading..." : "Change Avatar"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              className="hidden"
            />
            <p className="text-xs text-gray-400 mt-1.5">JPG, PNG. Max 5MB.</p>
          </div>
        </div>
      </div>

      {/* Name Form */}
      <form
        onSubmit={handleSave}
        className="p-6 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800"
      >
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Your name"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Email</label>
          <input
            type="email"
            value={profile?.email || user?.email || ""}
            disabled
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-500 cursor-not-allowed"
          />
          <p className="text-xs text-gray-400 mt-1">
            Email cannot be changed here.
          </p>
        </div>

        {message && (
          <div
            className={`text-sm mb-4 ${
              message.type === "success"
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {message.text}
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
