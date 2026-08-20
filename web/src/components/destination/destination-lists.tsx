import Link from "next/link";
import type { DestinationList } from "../../lib/actions/destinations";

/** The curated lists this destination belongs to — quiet link rows, name
 * over a mono count. */
export function DestinationLists({
  lists,
  className = "",
}: {
  lists: DestinationList[];
  className?: string;
}) {
  if (lists.length === 0) return null;

  return (
    <section className={className} aria-labelledby="destination-lists">
      <h2
        id="destination-lists"
        className="text-[11px] font-medium tracking-[0.1em] text-muted uppercase"
      >
        On lists
      </h2>
      <ul className="mt-4 space-y-3">
        {lists.map((list) => (
          <li key={list.id}>
            <Link href={`/lists/${list.id}`} className="group block">
              <span className="block truncate text-[15px] font-medium text-ink group-hover:underline">
                {list.name || "Unnamed list"}
              </span>
              <span className="mt-0.5 block text-[12px] text-muted">
                <span className="font-mono-num tabular-nums">
                  {list.destination_count.toLocaleString("en-US")}
                </span>{" "}
                destinations
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
