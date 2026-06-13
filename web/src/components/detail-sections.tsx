import Link from "next/link";

// Shared building blocks for the editorial detail pages (destination and
// route guides). See web/docs/destination-page-spec.md for the visual rules.

export const DIFFICULTY_CLASSES: Record<string, string> = {
  Easy: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  Moderate: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  Hard: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  Strenuous: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export function DifficultyPill({ label }: { label: string }) {
  return (
    <span
      className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
        DIFFICULTY_CLASSES[label] || DIFFICULTY_CLASSES.Moderate
      }`}
    >
      {label}
    </span>
  );
}

export function Breadcrumb({ current }: { current: string }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
      <Link
        href="/discover"
        className="hover:text-gray-900 hover:underline dark:hover:text-gray-100"
      >
        Discover
      </Link>
      <span aria-hidden>›</span>
      <span className="text-gray-700 dark:text-gray-300">{current}</span>
    </nav>
  );
}

export function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-4 py-3 dark:bg-gray-950">
      <div className="text-lg font-semibold text-gray-900 dark:text-white">
        {value}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}

export function StatRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd
        className={`text-right font-medium text-gray-900 dark:text-white ${
          mono ? "font-mono text-[13px]" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

export function SidePanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
      <h2 className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
        {title}
      </h2>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/** "fire-lookout" → "Fire lookout" */
export function titleize(value: string): string {
  const spaced = value.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
