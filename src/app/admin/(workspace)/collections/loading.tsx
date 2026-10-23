import { AdminPageHeader } from "@/components/admin/ui";

export default function AdminCollectionsLoading() {
  return <><AdminPageHeader eyebrow="CATALOG / COLLECTIONS" title="Collections"
    description="Loading the read-only collection list." />
    <div className="admin-card admin-collection-state" role="status" aria-live="polite">
      <strong>Loading collections</strong><p>Waiting for the collection source.</p>
    </div></>;
}
