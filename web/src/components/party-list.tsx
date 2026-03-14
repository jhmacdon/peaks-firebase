"use client";

import { useEffect, useState, useCallback } from "react";
import { getUser, type UserInfo } from "@/lib/actions/users";

interface PartyListProps {
  partyIds: string[];
}

export default function PartyList({ partyIds }: PartyListProps) {
  const [members, setMembers] = useState<UserInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadMembers = useCallback(async (ids: string[]) => {
    const results = await Promise.all(ids.map((uid) => getUser(uid)));
    return results.filter((u): u is UserInfo => u !== null);
  }, []);

  useEffect(() => {
    if (partyIds.length === 0) return;

    let cancelled = false;

    loadMembers(partyIds).then((result) => {
      if (!cancelled) {
        setMembers(result);
        setLoaded(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [partyIds, loadMembers]);

  if (partyIds.length === 0) {
    return <div className="text-sm text-gray-500">No party members yet</div>;
  }

  if (!loaded) {
    return <div className="text-sm text-gray-500">Loading members...</div>;
  }

  if (members.length === 0) {
    return <div className="text-sm text-gray-500">No party members found</div>;
  }

  return (
    <div className="space-y-2">
      {members.map((member) => (
        <div
          key={member.uid}
          className="flex items-center gap-3 p-2 rounded-lg border border-gray-100 dark:border-gray-800"
        >
          {member.photoURL ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={member.photoURL}
              alt=""
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-950 flex items-center justify-center text-blue-600 dark:text-blue-400 text-sm font-medium">
              {(member.displayName || member.email || "?")[0].toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">
              {member.displayName || "Unknown"}
            </div>
            {member.email && (
              <div className="text-xs text-gray-500 truncate">
                {member.email}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
