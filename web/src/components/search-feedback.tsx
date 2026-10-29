export function SearchSpinner({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block size-4 shrink-0 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin ${className}`} />;
}

export function SearchResultSkeletons() {
  return <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
    {Array.from({ length: 6 }, (_, index) => <div key={index} className="overflow-hidden rounded-media border border-border motion-safe:animate-pulse">
      <div className="h-40 bg-fill" />
      <div className="space-y-3 p-4"><div className="h-4 w-3/4 rounded bg-fill" /><div className="h-3 w-1/2 rounded bg-fill" /><div className="h-3 w-2/3 rounded bg-fill" /></div>
    </div>)}
  </div>;
}

/** Used while the route loads and while its URL-aware island hydrates. */
export function SearchPageLoading() {
  return <div aria-busy="true">
    <h1 className="text-3xl font-semibold tracking-tight text-ink">Explore Peaks</h1>
    <div className="mt-4 h-12 max-w-3xl rounded-media bg-fill motion-safe:animate-pulse" aria-hidden="true" />
    <p role="status" className="mt-6 flex items-center gap-2 text-sm text-muted"><SearchSpinner />Getting search ready…</p>
    <SearchResultSkeletons />
  </div>;
}
