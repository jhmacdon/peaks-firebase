"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import DestinationCard from "@/components/destination-card";
import ProgressBar from "@/components/progress-bar";
import { useAuth } from "@/lib/auth-context";
import {
  getList,
  getListDestinations,
  getListProgress,
  type ListDetail,
  type ListDestination,
  type ListProgress,
} from "@/lib/actions/lists";

export default function ListDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { user } = useAuth();

  const [list, setList] = useState<ListDetail | null>(null);
  const [destinations, setDestinations] = useState<ListDestination[]>([]);
  const [progress, setProgress] = useState<ListProgress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [l, dests] = await Promise.all([
        getList(id),
        getListDestinations(id),
      ]);
      setList(l);
      setDestinations(dests);
      setLoading(false);
    }
    load();
  }, [id]);

  // Load progress when user is signed in
  const userId = user?.uid ?? null;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    async function loadProgress() {
      const p = await getListProgress(id, userId!);
      if (!cancelled) {
        setProgress(p);
      }
    }
    loadProgress();
    return () => {
      cancelled = true;
    };
  }, [id, userId]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">Loading...</div>
      </div>
    );
  }

  if (!list) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">List not found</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link
          href="/lists"
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          Lists
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">{list.name}</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">{list.name}</h1>
        {list.description && (
          <p className="text-gray-500 mt-2">{list.description}</p>
        )}
        <p className="text-sm text-gray-400 mt-2">
          {list.destination_count} destination
          {list.destination_count !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Progress (signed-in users only) */}
      {progress && (
        <div className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="font-semibold mb-3">Your Progress</h3>
          <ProgressBar completed={progress.completed} total={progress.total} />
        </div>
      )}

      {/* Destinations */}
      {destinations.length === 0 ? (
        <div className="text-gray-500 py-12 text-center">
          This list has no destinations yet
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {destinations.map((dest) => (
            <DestinationCard
              key={dest.id}
              id={dest.id}
              name={dest.name}
              elevation={dest.elevation}
              features={dest.features}
            />
          ))}
        </div>
      )}
    </div>
  );
}
