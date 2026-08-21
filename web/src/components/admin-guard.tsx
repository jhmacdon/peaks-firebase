"use client";

import { useAuth } from "../lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "./explore/explore-icons";

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) {
      router.replace("/admin/login");
    }
  }, [user, isAdmin, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center" role="status">
        <div className="flex items-center gap-3 text-sm text-muted">
          <Spinner />
          <span>Opening admin workspace…</span>
        </div>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return null;
  }

  return <>{children}</>;
}
