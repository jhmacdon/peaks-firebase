"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { createTripReport, type TripReportBlock } from "@/lib/actions/trip-reports";
import { searchDestinations, type SearchDestination } from "@/lib/actions/search";
import { getDestination } from "@/lib/actions/destinations";
import BlockEditor from "@/components/block-editor";

interface SelectedDestination {
  id: string;
  name: string;
}

function NewReportForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getIdToken } = useAuth();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [blocks, setBlocks] = useState<TripReportBlock[]>([
    { type: "text", content: "" },
  ]);
  const [selectedDestinations, setSelectedDestinations] = useState<
    SelectedDestination[]
  >([]);
  const [destQuery, setDestQuery] = useState("");
  const [destResults, setDestResults] = useState<SearchDestination[]>([]);
  const [destSearching, setDestSearching] = useState(false);
  const [showDestDropdown, setShowDestDropdown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load pre-selected destination from URL param
  useEffect(() => {
    const destId = searchParams.get("dest");
    if (destId) {
      async function loadDest() {
        const dest = await getDestination(destId!);
        if (dest) {
          setSelectedDestinations([
            { id: dest.id, name: dest.name || "Unnamed" },
          ]);
        }
      }
      loadDest();
    }
  }, [searchParams]);

  // Debounced destination search
  useEffect(() => {
    if (!destQuery.trim()) {
      const timer = setTimeout(() => {
        setDestResults([]);
      }, 0);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(async () => {
      setDestSearching(true);
      const results = await searchDestinations(destQuery, undefined, undefined, 8);
      setDestResults(results);
      setDestSearching(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [destQuery]);

  const addDestination = useCallback(
    (dest: SearchDestination) => {
      if (selectedDestinations.some((d) => d.id === dest.id)) return;
      setSelectedDestinations((prev) => [
        ...prev,
        { id: dest.id, name: dest.name || "Unnamed" },
      ]);
      setDestQuery("");
      setDestResults([]);
      setShowDestDropdown(false);
    },
    [selectedDestinations]
  );

  const removeDestination = useCallback((id: string) => {
    setSelectedDestinations((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    if (selectedDestinations.length === 0) {
      setError("Select at least one destination");
      return;
    }

    // Filter out empty blocks
    const nonEmptyBlocks = blocks.filter((b) => b.content.trim());
    if (nonEmptyBlocks.length === 0) {
      setError("Add at least one content block");
      return;
    }

    setSubmitting(true);

    try {
      const token = await getIdToken();
      if (!token) {
        setError("Not authenticated. Please sign in.");
        setSubmitting(false);
        return;
      }

      const result = await createTripReport(token, {
        title: title.trim(),
        date,
        destinations: selectedDestinations.map((d) => d.id),
        blocks: nonEmptyBlocks,
      });

      router.push(`/reports/${result.id}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create report"
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link
          href="/discover"
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          Discover
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">
          New Trip Report
        </span>
      </div>

      <h1 className="text-2xl font-semibold mb-8">New Trip Report</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title */}
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Summer summit of Mt. Rainier"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>

        {/* Date */}
        <div>
          <label
            htmlFor="date"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Date
          </label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>

        {/* Destinations */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Destinations
          </label>

          {/* Selected destinations */}
          {selectedDestinations.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedDestinations.map((dest) => (
                <span
                  key={dest.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-sm"
                >
                  {dest.name}
                  <button
                    type="button"
                    onClick={() => removeDestination(dest.id)}
                    className="hover:text-blue-900 dark:hover:text-blue-100"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Search input */}
          <div className="relative">
            <input
              type="text"
              value={destQuery}
              onChange={(e) => {
                setDestQuery(e.target.value);
                setShowDestDropdown(true);
              }}
              onFocus={() => setShowDestDropdown(true)}
              placeholder="Search destinations to add..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />

            {/* Dropdown results */}
            {showDestDropdown && destQuery.trim() && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                {destSearching ? (
                  <div className="px-3 py-2 text-sm text-gray-500">
                    Searching...
                  </div>
                ) : destResults.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500">
                    No destinations found
                  </div>
                ) : (
                  destResults.map((dest) => {
                    const alreadySelected = selectedDestinations.some(
                      (d) => d.id === dest.id
                    );
                    return (
                      <button
                        key={dest.id}
                        type="button"
                        onClick={() => addDestination(dest)}
                        disabled={alreadySelected}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                          alreadySelected
                            ? "opacity-50 cursor-not-allowed"
                            : ""
                        }`}
                      >
                        <div className="font-medium">
                          {dest.name || "Unnamed"}
                        </div>
                        {dest.elevation != null && (
                          <div className="text-xs text-gray-500">
                            {Math.round(
                              dest.elevation * 3.28084
                            ).toLocaleString()}{" "}
                            ft
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Click-outside handler */}
          {showDestDropdown && (
            <div
              className="fixed inset-0 z-0"
              onClick={() => setShowDestDropdown(false)}
            />
          )}
        </div>

        {/* Block Editor */}
        <BlockEditor blocks={blocks} onChange={setBlocks} />

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center gap-4 pt-4">
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Publishing..." : "Publish Report"}
          </button>
          <Link
            href="/discover"
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function NewReportPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="text-gray-500 py-12 text-center">Loading...</div>
        </div>
      }
    >
      <NewReportForm />
    </Suspense>
  );
}
