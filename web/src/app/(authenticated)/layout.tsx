"use client";

import { AuthProvider } from "../../lib/auth-context";
import AppNav from "../../components/app-nav";
import UserAuthGuard from "../../components/user-auth-guard";

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <UserAuthGuard>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
          <AppNav />
          <main className="pb-20 md:pb-0">{children}</main>
        </div>
      </UserAuthGuard>
    </AuthProvider>
  );
}
