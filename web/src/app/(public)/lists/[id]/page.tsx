import { notFound } from "next/navigation";
import { getCachedList, getCachedListDestinations } from "../../../../lib/actions/cached-lists";
import { parseListDescription } from "../../../../lib/list-content";
import { buildListToplineFacts } from "../../../../lib/list-stats";
import { settled } from "../../../../lib/settled";
import { Breadcrumb } from "../../../../components/detail-sections";
import { PageHeader } from "../../../../components/ui/page-header";
import {
  Topline,
  type ToplineStat,
} from "../../../../components/ui/topline";
import { ListCompletionProvider } from "../../../../components/list/list-completion-context";
import { ListHero } from "../../../../components/list/list-hero";
import { ListRoster } from "../../../../components/list/list-roster";

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
  const {
    paragraphs,
    sourceUrl: parsedSourceUrl,
    sourceLabel: parsedSourceLabel,
  } = parseListDescription(list.description);
  const ownerLabel = list.owner === "peaks" ? "Peaks curated" : "Community list";

  // year_established/organization are the researched replacement for the
  // legacy "Source: <url>" clause parsed below — see
  // cloud-sql/migrations/20260821_list_metadata.sql. Either can be null on
  // its own (the five plain elevation/prominence cuts carry no keeper
  // organization), so each renders independently; only when both are
  // missing does the meta line fall back to the coarse owner label.
  const metaParts = [
    list.year_established ? `Est. ${list.year_established}` : null,
    list.organization,
  ].filter((part): part is string => Boolean(part));
  const metaLine = metaParts.length > 0 ? metaParts.join(" · ") : ownerLabel;

  // Same column-first, parsed-legacy-fallback rule as the meta line: the
  // migration always writes source_name and source_url together (or leaves
  // both null), so testing source_url alone is enough to pick the pair.
  const sourceHref = list.source_url ?? parsedSourceUrl;
  const sourceLabel = list.source_url ? (list.source_name ?? parsedSourceLabel) : parsedSourceLabel;

  const facts = buildListToplineFacts(destinations);
  const toplineStats: ToplineStat[] = [
    facts.count > 0
      ? { key: "peaks", value: facts.count.toLocaleString("en-US"), label: "Peaks" }
      : null,
    facts.highestFt != null
      ? {
          key: "highest",
          value: Math.round(facts.highestFt).toLocaleString("en-US"),
          unit: "ft",
          label: "Highest peak",
        }
      : null,
    facts.states > 0
      ? { key: "states", value: facts.states.toLocaleString("en-US"), label: "States" }
      : null,
  ].filter((stat): stat is ToplineStat => stat !== null);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <PageHeader
        breadcrumb={<Breadcrumb current={list.name} parentHref="/lists" parentLabel="Lists" />}
        title={list.name}
        meta={<p>{metaLine}</p>}
      />

      {/* One provider around every section that needs a signed-in reader's
          completion — the map hero and the roster — rather than around the
          whole page shell above. Topline and the about copy sit between
          them in page order and ride along inside the same block; neither
          reads the context. */}
      <ListCompletionProvider listId={list.id}>
        <div className="mt-10 space-y-12">
          <ListHero destinations={destinations} />

          <Topline stats={toplineStats} />

          {paragraphs.length > 0 || sourceHref ? (
            <section aria-labelledby="list-about">
              <div className="max-w-[68ch] space-y-3 text-base leading-[1.7] text-ink-2">
                {paragraphs.map((paragraph, index) => (
                  <p key={`${index}-${paragraph}`}>{paragraph}</p>
                ))}
              </div>
              {sourceHref && sourceLabel ? (
                <p className="mt-3 text-[13px] text-muted">
                  Source:{" "}
                  <a
                    href={sourceHref}
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

          <ListRoster destinations={destinations} />
        </div>
      </ListCompletionProvider>
    </div>
  );
}
