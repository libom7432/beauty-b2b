import { notFound, redirect } from "next/navigation";
import { AdminBadge, AdminPageHeader } from "@/components/admin/ui";
import { CollectionDetailPanel } from "@/components/admin/collection-detail-panel";
import { CollectionBasicEditor } from "@/components/admin/collection-basic-editor";
import { GuardedAdminLink } from "@/components/admin/admin-unsaved-changes";
import { requireAdminPage } from "@/lib/admin/server-access";
import { parseCollectionMemberQuery } from "@/lib/admin/collection-detail-query";
import { CatalogReadError } from "@/lib/catalog-read/errors";
import { COLLECTION_UUID } from "@/lib/catalog-read/collections-cursor";
import { createServerCatalogReadRepository } from "@/lib/catalog-read/server";
import type { AdminCollectionDetailResult, AdminCollectionMemberListResult } from "@/lib/catalog-read/types";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminCollectionDetailPage({ params, searchParams }: Props) {
  await requireAdminPage("catalog.read");
  const { id } = await params;
  if (!COLLECTION_UUID.test(id)) notFound();
  const repository = await createServerCatalogReadRepository();
  let detail: AdminCollectionDetailResult;
  try { detail = await repository.getAdminCollectionById(id); }
  catch (error) {
    if (error instanceof CatalogReadError && error.code === "FORBIDDEN") redirect("/admin/login?error=1");
    detail = { state: "ERROR", item: null, issues: [], origin: "NONE" };
  }
  let members: AdminCollectionMemberListResult | null = null;
  let invalidMemberCursor = false;
  if (detail.state === "COMPLETE") {
    try {
      const query = parseCollectionMemberQuery(await searchParams);
      members = await repository.listAdminCollectionMembers(id, query);
    } catch (error) {
      if (error instanceof CatalogReadError && error.code === "FORBIDDEN") redirect("/admin/login?error=1");
      if (error instanceof CatalogReadError && error.code === "INVALID_INPUT") invalidMemberCursor = true;
      else members = { state: "ERROR", items: [], issues: [], nextCursor: null,
        previousCursor: null, origin: "NONE" };
    }
  }
  return <><AdminPageHeader eyebrow="CATALOG / COLLECTIONS / DETAIL" title="Collection detail"
    description="Read-only collection information and associated products, with a browser-only basic information draft. Nothing is saved to the server.">
    <AdminBadge>{detail.state === "COMPLETE" ? "LOCAL DEMO / NOT CONNECTED" : detail.state === "NOT_CONNECTED" ? "Not Connected" : detail.state}</AdminBadge>
  </AdminPageHeader>
    <p className="mb-5"><GuardedAdminLink href="/admin/collections" className="admin-inline-link">← Back to Collections</GuardedAdminLink></p>
    <CollectionDetailPanel detail={detail} members={members} invalidMemberCursor={invalidMemberCursor} />
    <CollectionBasicEditor detail={detail} />
  </>;
}
