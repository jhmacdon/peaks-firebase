import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { activityLandingConfig, isActivityLandingType } from "../../../../lib/landing-copy";
import { EntityOgImage } from "../../../../lib/seo-image";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  if (!isActivityLandingType(type)) notFound();

  return new ImageResponse(
    <EntityOgImage
      name={activityLandingConfig(type).h1}
      stats="Track ascents · Save routes · Browse mountain guides"
    />,
    size
  );
}
