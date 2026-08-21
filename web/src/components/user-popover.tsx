"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getUser, type UserInfo } from "../lib/actions/users";
import { useAuth } from "../lib/auth-context";
import { LOADING_LABEL } from "../lib/constants";

interface UserPopoverProps {
  uid: string;
}

type LoadStatus = "idle" | "loading" | "loaded" | "missing";

interface PopoverPosition {
  left: number;
  top: number;
}

export default function UserPopover({ uid }: UserPopoverProps) {
  // A changed uid is a different disclosure. Remounting the stateful body
  // prevents a recycled table row from flashing the last user's details.
  return <UserPopoverContent key={uid} uid={uid} />;
}

function UserPopoverContent({ uid }: UserPopoverProps) {
  const { getIdToken } = useAuth();
  const panelId = `${useId()}-user-popover`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const requestVersionRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;

    const gap = 8;
    const viewportInset = 8;
    const triggerRect = trigger.getBoundingClientRect();
    const panelWidth = Math.min(256, window.innerWidth - viewportInset * 2);
    const panelHeight = panelRef.current?.offsetHeight ?? 144;
    const left = Math.min(
      Math.max(viewportInset, triggerRect.right - panelWidth),
      window.innerWidth - panelWidth - viewportInset
    );
    const roomBelow = triggerRect.bottom + gap + panelHeight <= window.innerHeight - viewportInset;
    const top = roomBelow
      ? triggerRect.bottom + gap
      : Math.max(viewportInset, triggerRect.top - gap - panelHeight);

    setPosition((current) =>
      current?.left === left && current.top === top ? current : { left, top }
    );
  }, []);

  const loadUser = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current;
    setStatus("loading");
    try {
      const token = await getIdToken();
      const result = token ? await getUser(token, uid) : null;
      if (requestVersionRef.current !== requestVersion) return;
      setUser(result);
      setStatus(result ? "loaded" : "missing");
    } catch {
      if (requestVersionRef.current !== requestVersion) return;
      setUser(null);
      setStatus("missing");
    }
  }, [getIdToken, uid]);

  const handleClick = () => {
    if (open) {
      setOpen(false);
      return;
    }

    updatePosition();
    setOpen(true);
    if (status === "idle") void loadUser();
  };

  useEffect(() => {
    return () => {
      requestVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    updatePosition();

    const handlePointerOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleFocusOutside = (event: FocusEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerOutside);
    document.addEventListener("focusin", handleFocusOutside);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerOutside);
      document.removeEventListener("focusin", handleFocusOutside);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (open) updatePosition();
  }, [open, status, updatePosition]);

  const popover =
    open && position && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={`User ${uid}`}
            aria-modal="false"
            aria-busy={status === "loading"}
            className="fixed z-50 w-64 max-w-[calc(100vw-1rem)] rounded-media border border-border bg-page p-4 shadow-float"
            style={{ left: position.left, top: position.top }}
          >
            <div role="status" aria-live="polite" aria-atomic="true">
              {status === "loading" ? (
                <div className="py-2 text-center text-sm text-muted">
                  {LOADING_LABEL}
                </div>
              ) : user ? (
                <div className="flex items-center gap-3">
                  {user.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.photoURL}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fill">
                      <span className="text-sm font-medium text-muted">
                        {(user.displayName || user.email || "?")[0].toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">
                      {user.displayName || "No name"}
                    </div>
                    {user.email && (
                      <div className="truncate text-xs text-muted">
                        {user.email}
                      </div>
                    )}
                    <div className="mt-0.5 font-mono text-xs text-faint">
                      {uid}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-2 text-center text-sm text-muted">
                  User not found
                </div>
              )}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <span className="inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleClick}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={`View user ${uid}`}
        className="inline-block cursor-pointer rounded-ctl bg-fill px-2 py-0.5 font-mono text-xs font-medium text-ink-2 transition-colors hover:text-ink"
      >
        {uid.slice(0, 8)}…
      </button>
      {popover}
    </span>
  );
}
