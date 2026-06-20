import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import type { ListRow } from "../lib/actions/lists";

interface ListCardProps {
  list: ListRow;
}

export default function ListCard({ list }: ListCardProps) {
  const ownerLabel = list.owner === "peaks" ? "Peaks curated" : "Community list";
  const description =
    list.description || "A public checklist for planning, progress, and route research.";

  return (
    <Card href={`/lists/${list.id}`} className="h-full">
      <Badge tone="amber">{ownerLabel}</Badge>
      <div className="mt-2 text-base font-semibold leading-tight text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">
        {list.name}
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
        {description}
      </p>
      <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
        <span className="font-semibold text-gray-900 dark:text-white">
          {list.destination_count}
        </span>{" "}
        destination{list.destination_count === 1 ? "" : "s"}
      </div>
    </Card>
  );
}
