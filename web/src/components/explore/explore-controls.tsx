"use client";

import type { ReactNode } from "react";
import {
  CrosshairIcon,
  LayersIcon,
  MinusIcon,
  PlusIcon,
  Spinner,
} from "./explore-icons";

/**
 * The map's control cluster: 44px circles down the right edge, page-coloured
 * with a hairline and the one float shadow (design-tokens.md — floating
 * chrome is exactly what shadow-float is for). 44px is the touch-target
 * floor; the map had no zoom controls at all before this.
 */
export function ExploreControls({
  onZoomIn,
  onZoomOut,
  onLocate,
  locating,
  basemap,
  onToggleBasemap,
  className = "",
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onLocate: () => void;
  locating: boolean;
  basemap: "topo" | "satellite";
  onToggleBasemap: () => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className}`.trim()}>
      <ControlButton label="Zoom in" onClick={onZoomIn}>
        <PlusIcon />
      </ControlButton>
      <ControlButton label="Zoom out" onClick={onZoomOut}>
        <MinusIcon />
      </ControlButton>
      <ControlButton
        label={locating ? "Finding you" : "Show my location"}
        onClick={onLocate}
      >
        {locating ? <Spinner className="h-[18px] w-[18px]" /> : <CrosshairIcon />}
      </ControlButton>
      <ControlButton
        label={
          basemap === "topo" ? "Switch to satellite" : "Switch to topographic"
        }
        onClick={onToggleBasemap}
      >
        <LayersIcon />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-page text-ink-2 shadow-float transition-colors hover:text-ink"
    >
      {children}
    </button>
  );
}
