"use client";

import dynamic from "next/dynamic";
import type { ReportMapProps } from "./report-map";

export type {
  ReportMapDestination,
  ReportMapProps,
  ReportMapRoute,
} from "./report-map";

const ReportMap = dynamic(() => import("./report-map"), {
  ssr: false,
  loading: () => (
    <div
      className="absolute inset-0 animate-pulse bg-fill"
      aria-label="Loading report map"
      role="status"
    />
  ),
});

export function ReportMapEmbed({ className, ...props }: ReportMapProps) {
  return (
    <div
      className={`relative overflow-hidden bg-fill ${
        className ??
        "h-[clamp(22rem,44vw,34rem)] min-h-[22rem] w-full rounded-media border border-border"
      }`.trim()}
    >
      <ReportMap {...props} className="h-full w-full" />
    </div>
  );
}

export default ReportMapEmbed;
