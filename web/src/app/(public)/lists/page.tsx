import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { catalogPageMetadata, catalogPageNumber, catalogPagePath, firstSearchValue, type CatalogSearchParams } from "../../../lib/catalog-seo";
import { Suspense } from "react";
import { getLists } from "../../../lib/actions/lists";
import { PageHeader } from "../../../components/ui/page-header";
import ListCard from "../../../components/list-card";
import SearchBar from "../../../components/search-bar";
import { CatalogPagination } from "../../../components/catalog-pagination";

export const revalidate = 3600;
const PAGE_SIZE = 24;
export async function generateMetadata({ searchParams }: {
  searchParams: Promise<CatalogSearchParams>;
}): Promise<Metadata> {
  const params = await searchParams;
  const query = firstSearchValue(params.q).trim();
  return catalogPageMetadata({
    path: "/lists",
    title: "Peak-bagging lists & mountain challenges",
    description: "Browse curated mountain and destination lists, then track your progress across the Peaks guide.",
    page: catalogPageNumber(params.page),
    filters: { q: query },
    noindex: Boolean(query),
  });
}

export default async function ListsIndexPage({ searchParams }: { searchParams: Promise<CatalogSearchParams> }) {
  const params = await searchParams;
  const query = firstSearchValue(params.q).trim();
  const requestedPage = catalogPageNumber(params.page);
  const { lists, total } = await getLists(query || undefined, PAGE_SIZE, (requestedPage - 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const pageHref = (value: number) => catalogPagePath("/lists", value, { q: query });
  if (page !== requestedPage) redirect(pageHref(page));
  return <div className="mx-auto max-w-[1200px] px-6 py-8">
    <PageHeader title="Find your next peak list" meta={<p>Explore classic challenges and keep track of the places you’ve reached.</p>} />
    <Suspense fallback={<div className="mt-6 h-12" />}><div className="mt-6 max-w-lg"><SearchBar placeholder="Search lists" /></div></Suspense>
    <p className="mt-6 text-sm text-muted">{total ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString("en-US")} lists` : "No lists match this search."}</p>
    <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{lists.map((list) => <ListCard key={list.id} list={list} />)}</div>
    <CatalogPagination page={page} pageCount={pageCount} href={pageHref} />
  </div>;
}
