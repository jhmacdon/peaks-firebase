"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../../lib/auth-context";
import { resolveShareUrl } from "../../../../components/share-link-utils";
import {
  getFriends,
  createFriendInvite,
  acceptFriendInvite,
  removeFriend,
} from "../../../../lib/actions/profile";
import type { Friend } from "../../../../lib/actions/profile";
import { LOADING_LABEL } from "../../../../lib/constants";
import FriendCard from "../../../../components/friend-card";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/field";

export default function FriendsPage() {
  const { getIdToken } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Invite state
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Accept invite state
  const [codeInput, setCodeInput] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [acceptMessage, setAcceptMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Remove friend state
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    loadFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFriends() {
    setLoading(true);
    setLoadError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setLoadError("Sign in to see your friends.");
        return;
      }
      const data = await getFriends(token);
      setFriends(data);
    } catch {
      setLoadError("Couldn’t load your friends. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const handleGenerateInvite = async () => {
    setGeneratingInvite(true);
    setInviteError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setInviteError("Sign in again to generate an invite.");
        return;
      }
      const result = await createFriendInvite(token);
      if (result) {
        setInviteCode(result.inviteCode);
      } else {
        setInviteError("Couldn’t generate an invite link. Try again.");
      }
    } catch {
      setInviteError("Couldn’t generate an invite link. Try again.");
    } finally {
      setGeneratingInvite(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!inviteCode) return;
    const link = resolveShareUrl(
      `/account/friends?invite=${encodeURIComponent(inviteCode)}`
    );
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeInput.trim()) return;

    setAccepting(true);
    setAcceptMessage(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setAcceptMessage({ type: "error", text: "Sign in again to accept an invite." });
        return;
      }

      const result = await acceptFriendInvite(token, codeInput.trim());
      if (result.success) {
        setAcceptMessage({ type: "success", text: "Friend added!" });
        setCodeInput("");
        loadFriends();
      } else {
        setAcceptMessage({
          type: "error",
          text: result.error || "Failed to accept invite",
        });
      }
    } catch {
      setAcceptMessage({ type: "error", text: "Failed to accept invite" });
    } finally {
      setAccepting(false);
    }
  };

  const handleRemoveFriend = async (friendDocId: string) => {
    setRemoveError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setRemoveError("Sign in again to remove a friend.");
        return;
      }

      const result = await removeFriend(token, friendDocId);
      if (result.success) {
        setFriends((prev) => prev.filter((f) => f.id !== friendDocId));
      } else {
        setRemoveError("Couldn’t remove that friend. Try again.");
      }
    } catch {
      setRemoveError("Couldn’t remove that friend. Try again.");
    }
  };

  // Check URL for invite code on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlInvite = params.get("invite");
    if (urlInvite) {
      setCodeInput(urlInvite);
    }
  }, []);

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
        <h1 className="text-2xl font-semibold text-ink">Friends</h1>
      </div>

      {/* Add Friend Section */}
      <div className="p-6 rounded-media border border-border bg-surface mb-6">
        <h2 className="text-sm font-semibold mb-4 text-ink">Add a Friend</h2>

        {/* Generate Invite Link */}
        <div className="mb-5">
          <p className="text-xs text-muted mb-2">
            Generate an invite link to share with a friend:
          </p>
          {inviteCode ? (
            <div className="flex items-center gap-2">
              <Input
                type="text"
                readOnly
                value={resolveShareUrl(
                  `/account/friends?invite=${encodeURIComponent(inviteCode)}`
                )}
                className="flex-1 text-xs text-ink-2 truncate"
              />
              <Button
                onClick={handleCopyInvite}
                variant="secondary"
                size="sm"
                className="shrink-0"
              >
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
          ) : (
            <Button onClick={handleGenerateInvite} disabled={generatingInvite}>
              {generatingInvite ? "Generating…" : "Generate Invite Link"}
            </Button>
          )}
          {inviteError && (
            <p role="alert" className="mt-2 text-sm text-alert">
              {inviteError}
            </p>
          )}
        </div>

        {/* Divider */}
        <div className="relative mb-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-hairline" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-surface px-2 text-muted">Or</span>
          </div>
        </div>

        {/* Enter Invite Code */}
        <form onSubmit={handleAcceptInvite}>
          <p className="text-xs text-muted mb-2">
            Enter an invite code you received:
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="Paste invite code or link"
              className="flex-1"
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={accepting || !codeInput.trim()}
              size="sm"
              className="shrink-0"
            >
              {accepting ? "Accepting…" : "Accept"}
            </Button>
          </div>
          {acceptMessage && (
            <div
              role="status"
              className={`text-sm mt-2 ${
                acceptMessage.type === "success" ? "text-success" : "text-alert"
              }`}
            >
              {acceptMessage.text}
            </div>
          )}
        </form>
      </div>

      {/* Friends List */}
      <div>
        <h2 className="text-sm font-semibold mb-3 text-muted">
          Your Friends ({friends.length})
        </h2>

        {removeError && (
          <p role="alert" className="mb-3 text-sm text-alert">
            {removeError}
          </p>
        )}

        {loading ? (
          <div className="text-muted py-12 text-center">{LOADING_LABEL}</div>
        ) : loadError ? (
          <p role="alert" className="text-alert py-12 text-center text-sm">
            {loadError}
          </p>
        ) : friends.length === 0 ? (
          <div className="text-muted py-12 text-center text-sm">
            No friends yet. Share an invite link to get started!
          </div>
        ) : (
          <div className="space-y-3">
            {friends.map((friend) => (
              <FriendCard
                key={friend.id}
                friend={friend}
                onRemove={handleRemoveFriend}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
