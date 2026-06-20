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
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
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
        className="w-full rounded-md border border-gray-300 bg-white py-2.5 pl-10 pr-10 text-[15px] text-gray-900 outline-none transition-colors placeholder:text-gray-400 hover:border-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 dark:hover:border-gray-600"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            updateSearch("");
          }}
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
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
