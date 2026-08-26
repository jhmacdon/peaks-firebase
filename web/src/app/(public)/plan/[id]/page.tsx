import { permanentRedirect } from "next/navigation";
import { publicSavedRoutePath } from "../../../../components/route-paths";

export default async function LegacyPublicPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  permanentRedirect(publicSavedRoutePath(id));
}
