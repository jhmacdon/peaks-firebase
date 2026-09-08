import { Suspense } from "react";
import { LOADING_LABEL } from "../../../lib/constants";

export default function PlansLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="text-muted py-12 text-center">{LOADING_LABEL}</div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
