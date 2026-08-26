import { redirect } from "next/navigation";
import { myRoutePath } from "../../../../components/route-paths";

export default async function DeprecatedPlanLayout({
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(myRoutePath(id));
}
