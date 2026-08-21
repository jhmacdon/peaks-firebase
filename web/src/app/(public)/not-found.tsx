import type { Metadata } from "next";
import { NotFoundContent } from "../../components/not-found-content";

// Answers `notFound()` thrown inside the (public) group — a destination,
// route, list, or area id that doesn't resolve. Nav and footer come from
// `(public)/layout.tsx`, so only the body belongs here.
export const metadata: Metadata = {
  title: "Not found",
  description: "That page isn't on the map.",
};

export default function NotFound() {
  return <NotFoundContent />;
}
