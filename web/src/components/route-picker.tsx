"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getRoutes, type RouteRow } from "../lib/actions/routes";

interface RoutePickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export default function RoutePicker({
  selectedIds,
  onChange,
}: RoutePickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RouteRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedNames, setSelectedNames] = useState<Map<string, string>>(
    new Map()
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const res = await getRoutes(q.trim(), 20, 0);
    setResults(res.routes);
    setSearching(false);
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(query), 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, doSearch]);

  const addRoute = (route: RouteRow) => {
    if (selectedIds.includes(route.id)) return;
    onChange([...selectedIds, route.id]);
    setSelectedNames((prev) => {
      const next = new Map(prev);
      next.set(route.id, route.name || "Unnamed");
      return next;
    });
    setQuery("");
    setResults([]);
  };

  const removeRoute = (id: string) => {
    onChange(selectedIds.filter((sid) => sid !== id));
    setSelectedNames((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  return (
    <div>
      {/* Selected chips */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {selectedIds.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
            >
              {selectedNames.get(id) || id.slice(0, 8)}
              <button
                type="button"
                onClick={() => removeRoute(id)}
                className="ml-0.5 hover:text-orange-900 dark:hover:text-orange-100"
              >
                <svg
                  width="14"
                  height="14"
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
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search routes..."
          className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
      </div>

      {/* Results dropdown */}
      {(results.length > 0 || searching) && query.trim() && (
        <div className="mt-1 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 max-h-48 overflow-y-auto shadow-lg">
          {searching ? (
            <div className="p-3 text-sm text-gray-500">Searching...</div>
          ) : (
            results.map((route) => {
              const alreadySelected = selectedIds.includes(route.id);
              return (
                <button
                  key={route.id}
                  type="button"
                  disabled={alreadySelected}
                  onClick={() => addRoute(route)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                    alreadySelected
                      ? "opacity-40 cursor-not-allowed"
                      : "cursor-pointer"
                  }`}
                >
                  <div className="font-medium">
                    {route.name || "Unnamed"}
                  </div>
                  <div className="text-xs text-gray-500">
                    {route.distance != null &&
                      `${(route.distance / 1609.34).toFixed(1)} mi`}
                    {route.gain != null &&
                      ` · ${Math.round(route.gain * 3.28084).toLocaleString()} ft gain`}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
