import Link from "next/link";
import { Suspense } from "react";
import { getLists } from "../../../lib/actions/lists";
import { listOwnerLabel } from "../../../lib/list-content";
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
            const ownerLabel = listOwnerLabel(list.owner);

            // Same column-first, filter-then-join rule as the detail page's
            // meta line, plus one more fallback tier: a browse row has no
            // "about" section to fall back on, so a list with no researched
            // year/organization shows its region before the coarse owner
            // label.
            const metaParts = [
              list.year_established ? `Est. ${list.year_established}` : null,
              list.organization,
            ].filter((part): part is string => Boolean(part));
            const metaLine =
              metaParts.length > 0 ? metaParts.join(" · ") : list.region || ownerLabel;

            return (
              <li key={list.id}>
                <Link
                  href={`/lists/${list.id}`}
                  className="group flex items-center justify-between gap-4 py-4"
                >
                  <span className="flex min-w-0 items-center gap-3">
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
                      <span className="block text-[15px] font-medium text-ink group-hover:underline">
                        {list.name}
                      </span>
                      <span className="mt-0.5 block max-w-[60ch] truncate text-[12px] text-muted">
                        {metaLine}
                      </span>
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
