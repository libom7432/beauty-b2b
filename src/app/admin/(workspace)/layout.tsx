import { AdminShell } from "@/components/admin/admin-shell";
import { getAdminUISession } from "@/lib/admin/ui-identity";
import { visibleAdminNavigation } from "@/lib/admin/navigation";

export const dynamic = "force-dynamic";
export default async function AdminWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { admin, sessionKey } = await getAdminUISession();
  return <AdminShell key={`${admin.admin_id}:${sessionKey}`} adminId={admin.admin_id}
    sessionKey={sessionKey} items={visibleAdminNavigation(admin.permissions)}
    administrator={admin.admin_id.slice(-8)}>{children}</AdminShell>;
}
