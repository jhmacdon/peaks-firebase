"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "../../../../lib/auth-context";
import { getProfile, updateProfile } from "../../../../lib/actions/profile";
import { uploadAvatar } from "../../../../lib/storage";
import { maybeDownscaleImage } from "../../../../lib/image-downscale";
import { AVATAR_UPLOAD_LIMITS, validateImageFile } from "../../../../lib/image-upload";
import type { UserProfile } from "../../../../lib/actions/profile";
import { LOADING_LABEL } from "../../../../lib/constants";
import Avatar from "../../../../components/avatar";
import Link from "next/link";
import { Button } from "../../../../components/ui/button";
import { Input, Label } from "../../../../components/ui/field";
import { EmptyState } from "../../../../components/ui/empty-state";

const AVATAR_MAX_MB = AVATAR_UPLOAD_LIMITS.maxBytes / (1024 * 1024);

export default function EditProfilePage() {
  const { user, getIdToken } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
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
    e.target.value = ""; // allow re-selecting the same file after an error
    if (!file || !user) return;

    const validation = validateImageFile(file, AVATAR_UPLOAD_LIMITS);
    if (!validation.ok) {
      setMessage({ type: "error", text: validation.error });
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setMessage(null);
    try {
      const { blob, contentType } = await maybeDownscaleImage(file);
      const url = await uploadAvatar(user.uid, blob, contentType, (fraction) =>
        setUploadProgress(Math.round(fraction * 100))
      );
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

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <nav className="flex items-center gap-1.5 text-sm text-muted">
        <Link href="/account" className="hover:text-ink hover:underline">
          Account
        </Link>
        <span aria-hidden>›</span>
        <span className="text-ink-2">Profile</span>
      </nav>
      <h1 className="mt-3 text-2xl font-medium text-ink">Profile</h1>

      {loading ? (
        <EmptyState className="mt-6">{LOADING_LABEL}</EmptyState>
      ) : loadError ? (
        <p role="alert" className="mt-6 text-sm text-alert">
          {loadError}
        </p>
      ) : (
        <>
          {/* Avatar and the form are one section, not two stacked cards —
              they are the same act of editing (design-tokens.md law 1). */}
          <form onSubmit={handleSave} className="mt-8">
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
                  {uploading ? `Uploading… ${uploadProgress}%` : "Change avatar"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
                <p className="mt-1.5 text-xs text-faint">
                  {AVATAR_UPLOAD_LIMITS.label}, up to {AVATAR_MAX_MB}MB.
                </p>
              </div>
            </div>

            <div className="mt-8">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>

            <div className="mt-5">
              <Label htmlFor="profile-email">Email</Label>
              <Input
                id="profile-email"
                type="email"
                value={profile?.email || user?.email || ""}
                disabled
              />
              <p className="mt-1.5 text-xs text-faint">
                Email can’t be changed here.
              </p>
            </div>

            {message && (
              <p
                role="status"
                className={`mt-5 text-sm ${
                  message.type === "success" ? "text-success" : "text-alert"
                }`}
              >
                {message.text}
              </p>
            )}

            <div className="mt-8">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
