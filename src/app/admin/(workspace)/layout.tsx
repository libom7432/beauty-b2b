import { AdminShell } from "@/components/admin/admin-shell";
import { getAdminUIIdentity } from "@/lib/admin/ui-identity";
import { visibleAdminNavigation } from "@/lib/admin/navigation";

export const dynamic = "force-dynamic";
export default async function AdminWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminUIIdentity();
  return <AdminShell items={visibleAdminNavigation(admin.permissions)} administrator={admin.admin_id.slice(-8)}>{children}</AdminShell>;
}
