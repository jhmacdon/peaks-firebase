import Link from "next/link";

interface DestinationCardProps {
  id: string;
  name: string | null;
  elevation: number | null;
  features: string[];
  distance_m?: number;
}

export default function DestinationCard({
  id,
  name,
  elevation,
  features,
  distance_m,
}: DestinationCardProps) {
  const visibleFeatures = features.slice(0, 3);
  const hiddenFeatureCount = Math.max(0, features.length - visibleFeatures.length);
  const elevationFeet =
    elevation != null
      ? `${Math.round(elevation * 3.28084).toLocaleString()} ft`
      : "Unknown";
  const distanceLabel =
    distance_m == null
      ? "Map-ready"
      : distance_m < 1609.34
        ? `${Math.round(distance_m)} m away`
        : `${(distance_m / 1609.34).toFixed(1)} mi away`;

  return (
    <Link
      href={`/destinations/${id}`}
      className="group relative block h-full overflow-hidden rounded-[28px] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,247,244,0.94))] p-5 shadow-[0_20px_40px_-32px_rgba(15,23,42,0.5)] transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-300/80 hover:shadow-[0_28px_55px_-34px_rgba(5,150,105,0.35)] dark:border-gray-800 dark:bg-[linear-gradient(180deg,rgba(17,24,39,0.98),rgba(3,7,18,0.98))] dark:hover:border-emerald-700/70"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.10),transparent_24%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(56,189,248,0.14),transparent_24%)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center rounded-full border border-emerald-200/80 bg-emerald-50/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300">
              Destination
            </div>
            <div className="mt-3 text-lg font-semibold leading-tight tracking-tight text-stone-950 transition-colors group-hover:text-emerald-800 dark:text-gray-50 dark:group-hover:text-emerald-300">
              {name || "Unnamed"}
            </div>
          </div>
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-white/90 text-stone-500 shadow-sm transition-all group-hover:translate-x-0.5 group-hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-950/80 dark:text-gray-400 dark:group-hover:text-emerald-300">
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
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-white/80 bg-white/80 px-3 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-950/70">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-gray-500">
              Elevation
            </div>
            <div className="mt-1 text-sm font-semibold text-stone-950 dark:text-gray-100">
              {elevationFeet}
            </div>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/80 px-3 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-950/70">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-gray-500">
              {distance_m == null ? "Guide" : "From you"}
            </div>
            <div className="mt-1 text-sm font-semibold text-stone-950 dark:text-gray-100">
              {distanceLabel}
            </div>
          </div>
        </div>

        {visibleFeatures.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {visibleFeatures.map((feature) => (
              <span
                key={feature}
                className="inline-flex items-center rounded-full border border-stone-200/80 bg-stone-100/90 px-2.5 py-1 text-[11px] font-medium text-stone-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              >
                {feature}
              </span>
            ))}
            {hiddenFeatureCount > 0 && (
              <span className="inline-flex items-center rounded-full border border-sky-200/80 bg-sky-50/90 px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:border-sky-900 dark:bg-sky-950/70 dark:text-sky-300">
                +{hiddenFeatureCount} more
              </span>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-stone-500 dark:text-gray-400">
            Public destination guide with map-ready details.
          </p>
        )}
      </div>
    </Link>
  );
}
