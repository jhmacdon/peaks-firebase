"use client";

import { useState } from "react";
import Avatar from "./avatar";
import type { Friend } from "../lib/actions/profile";
import { Button } from "./ui/button";

interface FriendCardProps {
  friend: Friend;
  onRemove: (id: string) => void;
}

export default function FriendCard({ friend, onRemove }: FriendCardProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex items-center gap-4 p-4 rounded-media border border-border bg-surface">
      <Avatar
        name={friend.friendName}
        avatarUrl={friend.friendAvatarUrl}
        size="md"
      />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate text-ink">
          {friend.friendName || "Unknown"}
        </div>
        <div className="text-sm text-muted truncate">
          {friend.friendEmail}
        </div>
        {friend.since && (
          <div className="text-xs text-faint mt-0.5">
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
            <Button variant="danger" size="sm" onClick={() => onRemove(friend.id)}>
              Confirm
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
