import { Suspense } from "react";

export default function PlansLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-gray-500 py-12 text-center">Loading...</div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
