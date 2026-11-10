import { AdminBadge, AdminPageHeader } from "@/components/admin/ui";
import { RFQInboxListPanel } from "@/components/admin/rfq-inbox-panel";
import { serverRFQInboxRepository } from "@/lib/rfq/inbox-server";
import { RFQInboxError, RFQ_INBOX_MAX_PAGE } from "@/lib/rfq/inbox";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
export default async function RFQInboxPage({ searchParams }: Props) {
  const repository = await serverRFQInboxRepository();
  const raw = await searchParams;
  const pageText = raw.page ?? "1";
  const page = typeof pageText === "string" && /^[1-9][0-9]{0,3}$/.test(pageText) ? Number(pageText) : NaN;
  let state: "invalid" | "not_connected" | "unavailable" | undefined;
  let result;
  if (Object.keys(raw).some((key) => key !== "page") || !Number.isSafeInteger(page) || page > RFQ_INBOX_MAX_PAGE)
    state = "invalid";
  else try { result = await repository.list(page); }
  catch (error) { state = error instanceof RFQInboxError && error.code === "NOT_CONNECTED" ? "not_connected" : "unavailable"; }
  return <><AdminPageHeader eyebrow="MERCHANT / RFQ" title="RFQ Inbox"
    description="Private, read-only merchant inquiry view. Live RFQ access requires a separately approved data source.">
    <AdminBadge tone="warning">Not connected</AdminBadge></AdminPageHeader>
    <RFQInboxListPanel state={state} result={result} /></>;
}
