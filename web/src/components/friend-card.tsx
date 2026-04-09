"use client";

import { useState } from "react";
import Avatar from "./avatar";
import type { Friend } from "../lib/actions/profile";

interface FriendCardProps {
  friend: Friend;
  onRemove: (id: string) => void;
}

export default function FriendCard({ friend, onRemove }: FriendCardProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <Avatar
        name={friend.friendName}
        avatarUrl={friend.friendAvatarUrl}
        size="md"
      />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">
          {friend.friendName || "Unknown"}
        </div>
        <div className="text-sm text-gray-500 truncate">
          {friend.friendEmail}
        </div>
        {friend.since && (
          <div className="text-xs text-gray-400 mt-0.5">
            Friends since{" "}
            {new Date(friend.since).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </div>
        )}
      </div>
      <div className="shrink-0">
        {confirming ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onRemove(friend.id)}
              className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:text-red-600 hover:border-red-300 dark:hover:text-red-400 dark:hover:border-red-700 transition-colors"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
