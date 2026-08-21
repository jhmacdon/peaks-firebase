import Link from "next/link";
import { Suspense } from "react";
import { getLists } from "../../../lib/actions/lists";
import { parseListDescription } from "../../../lib/list-content";
import { PageHeader } from "../../../components/ui/page-header";
import SearchBar from "../../../components/search-bar";

// Reads `searchParams` (the search box is a real navigation, not a client
// fetch), which makes Next render this dynamically per request regardless
// of this setting — see the identical note on areas/page.tsx. Declared
// anyway: the plain `/lists` link the nav points at is the same request
// shape every time and cheap to re-render.
export const revalidate = 3600;

const PAGE_SIZE = 60;

export default async function ListsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const { lists, total } = await getLists(query || undefined, PAGE_SIZE, 0);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <PageHeader
        title="Lists"
        meta={<p>Curated destination collections and public peak lists.</p>}
      />

      <Suspense fallback={<div className="mt-6 h-11" />}>
        <div className="mt-6 max-w-lg">
          <SearchBar placeholder="Search lists" />
        </div>
      </Suspense>

      <p className="mt-6 text-[13px] text-muted">
        Showing {lists.length.toLocaleString("en-US")} of{" "}
        <span className="font-mono-num tabular-nums">{total.toLocaleString("en-US")}</span>{" "}
        {total === 1 ? "list" : "lists"}.
      </p>

      {lists.length === 0 ? (
        <p className="mt-10 text-sm text-muted">
          {query ? `No lists found for "${query}".` : "No lists available."}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-hairline border-y border-hairline">
          {lists.map((list) => {
            const { paragraphs } = parseListDescription(list.description);
            const ownerLabel = list.owner === "peaks" ? "Peaks curated" : "Community list";

            return (
              <li key={list.id}>
                <Link
                  href={`/lists/${list.id}`}
                  className="group flex items-center justify-between gap-4 py-4"
                >
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium text-ink group-hover:underline">
                      {list.name}
                    </span>
                    <span className="mt-0.5 block max-w-[60ch] truncate text-[12px] text-muted">
                      {ownerLabel}
                      {paragraphs.length > 0 ? ` · ${paragraphs.join(" ")}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-muted">
                    <span className="font-mono-num tabular-nums">
                      {list.destination_count.toLocaleString("en-US")}
                    </span>{" "}
                    {list.destination_count === 1 ? "destination" : "destinations"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
