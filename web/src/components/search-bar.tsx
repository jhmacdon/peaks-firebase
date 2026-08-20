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
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
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
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-11 w-full rounded-ctl border border-border bg-page py-2.5 pl-10 pr-10 text-[15px] text-ink transition-colors placeholder:text-faint hover:border-ink-2 focus:border-accent"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            updateSearch("");
          }}
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-ctl text-faint transition-colors hover:bg-fill hover:text-ink-2"
          aria-label="Clear search"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
