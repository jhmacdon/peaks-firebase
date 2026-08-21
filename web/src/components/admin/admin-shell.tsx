"use client";

import { usePathname } from "next/navigation";
import AdminNav from "../admin-nav";
import { useAuth } from "../../lib/auth-context";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, isAdmin, loading } = useAuth();

  if (pathname === "/admin/login") return <>{children}</>;
  if (loading || !user || !isAdmin) return <>{children}</>;

  return (
    <div className="min-h-dvh bg-page text-ink">
      <AdminNav />
      <div className="min-w-0 lg:pl-64">{children}</div>
    </div>
  );
}
