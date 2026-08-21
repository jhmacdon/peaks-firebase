"use client";

import { useEffect, useState, useCallback } from "react";
import { getUsers, type UserInfo } from "../lib/actions/users";
import { useAuth } from "../lib/auth-context";
import Avatar from "./avatar";

interface PartyListProps {
  partyIds: string[];
}

export default function PartyList({ partyIds }: PartyListProps) {
  const [members, setMembers] = useState<UserInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { getIdToken } = useAuth();

  const loadMembers = useCallback(
    async (ids: string[]) => {
      const token = await getIdToken();
      if (!token) return [];
      return getUsers(token, ids);
    },
    [getIdToken]
  );

  // Firebase uids never contain commas, so the joined string is a stable
  // primitive effect dependency (arrays re-trigger on every new reference).
  const partyKey = partyIds.join(",");

  useEffect(() => {
    if (partyKey === "") return;

    let cancelled = false;

    loadMembers(partyKey.split(","))
      .then((result) => {
        if (!cancelled) {
          setMembers(result);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMembers([]);
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [partyKey, loadMembers]);

  if (partyIds.length === 0) {
    return <div className="text-sm text-muted">No party members yet</div>;
  }

  if (!loaded) {
    return <div className="text-sm text-muted">Loading members...</div>;
  }

  if (members.length === 0) {
    return <div className="text-sm text-muted">No party members found</div>;
  }

  return (
    <ul className="divide-y divide-hairline">
      {members.map((member) => (
        <li key={member.uid} className="flex items-center gap-3 py-2">
          <Avatar
            name={member.displayName || member.email}
            avatarUrl={member.photoURL}
            size="sm"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">
              {member.displayName || "Unknown"}
            </div>
            {member.email && (
              <div className="truncate text-xs text-muted">{member.email}</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
