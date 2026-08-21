"use client";

import { Suspense } from "react";
import { AuthProvider } from "../../lib/auth-context";
import AppNav from "../../components/app-nav";
import { SiteFooter } from "../../components/site-footer";
import UserAuthGuard from "../../components/user-auth-guard";
import { LOADING_LABEL } from "../../lib/constants";

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center text-muted">
            {LOADING_LABEL}
          </div>
        }
      >
        <UserAuthGuard>
          <div className="flex min-h-screen flex-col pb-[var(--chrome-bottom-h)] md:pb-0">
            <AppNav />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
        </UserAuthGuard>
      </Suspense>
    </AuthProvider>
  );
}
