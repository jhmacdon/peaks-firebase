import type { AdminNavIcon } from "../../lib/admin-navigation";

type IconName = AdminNavIcon | "external" | "logout" | "plus" | "arrow";

export function AdminIcon({
  name,
  size = 18,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {name === "dashboard" ? (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
      ) : null}
      {name === "photos" ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9" r="1.5" />
          <path d="m4 17 5-5 3.5 3.5 2.5-2.5 5 5" />
        </>
      ) : null}
      {name === "destinations" ? (
        <>
          <path d="m3 20 6.5-11 4 6 2.5-4 5 9" />
          <path d="M14 7.5c0-2.2 1.6-4 3.6-4s3.6 1.8 3.6 4c0 2.8-3.6 6-3.6 6s-3.6-3.2-3.6-6Z" />
          <circle cx="17.6" cy="7.5" r="1" />
        </>
      ) : null}
      {name === "routes" ? (
        <>
          <circle cx="5" cy="18" r="2" />
          <circle cx="19" cy="6" r="2" />
          <path d="M6.8 17.2c2.2-.8 2.8-2 2.8-3.3 0-1.7-1.5-2.4-1.5-4 0-1.9 1.8-3 4.2-3h4.7" />
        </>
      ) : null}
      {name === "sessions" ? (
        <>
          <path d="M3 12h4l2.2-5 4 10 2.2-5H21" />
          <path d="M5 4.5a9 9 0 1 1-1.5 12" />
        </>
      ) : null}
      {name === "external" ? (
        <>
          <path d="M14 4h6v6" />
          <path d="m20 4-9 9" />
          <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
        </>
      ) : null}
      {name === "logout" ? (
        <>
          <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
          <path d="m15 16 4-4-4-4" />
          <path d="M19 12H9" />
        </>
      ) : null}
      {name === "plus" ? (
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      ) : null}
      {name === "arrow" ? <path d="m9 18 6-6-6-6" /> : null}
    </svg>
  );
}
