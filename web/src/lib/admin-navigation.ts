export type AdminNavIcon =
  | "dashboard"
  | "photos"
  | "destinations"
  | "routes"
  | "sessions";

export type AdminNavItem = {
  href: string;
  label: string;
  description: string;
  icon: AdminNavIcon;
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", description: "Workspace overview", icon: "dashboard" },
  { href: "/admin/photos", label: "Photos", description: "Cover review queue", icon: "photos" },
  { href: "/admin/destinations", label: "Destinations", description: "Catalog places", icon: "destinations" },
  { href: "/admin/routes", label: "Routes", description: "Paths and segments", icon: "routes" },
  { href: "/admin/sessions", label: "Sessions", description: "Recorded activity", icon: "sessions" },
];

export function isAdminPathActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
