"use client";

import { useState, useRef, useEffect } from "react";
import { getUser, type UserInfo } from "@/lib/actions/users";

interface UserPopoverProps {
  uid: string;
}

export default function UserPopover({ uid }: UserPopoverProps) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleClick = async () => {
    setOpen((prev) => !prev);
    if (!fetched) {
      setLoading(true);
      const result = await getUser(uid);
      setUser(result);
      setFetched(true);
      setLoading(false);
    }
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={handleClick}
        className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer"
      >
        {uid.slice(0, 8)}…
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-lg z-50 p-4">
          {loading ? (
            <div className="text-sm text-gray-500 text-center py-2">
              Loading…
            </div>
          ) : user ? (
            <div className="flex items-center gap-3">
              {user.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.photoURL}
                  alt=""
                  className="w-10 h-10 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center shrink-0">
                  <span className="text-sm font-medium text-gray-500">
                    {(user.displayName || user.email || "?")[0].toUpperCase()}
                  </span>
                </div>
              )}
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">
                  {user.displayName || "No name"}
                </div>
                {user.email && (
                  <div className="text-xs text-gray-500 truncate">
                    {user.email}
                  </div>
                )}
                <div className="text-xs text-gray-400 font-mono mt-0.5">
                  {uid}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500 text-center py-2">
              User not found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
