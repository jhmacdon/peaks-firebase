"use client";

import { useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./ui/button";
import { resolveShareUrl } from "./share-link-utils";

export function ShareLinkButton({
  url,
  title,
  text = `${title} on Peaks`,
  label = "Share",
  variant = "secondary",
  size = "md",
  className = "",
}: {
  url: string;
  title: string;
  text?: string;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const [status, setStatus] = useState<string | null>(null);

  async function share() {
    setStatus(null);
    const shareUrl = resolveShareUrl(url);

    try {
      if (navigator.share) {
        await navigator.share({ title, text, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setStatus("Link copied");
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setStatus("Could not share link");
    }
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <Button variant={variant} size={size} onClick={share}>
        {label}
      </Button>
      {status ? (
        <span role="status" className="text-xs text-muted">
          {status}
        </span>
      ) : null}
    </span>
  );
}
