import { AdminPageHeader } from "@/components/admin/ui";

export default function AdminCollectionDetailLoading() {
  return <><AdminPageHeader eyebrow="CATALOG / COLLECTIONS / DETAIL" title="Collection detail"
    description="Loading read-only collection details." />
    <div className="admin-card admin-collection-state" role="status" aria-live="polite">
      <strong>Loading collection detail</strong><p>Waiting for the collection source.</p>
    </div></>;
}
