"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface SearchBarProps {
  placeholder?: string;
  paramName?: string;
}

export default function SearchBar({
  placeholder = "Search...",
  paramName = "q",
}: SearchBarProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const currentValue = searchParams.get(paramName) || "";
  const [value, setValue] = useState(currentValue);
  const routerRef = useRef(router);
  const searchStateRef = useRef({
    pathname,
    paramName,
    searchParamString: searchParams.toString(),
  });

  routerRef.current = router;
  searchStateRef.current = {
    pathname,
    paramName,
    searchParamString: searchParams.toString(),
  };

  const updateSearch = (newValue: string) => {
    const { pathname: nextPathname, paramName: nextParamName, searchParamString } =
      searchStateRef.current;
    const params = new URLSearchParams(searchParamString);
    const trimmed = newValue.trim();

    if (trimmed) {
      params.set(nextParamName, trimmed);
    } else {
      params.delete(nextParamName);
    }

    const nextQuery = params.toString();
    routerRef.current.replace(nextQuery ? `${nextPathname}?${nextQuery}` : nextPathname);
  };

  useEffect(() => {
    setValue(currentValue);
  }, [currentValue]);

  useEffect(() => {
    if (value.trim() === currentValue) return;

    const timer = setTimeout(() => {
      const { pathname: nextPathname, paramName: nextParamName, searchParamString } =
        searchStateRef.current;
      const params = new URLSearchParams(searchParamString);
      const trimmed = value.trim();

      if (trimmed) {
        params.set(nextParamName, trimmed);
      } else {
        params.delete(nextParamName);
      }

      const nextQuery = params.toString();
      routerRef.current.replace(
        nextQuery ? `${nextPathname}?${nextQuery}` : nextPathname
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [value, currentValue]);

  return (
    <div className="group relative">
      <div className="pointer-events-none absolute inset-0 rounded-[26px] bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.12),transparent_24%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.14),transparent_24%)]" />
      <div className="relative flex items-center">
        <div className="pointer-events-none absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-2xl border border-white/80 bg-white/90 text-emerald-700 shadow-sm dark:border-gray-700 dark:bg-gray-950/80 dark:text-emerald-300">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full rounded-[26px] border border-stone-200/80 bg-white/90 py-3.5 pl-16 pr-14 text-[15px] font-medium text-stone-950 shadow-[0_16px_35px_-28px_rgba(15,23,42,0.45)] outline-none transition-all placeholder:text-stone-500 hover:border-stone-300 group-focus-within:border-emerald-400/70 group-focus-within:bg-white group-focus-within:shadow-[0_22px_45px_-28px_rgba(5,150,105,0.35)] dark:border-gray-800 dark:bg-gray-950/90 dark:text-gray-50 dark:placeholder:text-gray-500 dark:hover:border-gray-700 dark:group-focus-within:border-emerald-700/70 dark:group-focus-within:bg-gray-950"
        />
      </div>
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            updateSearch("");
          }}
          className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-stone-200/80 bg-white/90 text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-700 dark:border-gray-700 dark:bg-gray-950/90 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200"
          aria-label="Clear search"
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
      )}
    </div>
  );
}
