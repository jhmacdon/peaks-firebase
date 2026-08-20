import { notFound } from "next/navigation";
import { getCachedList, getCachedListDestinations } from "../../../../lib/actions/cached-lists";
import { parseListDescription } from "../../../../lib/list-content";
import { settled } from "../../../../lib/settled";
import { Breadcrumb } from "../../../../components/detail-sections";
import { PageHeader } from "../../../../components/ui/page-header";
import {
  Topline,
  type ToplineStat,
} from "../../../../components/ui/topline";
import { ListProgress } from "../../../../components/list/list-progress";
import { ListDestinations } from "../../../../components/list/list-destinations";

// The catalog's lists change rarely; this template is now a server shell
// (Task 14) rather than a client component that re-fetched `getList` on
// top of the layout's own SEO fetch — see cached-lists.ts's getCachedList,
// which de-dupes that read within one request the same way
// getCachedListDestinations already did.
export default async function ListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const list = await getCachedList(id);
  if (!list) notFound();

  const destinations = await settled(getCachedListDestinations(id), []);
  const { paragraphs, sourceUrl, sourceLabel } = parseListDescription(list.description);
  const ownerLabel = list.owner === "peaks" ? "Peaks curated" : "Community list";

  const toplineStats: ToplineStat[] = [
    {
      key: "destinations",
      value: list.destination_count.toLocaleString("en-US"),
      label: list.destination_count === 1 ? "Destination" : "Destinations",
    },
  ];

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <PageHeader
        breadcrumb={<Breadcrumb current={list.name} parentHref="/lists" parentLabel="Lists" />}
        title={list.name}
        meta={<p>{ownerLabel}</p>}
      />

      <Topline stats={toplineStats} className="mt-10" />

      <div className="mt-12 space-y-12">
        {paragraphs.length > 0 || sourceUrl ? (
          <section aria-labelledby="list-about">
            <div className="max-w-[68ch] space-y-3 text-base leading-[1.7] text-ink-2">
              {paragraphs.map((paragraph, index) => (
                <p key={`${index}-${paragraph}`}>{paragraph}</p>
              ))}
            </div>
            {sourceUrl && sourceLabel ? (
              <p className="mt-3 text-[13px] text-muted">
                Source:{" "}
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-ink-2"
                >
                  {sourceLabel}
                </a>
              </p>
            ) : null}
          </section>
        ) : null}

        <ListProgress listId={list.id} />

        <ListDestinations destinations={destinations} />
      </div>
    </div>
  );
}
