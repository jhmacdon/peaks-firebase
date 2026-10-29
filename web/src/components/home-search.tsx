"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { SearchSpinner } from "./search-feedback";

export function HomeSearch() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <form action="/discover" role="search" aria-busy={pending} onSubmit={(event) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    startTransition(() => router.push(query ? `/discover?${new URLSearchParams({ q: query })}` : "/discover"));
  }} className="mt-8 flex max-w-[640px] flex-col gap-2 rounded-[20px] bg-white p-2 sm:flex-row sm:rounded-full">
    <label htmlFor="home-search" className="sr-only">Search peaks, routes, and parks</label>
    <input id="home-search" name="q" type="search" placeholder="Search peaks, routes, and parks" className="h-12 min-w-0 flex-1 rounded-full bg-white px-4 text-base text-[#21211f] placeholder:text-[#64635e]" />
    <Button type="submit" disabled={pending} className="shrink-0">{pending ? <><SearchSpinner />Searching…</> : "Search"}</Button>
    <span role="status" className="sr-only">{pending ? "Opening search results…" : ""}</span>
  </form>;
}
