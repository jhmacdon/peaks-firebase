import { notFound } from "next/navigation";
import { getArea } from "../../../../lib/actions/areas";
import AreaDetailClient from "./area-detail-client";

export const dynamic = "force-dynamic";

export default async function AreaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const area = await getArea(id);
  if (!area) notFound();

  return <AreaDetailClient area={area} />;
}
