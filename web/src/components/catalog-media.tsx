"use client";

import { satelliteThumbnailUrl } from "../lib/satellite-thumbnail";
import Image from "next/image";
import { useState } from "react";

/** Shared browse media. Missing photos keep the same layout without inventing a place image. */
export function CatalogMedia({ src, focalX = 50, focalY = 50, kind = "Place guide", lat, lng }: {
  src?: string | null;
  focalX?: number | null;
  focalY?: number | null;
  kind?: string;
  lat?: number | null;
  lng?: number | null;
}) {
  const satellite = !src ? satelliteThumbnailUrl(lat ?? null, lng ?? null, 640) : null;
  src = src || satellite;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const optimized = Boolean(src?.startsWith("/") || src?.startsWith("https://firebasestorage.googleapis.com/") || src?.startsWith("https://storage.googleapis.com/"));
  return (
    <div className="relative aspect-[16/10] overflow-hidden bg-fill">
      {src && failedSource !== src ? (
        <Image src={src} alt="" fill sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw" unoptimized={!optimized}
          className="object-cover transition-opacity group-hover:opacity-90"
          style={{ objectPosition: `${focalX ?? 50}% ${focalY ?? 50}%` }}
          onError={() => setFailedSource(src)} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
          <svg width="72" height="48" viewBox="0 0 72 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 42 26 8l14 20 9-12 20 26H3Z"/><path d="m17 21 9 4 7-6M41 27l8 4 6-6"/>
          </svg>
          <span className="text-sm">{kind} · No photo yet</span>
        </div>
      )}
      {satellite && failedSource !== src && <span className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 text-xs text-white">Satellite · © Esri, Maxar, Earthstar Geographics</span>}
    </div>
  );
}
