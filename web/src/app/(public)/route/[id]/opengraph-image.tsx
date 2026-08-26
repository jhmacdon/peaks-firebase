import { ImageResponse } from "next/og";
import { getPublicPlanBundle } from "../../../../lib/actions/public-plans";
import { EntityOgImage } from "../../../../lib/seo-image";
import { formatFeet, formatMiles, joinStats } from "../../../../lib/seo";

export const dynamic = "force-dynamic";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let name = "Shared route";
  let stats: string | null = null;

  try {
    const bundle = await getPublicPlanBundle(id);
    if (bundle) {
      name = bundle.plan.name || name;
      stats = joinStats([
        formatMiles(bundle.plan.distance),
        bundle.plan.gain != null ? `${formatFeet(bundle.plan.gain)} gain` : null,
        bundle.destinations.length > 0
          ? `${bundle.destinations.length} ${bundle.destinations.length === 1 ? "destination" : "destinations"}`
          : null,
      ]);
    }
  } catch {
    // Keep the safe branded fallback when a public route cannot be loaded.
  }

  return new ImageResponse(<EntityOgImage name={name} stats={stats} />, size);
}
