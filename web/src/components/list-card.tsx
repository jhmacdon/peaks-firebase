import { Card } from "./ui/card";
import type { ListRow } from "../lib/actions/lists";
import { listOwnerLabel, parseListDescription } from "../lib/list-content";

interface ListCardProps {
  list: ListRow;
  compact?: boolean;
}

export default function ListCard({ list, compact = false }: ListCardProps) {
  const ownerLabel = listOwnerLabel(list.owner);
  const { paragraphs, sourceUrl, sourceLabel } = parseListDescription(list.description);

  // Same filter-then-join meta line as the lists index row (and the detail
  // page's topline meta): year and organization first, falling back to
  // region, then the coarse owner label. This is what used to be a
  // standalone Badge — dropped in favor of carrying that signal here.
  const metaParts = [
    list.year_established ? `Est. ${list.year_established}` : null,
    list.organization,
  ].filter((part): part is string => Boolean(part));
  const metaLine = metaParts.length > 0 ? metaParts.join(" · ") : list.region || ownerLabel;

  return (
    <Card href={`/lists/${list.id}`} className="h-full">
      <div className="flex items-start gap-3">
        {list.thumbnails.length > 0 ? (
          <span className="flex shrink-0 -space-x-2">
            {list.thumbnails.map((thumbnail, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${list.id}-${index}`}
                src={thumbnail.url}
                alt=""
                className="h-9 w-9 rounded-full bg-fill object-cover ring-2 ring-page"
                style={{ objectPosition: `${thumbnail.focalX}% ${thumbnail.focalY}%` }}
              />
            ))}
          </span>
        ) : null}
        <span className="min-w-0">
          <span className="block text-base font-medium leading-tight text-ink">
            {list.name}
          </span>
          <span className="mt-1 block text-sm text-muted">{metaLine}</span>
        </span>
      </div>
      <div className="mt-3 text-sm text-muted">
        <span className="font-mono-num tabular-nums">
          {list.destination_count.toLocaleString("en-US")}
        </span>{" "}
        destination{list.destination_count === 1 ? "" : "s"}
        {list.completion_target < list.destination_count ? (
          <>
            {" · "}
            <span className="font-mono-num tabular-nums">
              {list.completion_target.toLocaleString("en-US")}
            </span>{" "}
            required
          </>
        ) : null}
      </div>
      {!compact && paragraphs.length > 0 && (
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink-2">
          {paragraphs.join(" ")}
        </p>
      )}
      {!compact && sourceUrl && sourceLabel && (
        // Plain text, not a nested link — the whole card is already one
        // link to the list detail page, where the real source link lives.
        <div className="mt-1 text-xs text-faint">Source: {sourceLabel}</div>
      )}
    </Card>
  );
}
