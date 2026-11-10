import { AdminBadge, AdminCard, AdminPageHeader } from "@/components/admin/ui";
import { visibleAdminNavigation } from "@/lib/admin/navigation";
import { getAdminUIIdentity } from "@/lib/admin/ui-identity";
import { requireAdminPage } from "@/lib/admin/server-access";

const descriptions: Record<string, string> = {
  Products: "Review product families, variants and publishing fields once a catalog source is connected.",
  Categories: "Review the category hierarchy used by the storefront.",
  Collections: "Review the curated groupings shown to buyers.",
  Media: "Review product image references and their relationships.",
  Imports: "Review catalog import receipts when the import service is connected.",
  "RFQ Inbox": "Review customer inquiries after a separately authorized RFQ reader is connected.",
};

export const dynamic = "force-dynamic";
export default async function AdminDashboard({ searchParams }: {
  searchParams: Promise<{ rfq?: string }>;
}) {
  await requireAdminPage();
  const rfqDenied = (await searchParams).rfq === "forbidden";
  const admin = await getAdminUIIdentity();
  const modules = visibleAdminNavigation(admin.permissions).filter((item) => item.href !== "/admin");
  return <>
    {rfqDenied && <p role="alert" className="admin-card admin-rfq-state">You do not have permission to read inquiries.</p>}
    <AdminPageHeader eyebrow="WORKSPACE / OVERVIEW" title="Good to see you." description="A read-only view of the Admin foundation. Business data will appear only after an approved data source is connected."><AdminBadge tone="warning">Read only</AdminBadge></AdminPageHeader>
    <div className="admin-overview">
      <section className="admin-overview-banner"><div><p className="admin-eyebrow">SPRINT 2.6 · FOUNDATION</p><h2>One place for your catalog workflow.</h2></div><p>Modules are being prepared for future, permission-controlled connections.</p></section>
      <AdminCard title="System configuration" description="Current connection state of the Admin workspace.">
        <div className="admin-system-list">
          <div className="admin-system-row"><span>Admin identity</span><AdminBadge tone="positive">Verified</AdminBadge></div>
          <div className="admin-system-row"><span>Product database</span><AdminBadge>Not Connected</AdminBadge></div>
          <div className="admin-system-row"><span>Image storage</span><AdminBadge>Not Connected</AdminBadge></div>
          <div className="admin-system-row"><span>Import interface</span><AdminBadge tone="warning">Coming Soon</AdminBadge></div>
        </div>
      </AdminCard>
    </div>
    <div className="admin-section-heading"><h2>Management areas</h2><span>Visible according to your permissions</span></div>
    <div className="admin-grid">{modules.map((item) => <AdminCard key={item.href} title={item.label} description={descriptions[item.label]} href={item.href}><div className="admin-card-footer"><AdminBadge>{item.label === "Imports" ? "Coming Soon" : "Not Connected"}</AdminBadge><span className="admin-card-note">READ ONLY</span></div></AdminCard>)}</div>
  </>;
}
