"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getRoutes, type RouteRow } from "../lib/actions/routes";
import { Chip } from "./ui/chip";
import { Input } from "./ui/field";

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
            <Chip key={id} selected onRemove={() => removeRoute(id)}>
              {selectedNames.get(id) || id.slice(0, 8)}
            </Chip>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"
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
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search routes..."
          className="pl-9"
        />
      </div>

      {/* Results dropdown */}
      {(results.length > 0 || searching) && query.trim() && (
        <div className="mt-1 rounded-ctl border border-border bg-page max-h-48 overflow-y-auto shadow-float">
          {searching ? (
            <div className="p-3 text-sm text-muted">Searching…</div>
          ) : (
            results.map((route) => {
              const alreadySelected = selectedIds.includes(route.id);
              return (
                <button
                  key={route.id}
                  type="button"
                  disabled={alreadySelected}
                  onClick={() => addRoute(route)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-fill transition-colors ${
                    alreadySelected
                      ? "opacity-40 cursor-not-allowed"
                      : "cursor-pointer"
                  }`}
                >
                  <div className="font-medium text-ink">
                    {route.name || "Unnamed"}
                  </div>
                  <div className="text-xs text-muted">
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
