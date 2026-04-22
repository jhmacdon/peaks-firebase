"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import SearchBar from "../../../components/search-bar";
import ListCard from "../../../components/list-card";
import { getLists, type ListRow } from "../../../lib/actions/lists";

function ListsContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") || "";

  const [lists, setLists] = useState<ListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const PAGE_SIZE = 20;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const result = await getLists(query || undefined, PAGE_SIZE, 0);
      if (!cancelled) {
        setLists(result.lists);
        setTotal(result.total);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [query]);

  const loadMore = async () => {
    setLoadingMore(true);
    const result = await getLists(
      query || undefined,
      PAGE_SIZE,
      lists.length
    );
    setLists((prev) => [...prev, ...result.lists]);
    setTotal(result.total);
    setLoadingMore(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Browse Lists</h1>
      <p className="mb-6 text-sm text-gray-500">
        Explore curated destination collections and public peak lists.
      </p>

      <div className="mb-6">
        <SearchBar placeholder="Search lists..." />
      </div>

      {loading ? (
        <div className="text-gray-500 py-12 text-center">Loading...</div>
      ) : lists.length === 0 ? (
        <div className="text-gray-500 py-12 text-center">
          {query
            ? `No lists found for "${query}"`
            : "No lists available"}
        </div>
      ) : (
        <>
          <div className="text-sm text-gray-500 mb-4">
            Showing {lists.length} of {total} list{total !== 1 ? "s" : ""}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lists.map((list) => (
              <ListCard key={list.id} list={list} />
            ))}
          </div>

          {lists.length < total && (
            <div className="mt-8 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-6 py-2.5 text-sm font-medium border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {loadingMore ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ListsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-gray-500 py-12 text-center">Loading...</div>
        </div>
      }
    >
      <ListsContent />
    </Suspense>
  );
}
