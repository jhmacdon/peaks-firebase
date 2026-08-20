"use client";

import { useAuth } from "../lib/auth-context";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { LOADING_LABEL } from "../lib/constants";

export default function UserAuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    if (!loading && !user) {
      const next = `${pathname}${search ? `?${search}` : ""}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [loading, pathname, router, search, user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">{LOADING_LABEL}</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
