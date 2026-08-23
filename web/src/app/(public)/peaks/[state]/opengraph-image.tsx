import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { usStateCodeFromSlug, subdivisionName } from "../../../../lib/regions";
import { EntityOgImage } from "../../../../lib/seo-image";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state } = await params;
  const stateCode = usStateCodeFromSlug(state);
  const stateName = stateCode ? subdivisionName("US", stateCode) : null;
  if (!stateName) notFound();

  return new ImageResponse(
    <EntityOgImage
      name={`The peaks of ${stateName}`}
      stats="Mountain guides · Routes · Protected areas"
    />,
    size
  );
}
