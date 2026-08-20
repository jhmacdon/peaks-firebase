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
      <Badge tone="amber">{ownerLabel}</Badge>
      <div className="mt-2 text-base font-semibold leading-tight text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">
        {list.name}
      </div>
      {paragraphs.length > 0 && (
        <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
          {paragraphs.join(" ")}
        </p>
      )}
      {sourceUrl && sourceLabel && (
        // Plain text, not a nested link — the whole card is already one
        // link to the list detail page, where the real source link lives.
        <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          Source: {sourceLabel}
        </div>
      )}
      <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
        <span className="font-semibold text-gray-900 dark:text-white">
          {list.destination_count}
        </span>{" "}
        destination{list.destination_count === 1 ? "" : "s"}
      </div>
    </Card>
  );
}
