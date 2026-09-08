"use client";

import { useEffect, useId, useState } from "react";
import { Chip } from "./ui/chip";
import { Input, Label } from "./ui/field";
import { Button } from "./ui/button";

type Choice = { id: string; name: string; detail?: string };

export default function CatalogPicker({ label, selectedIds, selectedItems, onChange, search }: {
  label: string;
  selectedIds: string[];
  selectedItems?: { id: string; name: string }[];
  onChange: (ids: string[]) => void;
  search: (query: string) => Promise<Choice[]>;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Choice[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setResults([]); setError(false);
    if (!query.trim()) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await search(query.trim());
        if (!cancelled) setResults(found);
      } catch { if (!cancelled) setError(true); }
      finally { if (!cancelled) setSearching(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, search, retry]);
  const knownNames = { ...Object.fromEntries((selectedItems ?? []).map((item) => [item.id, item.name])), ...names };
  const add = (item: Choice) => {
    if (selectedIds.includes(item.id)) return;
    setNames((current) => ({ ...current, [item.id]: item.name }));
    onChange([...selectedIds, item.id]);
    setQuery("");
  };
  return <div>
    <Label htmlFor={id}>{label}</Label>
    {selectedIds.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{selectedIds.map((selected) => <Chip key={selected} selected onRemove={() => onChange(selectedIds.filter((value) => value !== selected))}>{knownNames[selected] || "Selected item"}</Chip>)}</div>}
    <Input id={id} type="search" autoComplete="off" value={query} placeholder={`Search ${label.toLocaleLowerCase()}`} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
      if (event.key === "Escape") setQuery("");
      if (event.key === "ArrowDown" && results.length > 0) {
        event.preventDefault();
        document.getElementById(`${id}-results`)?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      }
    }} aria-describedby={`${id}-status`} />
    <p id={`${id}-status`} role="status" className="mt-2 text-sm text-muted">{searching ? "Searching…" : query.trim() ? error ? "Search is unavailable." : `${results.length} ${results.length === 1 ? "match" : "matches"}` : "Search by name. Choose a result to add it."}</p>
    {query.trim() && !searching && error && <Button type="button" variant="quiet" onClick={() => setRetry((value) => value + 1)}>Try search again</Button>}
    {query.trim() && !searching && !error && results.length === 0 && <p className="mt-2 text-sm text-muted">No matches. Try a nearby place or a shorter name.</p>}
    {query.trim() && results.length > 0 && <ul id={`${id}-results`} aria-label={`${label} search results`} className="mt-3 max-h-64 overflow-y-auto divide-y divide-hairline rounded-media border border-border">
      {results.map((item) => <li key={item.id}><button type="button" disabled={selectedIds.includes(item.id)} onClick={() => add(item)} className="min-h-12 w-full px-4 py-3 text-left transition-colors hover:bg-fill disabled:opacity-50"><span className="block font-medium text-ink">{item.name}{selectedIds.includes(item.id) ? " · Added" : ""}</span>{item.detail && <span className="mt-1 block text-sm text-muted">{item.detail}</span>}</button></li>)}
    </ul>}
  </div>;
}
