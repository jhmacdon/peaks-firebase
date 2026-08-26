"use client";

import Link from "next/link";
import { formatMilesValue } from "../../lib/destination-detail";
import { sessionActivityLabel } from "../../lib/session-track";
import { SectionHeading } from "../ui/section-heading";
import { useAreaPersonalization } from "./area-personalization";

export function AreaSessions({ className = "" }: { className?: string }) {
  const { activity } = useAreaPersonalization();

  if (!activity || activity.sessions.length === 0) return null;

  return (
    <section className={className} aria-labelledby="area-sessions">
      <div className="flex items-baseline justify-between gap-4">
        <SectionHeading>
          <span id="area-sessions">Your recent sessions</span>
        </SectionHeading>
        <span className="text-[13px] text-muted">
          {activity.visit_count.toLocaleString("en-US")} total
        </span>
      </div>
      <ul className="mt-4 grid gap-x-10 gap-y-4 md:grid-cols-2">
        {activity.sessions.map((session) => {
          const label =
            session.name ||
            (session.destinationNames.length > 0
              ? session.destinationNames.join(", ")
              : "Untitled session");
          const date = new Date(session.start_time).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          const distance =
            session.distance != null ? formatMilesValue(session.distance) : null;
          const meta = [
            sessionActivityLabel(session.activity_type),
            date,
            distance ? `${distance} mi` : null,
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <li key={session.id}>
              <Link href={`/log/${session.id}`} className="group block">
                <span className="block text-[15px] font-medium text-ink group-hover:underline">
                  {label}
                </span>
                <span className="mt-0.5 block text-[12px] text-muted">{meta}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
