import { AdminBadge, AdminCard, AdminPageHeader } from "./ui";

export function AdminPlaceholder({ title, eyebrow, description, dataSource }: {
  title: string; eyebrow: string; description: string; dataSource: string;
}) {
  return <>
    <AdminPageHeader eyebrow={eyebrow} title={title} description={description}><AdminBadge tone="warning">Coming Soon</AdminBadge></AdminPageHeader>
    <AdminCard title={`${title} overview`} description={`${dataSource} is not connected to this Admin interface.`}>
      <div className="admin-card-footer"><AdminBadge>Not Connected</AdminBadge><span className="admin-card-note">NO WRITE ACTIONS</span></div>
    </AdminCard>
  </>;
}
