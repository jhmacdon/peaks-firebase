import { ImageResponse } from "next/og";
import { getPublicSessionBundle } from "../../../../lib/actions/public-sessions";
import {
  deriveActivityDisplayName,
  formatSessionDuration,
} from "../../../../lib/seo-descriptions";
import { EntityOgImage } from "../../../../lib/seo-image";
import { formatFeet, formatMiles, joinStats } from "../../../../lib/seo";

export const dynamic = "force-dynamic";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let name = "Shared activity";
  let stats: string | null = null;

  try {
    const bundle = await getPublicSessionBundle(id);
    if (bundle) {
      name = deriveActivityDisplayName(bundle.session.name, bundle.destinations);
      stats = joinStats([
        formatMiles(bundle.session.distance),
        bundle.session.gain != null ? `${formatFeet(bundle.session.gain)} gain` : null,
        bundle.session.total_time != null
          ? formatSessionDuration(bundle.session.total_time)
          : null,
      ]);
    }
  } catch {
    // Keep the branded fallback when the public activity cannot be loaded.
  }

  return new ImageResponse(<EntityOgImage name={name} stats={stats} />, size);
}
