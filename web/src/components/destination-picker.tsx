"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  searchDestinations,
  type SearchDestination,
} from "../lib/actions/search";
import { Chip } from "./ui/chip";
import { Input } from "./ui/field";

interface DestinationPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  selectedDestinations?: Array<{
    id: string;
    name: string;
  }>;
}

export default function DestinationPicker({
  selectedIds,
  onChange,
  selectedDestinations,
}: DestinationPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchDestination[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedNames, setSelectedNames] = useState<
    Map<string, string>
  >(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSelectedNames((previous) => {
      const next = new Map(previous);

      for (const destination of selectedDestinations ?? []) {
        next.set(destination.id, destination.name);
      }

      for (const id of next.keys()) {
        if (!selectedIds.includes(id)) {
          next.delete(id);
        }
      }

      return next;
    });
  }, [selectedDestinations, selectedIds]);

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const res = await searchDestinations(q.trim());
    setResults(res);
    setSearching(false);
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(query), 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, doSearch]);

  const addDestination = (dest: SearchDestination) => {
    if (selectedIds.includes(dest.id)) return;
    onChange([...selectedIds, dest.id]);
    setSelectedNames((prev) => {
      const next = new Map(prev);
      next.set(dest.id, dest.name || "Unnamed");
      return next;
    });
    setQuery("");
    setResults([]);
  };

  const removeDestination = (id: string) => {
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
            <Chip key={id} selected onRemove={() => removeDestination(id)}>
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
          placeholder="Search destinations..."
          className="pl-9"
        />
      </div>

      {/* Results dropdown */}
      {(results.length > 0 || searching) && query.trim() && (
        <div className="mt-1 rounded-ctl border border-border bg-page max-h-48 overflow-y-auto shadow-float">
          {searching ? (
            <div className="p-3 text-sm text-muted">Searching…</div>
          ) : (
            results.map((dest) => {
              const alreadySelected = selectedIds.includes(dest.id);
              return (
                <button
                  key={dest.id}
                  type="button"
                  disabled={alreadySelected}
                  onClick={() => addDestination(dest)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-fill transition-colors ${
                    alreadySelected
                      ? "opacity-40 cursor-not-allowed"
                      : "cursor-pointer"
                  }`}
                >
                  <div className="font-medium text-ink">
                    {dest.name || "Unnamed"}
                  </div>
                  <div className="text-xs text-muted">
                    {dest.elevation != null &&
                      `${Math.round(dest.elevation * 3.28084).toLocaleString()} ft`}
                    {dest.features.length > 0 &&
                      ` · ${dest.features.join(", ")}`}
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
