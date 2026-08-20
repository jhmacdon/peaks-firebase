import { getCachedListDestinations } from "../../../../lib/actions/cached-lists";
import ListDetailClient from "./list-detail-client";

export default async function ListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const destinations = await getCachedListDestinations(id);

  return <ListDetailClient id={id} destinations={destinations} />;
}
