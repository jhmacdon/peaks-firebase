"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AREA_INDEX_DESIGNATIONS,
  AREA_INDEX_DESIGNATION_LABELS,
} from "../../lib/area-types";
import { Chip } from "../ui/chip";

/** The /areas index's designation filter — a real navigation (URL query
 * param), so the server page re-fetches with the new filter rather than
 * this component holding results state of its own. */
export function AreaDesignationChips() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = (searchParams.get("type") ?? "").toUpperCase();

  function select(code: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (code) {
      params.set("type", code);
    } else {
      params.delete("type");
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Chip selected={current === ""} onClick={() => select("")}>
        All
      </Chip>
      {AREA_INDEX_DESIGNATIONS.map((code) => (
        <Chip key={code} selected={current === code} onClick={() => select(code)}>
          {AREA_INDEX_DESIGNATION_LABELS[code]}
        </Chip>
      ))}
    </div>
  );
}
