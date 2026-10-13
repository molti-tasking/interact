import { redirect } from "next/navigation";

/** The design-activity page moved to /activity ("Dashboard" now charts responses). */
export default async function LegacyDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/portfolios/${id}/activity`);
}
