import { AdminBadge, AdminPageHeader } from "@/components/admin/ui";
import { RFQInboxListPanel } from "@/components/admin/rfq-inbox-panel";

export default function Loading() {
  return <><AdminPageHeader eyebrow="MERCHANT / RFQ" title="RFQ Inbox"
    description="Private, read-only merchant inquiry view."><AdminBadge>Loading</AdminBadge></AdminPageHeader>
    <RFQInboxListPanel state="loading" /></>;
}
