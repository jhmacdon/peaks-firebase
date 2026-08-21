"use client";

import { useEffect, useState } from "react";

/** The one interactive scrap of the coordinates row. Kept apart from the
 * row itself so the coordinates, which are catalog data, still arrive in
 * the server-rendered HTML. */
export function CopyCoordinates({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false)
        );
      }}
      className="text-[13px] font-medium text-accent-text hover:underline"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
