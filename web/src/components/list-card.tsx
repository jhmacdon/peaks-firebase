import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import type { ListRow } from "../lib/actions/lists";
import { parseListDescription } from "../lib/list-content";

interface ListCardProps {
  list: ListRow;
}

export default function ListCard({ list }: ListCardProps) {
  const ownerLabel = list.owner === "peaks" ? "Peaks curated" : "Community list";
  const { paragraphs, sourceUrl, sourceLabel } = parseListDescription(list.description);

  return (
    <Card href={`/lists/${list.id}`} className="h-full">
      <div className="text-base font-medium leading-tight text-ink">{list.name}</div>
      <div className="mt-1 text-sm text-muted">
        <span className="font-mono-num tabular-nums">
          {list.destination_count.toLocaleString("en-US")}
        </span>{" "}
        destination{list.destination_count === 1 ? "" : "s"}
      </div>
      {paragraphs.length > 0 && (
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink-2">
          {paragraphs.join(" ")}
        </p>
      )}
      {sourceUrl && sourceLabel && (
        // Plain text, not a nested link — the whole card is already one
        // link to the list detail page, where the real source link lives.
        <div className="mt-1 text-xs text-faint">Source: {sourceLabel}</div>
      )}
      <div className="mt-3">
        <Badge>{ownerLabel}</Badge>
      </div>
    </Card>
  );
}
