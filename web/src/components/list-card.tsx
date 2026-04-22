import Link from "next/link";
import type { ListRow } from "../lib/actions/lists";

interface ListCardProps {
  list: ListRow;
}

export default function ListCard({ list }: ListCardProps) {
  return (
    <Link
      href={`/lists/${list.id}`}
      className="group block rounded-3xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-blue-700"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold tracking-tight text-gray-950 transition-colors group-hover:text-blue-700 dark:text-gray-50 dark:group-hover:text-blue-300">
            {list.name}
          </div>
          {list.description && (
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
              {list.description}
            </p>
          )}
        </div>
        <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
          Open
        </span>
      </div>

      <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
        {list.destination_count} destination
        {list.destination_count === 1 ? "" : "s"}
      </div>
    </Link>
  );
}
