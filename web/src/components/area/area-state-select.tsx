"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { allUsStateCodes, subdivisionName } from "../../lib/regions";

const STATE_OPTIONS = allUsStateCodes()
  .map((code) => ({ code, name: subdivisionName("US", code) }))
  .filter((state): state is { code: string; name: string } => state.name !== null);

/** State is part of the index URL, like search and land type. Keeping it in
 * the URL makes a filtered area page linkable and leaves the other filters
 * in place when the reader changes state. */
export function AreaStateSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = (searchParams.get("state") ?? "").toUpperCase();

  function select(stateCode: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (stateCode) {
      params.set("state", stateCode);
    } else {
      params.delete("state");
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      <span className="shrink-0">State</span>
      <select
        value={STATE_OPTIONS.some((state) => state.code === current) ? current : ""}
        onChange={(event) => select(event.target.value)}
        className="h-10 min-w-0 rounded-full border border-border bg-page px-4 pr-9 text-sm text-ink"
      >
        <option value="">All states</option>
        {STATE_OPTIONS.map((state) => (
          <option key={state.code} value={state.code}>
            {state.name}
          </option>
        ))}
      </select>
    </label>
  );
}
