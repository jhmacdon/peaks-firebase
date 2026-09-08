import { Suspense } from "react";
import { getLists } from "../../../lib/actions/lists";
import { PageHeader } from "../../../components/ui/page-header";
import ListCard from "../../../components/list-card";
import SearchBar from "../../../components/search-bar";
import { CatalogPagination } from "../../../components/catalog-pagination";

export const revalidate = 3600;
const PAGE_SIZE = 24;
export default async function ListsIndexPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const requestedPage = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  let { lists, total } = await getLists(query || undefined, PAGE_SIZE, (requestedPage - 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  if (page !== requestedPage) ({ lists, total } = await getLists(query || undefined, PAGE_SIZE, (page - 1) * PAGE_SIZE));
  const pageHref = (value: number) => `/lists?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(value) })}`;
  return <div className="mx-auto max-w-[1200px] px-6 py-8">
    <PageHeader title="Find your next peak list" meta={<p>Explore classic challenges and keep track of the places you’ve reached.</p>} />
    <Suspense fallback={<div className="mt-6 h-12" />}><div className="mt-6 max-w-lg"><SearchBar placeholder="Search lists" /></div></Suspense>
    <p className="mt-6 text-sm text-muted">{total ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString("en-US")} lists` : "No lists match this search."}</p>
    <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{lists.map((list) => <ListCard key={list.id} list={list} />)}</div>
    <CatalogPagination page={page} pageCount={pageCount} href={pageHref} />
  </div>;
}
