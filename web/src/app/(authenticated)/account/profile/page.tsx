"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "../../../../lib/auth-context";
import { getProfile, updateProfile } from "../../../../lib/actions/profile";
import { uploadAvatar } from "../../../../lib/storage";
import type { UserProfile } from "../../../../lib/actions/profile";
import { LOADING_LABEL } from "../../../../lib/constants";
import Avatar from "../../../../components/avatar";
import Link from "next/link";
import { Button } from "../../../../components/ui/button";
import { Input, Label } from "../../../../components/ui/field";

export default function EditProfilePage() {
  const { user, getIdToken } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
      setLoading(true);
      setLoadError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setLoadError("Sign in to edit your profile.");
          return;
        }
        const data = await getProfile(token);
        if (data) {
          setProfile(data);
          setName(data.name);
          setAvatarUrl(data.avatarUrl);
        }
      } catch {
        setLoadError("Couldn’t load your profile. Try again.");
      } finally {
        setLoading(false);
      }
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
        <h1 className="text-2xl font-semibold mb-6 text-ink">Edit Profile</h1>
        <div className="text-muted py-12 text-center">{LOADING_LABEL}</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-semibold mb-6 text-ink">Edit Profile</h1>
        <p role="alert" className="text-alert py-12 text-center text-sm">
          {loadError}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/account" className="text-faint hover:text-ink-2 transition-colors">
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
        <h1 className="text-2xl font-semibold text-ink">Edit Profile</h1>
      </div>

      {/* Avatar Section */}
      <div className="p-6 rounded-media border border-border bg-surface mb-6">
        <div className="flex items-center gap-4">
          <Avatar name={name || null} avatarUrl={avatarUrl} size="lg" />
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Change Avatar"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              className="hidden"
            />
            <p className="text-xs text-faint mt-1.5">JPG, PNG. Max 5MB.</p>
          </div>
        </div>
      </div>

      {/* Name Form */}
      <form
        onSubmit={handleSave}
        className="p-6 rounded-media border border-border bg-surface"
      >
        <div className="mb-4">
          <Label>Name</Label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </div>

        <div className="mb-4">
          <Label>Email</Label>
          <Input
            type="email"
            value={profile?.email || user?.email || ""}
            disabled
          />
          <p className="text-xs text-faint mt-1">
            Email cannot be changed here.
          </p>
        </div>

        {message && (
          <div
            role="status"
            className={`text-sm mb-4 ${
              message.type === "success" ? "text-success" : "text-alert"
            }`}
          >
            {message.text}
          </div>
        )}

        <Button type="submit" disabled={saving} className="w-full">
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </form>
    </div>
  );
}
