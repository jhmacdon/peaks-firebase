"use client";

import { useId, useState } from "react";

// Tabs — a hairline-underline tab list. Active tab reads accent-text over a
// 2px accent underline (the same active-marker language Task 9's nav uses),
// everything else neutral ink-2. Works controlled (`value`/`onChange`) or
// uncontrolled (`defaultValue`).
export interface TabItem {
  value: string;
  label: string;
}

export function Tabs({
  items,
  value,
  defaultValue,
  onChange,
  className = "",
}: {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  className?: string;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? items[0]?.value);
  const active = value ?? internalValue;
  const groupId = useId();

  function select(next: string) {
    if (value === undefined) setInternalValue(next);
    onChange?.(next);
  }

  return (
    <div role="tablist" className={`flex items-center gap-6 border-b border-hairline ${className}`.trim()}>
      {items.map((item) => {
        const isActive = item.value === active;
        return (
          <button
            key={item.value}
            id={`${groupId}-${item.value}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => select(item.value)}
            className={`-mb-px border-b-2 px-1 pb-2.5 text-sm font-medium transition-colors ${
              isActive ? "border-accent text-accent-text" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
