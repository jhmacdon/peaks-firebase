"use client";

import Link from "next/link";
import AdminGuard from "@/components/admin-guard";
import AdminNav from "@/components/admin-nav";

const sections = [
  {
    title: "Destinations",
    description: "Browse and manage peaks, trailheads, and points of interest",
    href: "/admin/destinations",
    count: "5,193",
  },
  {
    title: "Routes",
    description: "View and edit climbing and hiking routes",
    href: "/admin/routes",
    count: "324",
  },
  {
    title: "Sessions",
    description: "Review tracked hiking and climbing sessions",
    href: "/admin/sessions",
    count: "991",
  },
  {
    title: "Lists",
    description: "Manage destination collections and peak lists",
    href: "/admin/lists",
    count: "15",
  },
];

export default function AdminDashboard() {
  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <AdminNav />

        <main className="max-w-7xl mx-auto px-6 py-10">
          <h2 className="text-2xl font-semibold mb-6">Dashboard</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {sections.map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className="block p-6 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
              >
                <div className="text-3xl font-bold text-blue-600 mb-1">
                  {section.count}
                </div>
                <div className="font-semibold mb-1">{section.title}</div>
                <div className="text-sm text-gray-500">
                  {section.description}
                </div>
              </Link>
            ))}
          </div>
        </main>
      </div>
    </AdminGuard>
  );
}
