"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../../lib/auth-context";
import {
  getFriends,
  createFriendInvite,
  acceptFriendInvite,
  removeFriend,
} from "../../../../lib/actions/profile";
import type { Friend } from "../../../../lib/actions/profile";
import FriendCard from "../../../../components/friend-card";

export default function FriendsPage() {
  const { getIdToken } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite state
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copied, setCopied] = useState(false);

  // Accept invite state
  const [codeInput, setCodeInput] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [acceptMessage, setAcceptMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    loadFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFriends() {
    setLoading(true);
    const token = await getIdToken();
    if (!token) return;
    const data = await getFriends(token);
    setFriends(data);
    setLoading(false);
  }

  const handleGenerateInvite = async () => {
    setGeneratingInvite(true);
    const token = await getIdToken();
    if (!token) return;
    const result = await createFriendInvite(token);
    if (result) {
      setInviteCode(result.inviteCode);
    }
    setGeneratingInvite(false);
  };

  const handleCopyInvite = async () => {
    if (!inviteCode) return;
    const link = `${window.location.origin}/account/friends?invite=${inviteCode}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeInput.trim()) return;

    setAccepting(true);
    setAcceptMessage(null);
    const token = await getIdToken();
    if (!token) return;

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
    setAccepting(false);
  };

  const handleRemoveFriend = async (friendDocId: string) => {
    const token = await getIdToken();
    if (!token) return;

    const result = await removeFriend(token, friendDocId);
    if (result.success) {
      setFriends((prev) => prev.filter((f) => f.id !== friendDocId));
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
        <h1 className="text-2xl font-semibold">Friends</h1>
      </div>

      {/* Add Friend Section */}
      <div className="p-6 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 mb-6">
        <h2 className="text-sm font-semibold mb-4">Add a Friend</h2>

        {/* Generate Invite Link */}
        <div className="mb-5">
          <p className="text-xs text-gray-500 mb-2">
            Generate an invite link to share with a friend:
          </p>
          {inviteCode ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={`${typeof window !== "undefined" ? window.location.origin : ""}/account/friends?invite=${inviteCode}`}
                className="flex-1 px-3 py-2 text-xs border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 truncate"
              />
              <button
                onClick={handleCopyInvite}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shrink-0"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          ) : (
            <button
              onClick={handleGenerateInvite}
              disabled={generatingInvite}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {generatingInvite ? "Generating..." : "Generate Invite Link"}
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="relative mb-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200 dark:border-gray-700" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white dark:bg-gray-900 px-2 text-gray-500">
              Or
            </span>
          </div>
        </div>

        {/* Enter Invite Code */}
        <form onSubmit={handleAcceptInvite}>
          <p className="text-xs text-gray-500 mb-2">
            Enter an invite code you received:
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="Paste invite code or link"
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <button
              type="submit"
              disabled={accepting || !codeInput.trim()}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shrink-0"
            >
              {accepting ? "Accepting..." : "Accept"}
            </button>
          </div>
          {acceptMessage && (
            <div
              className={`text-sm mt-2 ${
                acceptMessage.type === "success"
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {acceptMessage.text}
            </div>
          )}
        </form>
      </div>

      {/* Friends List */}
      <div>
        <h2 className="text-sm font-semibold mb-3 text-gray-500">
          Your Friends ({friends.length})
        </h2>

        {loading ? (
          <div className="text-gray-500 py-12 text-center">Loading...</div>
        ) : friends.length === 0 ? (
          <div className="text-gray-500 py-12 text-center text-sm">
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
