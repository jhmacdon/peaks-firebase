import Link from "next/link";
import { CatalogMedia } from "./catalog-media";
import type { ListRow } from "../lib/actions/lists";
import { listOwnerLabel, parseListDescription } from "../lib/list-content";

export default function ListCard({ list, compact = false }: { list: ListRow; compact?: boolean }) {
  const { paragraphs } = parseListDescription(list.description);
  const cover = list.thumbnails[0];
  return (
    <article className="h-full overflow-hidden rounded-media border border-border bg-page">
    <Link href={`/lists/${list.id}`} prefetch={false} className="group block transition-colors hover:bg-fill">
      <CatalogMedia src={cover?.url} focalX={cover?.focalX} focalY={cover?.focalY} kind="Peak list" />
      <div className="p-4">
        <h3 className="text-lg font-semibold leading-snug text-ink">{list.name}</h3>
        <p className="mt-1 text-sm text-muted">{list.region || list.organization || listOwnerLabel(list.owner)}</p>
        <p className="mt-2 text-sm text-muted">{list.destination_count.toLocaleString("en-US")} places{list.completion_target < list.destination_count ? ` · ${list.completion_target.toLocaleString("en-US")} required` : ""}</p>
        {!compact && paragraphs.length > 0 && <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink-2">{paragraphs.join(" ")}</p>}
      </div>
    </Link>
    {cover?.attribution && <p className="px-4 pb-3 text-xs leading-relaxed text-muted">Photo: {cover.attributionUrl ? <a href={cover.attributionUrl} target="_blank" rel="noopener noreferrer" className="underline">{cover.attribution}</a> : cover.attribution}</p>}
    </article>
  );
}
