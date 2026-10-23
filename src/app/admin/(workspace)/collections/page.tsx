import { AdminBadge, AdminPageHeader } from "@/components/admin/ui";
import { CollectionListPanel } from "@/components/admin/collection-list-panel";
import { requireAdminPage } from "@/lib/admin/server-access";
import { parseAdminCollectionsUrl } from "@/lib/admin/collections-query";
import { createServerCatalogReadRepository } from "@/lib/catalog-read/server";
import { CatalogReadError } from "@/lib/catalog-read/errors";
import { redirect } from "next/navigation";
import type { AdminCollectionListResult } from "@/lib/catalog-read/types";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminCollectionsPage({ searchParams }: Props) {
  await requireAdminPage("catalog.read");
  let query;
  try { query = parseAdminCollectionsUrl(await searchParams); }
  catch (error) {
    if (!(error instanceof CatalogReadError) || error.code !== "INVALID_INPUT") throw error;
    return <><AdminPageHeader eyebrow="CATALOG / COLLECTIONS" title="Collections"
      description="Browse curated collections from the read-only Catalog Repository.">
      <AdminBadge>Invalid query</AdminBadge></AdminPageHeader>
      <CollectionListPanel result={null} query={null} /></>;
  }
  const repository = await createServerCatalogReadRepository();
  let result: AdminCollectionListResult;
  try { result = await repository.listAdminCollections(query.repositoryQuery); }
  catch (error) {
    if (error instanceof CatalogReadError && error.code === "FORBIDDEN") redirect("/admin/login?error=1");
    if (error instanceof CatalogReadError && error.code === "INVALID_INPUT")
      return <><AdminPageHeader eyebrow="CATALOG / COLLECTIONS" title="Collections"
        description="Browse curated collections from the read-only Catalog Repository.">
        <AdminBadge>Invalid query</AdminBadge></AdminPageHeader>
        <CollectionListPanel result={null} query={null} /></>;
    result = { state: "ERROR", items: [], issues: [], nextCursor: null, previousCursor: null, origin: "NONE" };
  }
  return <><AdminPageHeader eyebrow="CATALOG / COLLECTIONS" title="Collections"
    description="Browse curated collections from the read-only Catalog Repository. No editing is available.">
    <AdminBadge>{result.state === "NOT_CONNECTED" ? "Not Connected" : result.state === "COMPLETE" ? "Read only" : result.state}</AdminBadge>
  </AdminPageHeader><CollectionListPanel result={result} query={query} /></>;
}
