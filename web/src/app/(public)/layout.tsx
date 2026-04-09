"use client";

import { AuthProvider } from "../../lib/auth-context";
import AppNav from "../../components/app-nav";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <AppNav />
        <main className="pb-20 md:pb-0">{children}</main>
      </div>
    </AuthProvider>
  );
}
