"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import SearchBar from "@/components/search-bar";
import { getLists, type ListRow } from "@/lib/actions/lists";

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
      <h1 className="text-2xl font-semibold mb-6">Browse Lists</h1>

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {lists.map((list) => (
              <Link
                key={list.id}
                href={`/lists/${list.id}`}
                className="block p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
              >
                <div className="font-medium text-lg">{list.name}</div>
                {list.description && (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                    {list.description}
                  </p>
                )}
                <div className="text-xs text-gray-400 mt-3">
                  {list.destination_count} destination
                  {list.destination_count !== 1 ? "s" : ""}
                </div>
              </Link>
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
