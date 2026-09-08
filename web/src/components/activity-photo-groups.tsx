import Link from "next/link";
import type { ActivityPhotoGroup } from "../lib/activity-photos";
import { formatShortDate } from "../lib/destination-detail";
import { sessionActivityLabel } from "../lib/session-track";
import type { SessionActivityType } from "../lib/actions/sessions";
import { SectionHeading } from "./ui/section-heading";

export function ActivityPhotoGroups({ groups, id = "activity-photos" }: { groups: ActivityPhotoGroup[]; id?: string }) {
  if (!groups.length) return null;
  return (
    <section id={id} className="scroll-mt-24" aria-labelledby={`${id}-title`}>
      <SectionHeading><span id={`${id}-title`}>Photos from recent activities</span></SectionHeading>
      <div className="mt-5 space-y-7">
        {groups.map((group) => (
          <div key={group.reportId}>
            <Link href={`/reports/${group.reportId}`} className="font-medium text-ink hover:underline">{group.activityName}</Link>
            <p className="mt-1 text-sm text-muted">{formatShortDate(group.date)} · {sessionActivityLabel(group.activityType as SessionActivityType | null)} · {group.authorName}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {group.photos.map((photo) => (
                <figure key={photo.id}>
                  <a href={photo.url} target="_blank" rel="noopener noreferrer" aria-label={`Open full photo: ${photo.caption || group.activityName}`} className="block overflow-hidden rounded-media bg-fill">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.url} alt={photo.caption || `${group.activityName}, ${formatShortDate(group.date)}`} loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" />
                  </a>
                  <figcaption className="mt-2 text-sm leading-5 text-muted">{`${group.activityName} · ${formatShortDate(group.date)} · ${sessionActivityLabel(group.activityType as SessionActivityType | null)}`}{photo.caption ? <span className="mt-1 block">{photo.caption}</span> : null}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
