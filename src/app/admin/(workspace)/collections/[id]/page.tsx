import { notFound, redirect } from "next/navigation";
import { AdminBadge, AdminPageHeader } from "@/components/admin/ui";
import { CollectionDetailPanel } from "@/components/admin/collection-detail-panel";
import { CollectionEditors } from "@/components/admin/collection-editors";
import { GuardedAdminLink } from "@/components/admin/admin-unsaved-changes";
import { requireAdminPage } from "@/lib/admin/server-access";
import { classifyCollectionDetailParams, clearUnsupportedCollectionParamsHref,
  parseCollectionMemberQuery, rawUrlEntries } from "@/lib/admin/collection-detail-query";
import { candidateHref, invalidCandidateResult, loadCandidateProducts, parseCandidateQuery,
  type CandidateQuery, type CandidateResult } from "@/lib/admin/collection-candidate-search";
import { CatalogReadError } from "@/lib/catalog-read/errors";
import { COLLECTION_UUID } from "@/lib/catalog-read/collections-cursor";
import { createServerCatalogReadRepository } from "@/lib/catalog-read/server";
import type { AdminCollectionDetailResult, AdminCollectionMemberListResult,
  AdminCollectionMemberQuery } from "@/lib/catalog-read/types";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminCollectionDetailPage({ params, searchParams }: Props) {
  await requireAdminPage("catalog.read");
  const { id } = await params;
  if (!COLLECTION_UUID.test(id)) notFound();
  const rawQuery = await searchParams;
  const { known: knownQuery, unsupported } = classifyCollectionDetailParams(rawQuery);
  const hasUnsupported = unsupported.length > 0;
  const rawMemberEntries = rawUrlEntries(rawQuery, "member");
  const rawCandidateEntries = rawUrlEntries(rawQuery, "candidate");
  const repository = await createServerCatalogReadRepository();
  let detail: AdminCollectionDetailResult;
  try { detail = await repository.getAdminCollectionById(id); }
  catch (error) {
    if (error instanceof CatalogReadError && error.code === "FORBIDDEN") redirect("/admin/login?error=1");
    detail = { state: "ERROR", item: null, issues: [], origin: "NONE" };
  }
  let members: AdminCollectionMemberListResult | null = null;
  let invalidMemberCursor = false;
  let pageKey = "first";
  let memberQuery: AdminCollectionMemberQuery = {};
  if (detail.state === "COMPLETE") {
    try {
      memberQuery = parseCollectionMemberQuery(knownQuery);
      pageKey = memberQuery.cursor ? `${memberQuery.direction}:${memberQuery.cursor}` : "first";
      members = hasUnsupported
        ? { state: "INCOMPLETE", items: [], issues: [], nextCursor: null,
          previousCursor: null, origin: "NONE" }
        : await repository.listAdminCollectionMembers(id, memberQuery);
    } catch (error) {
      if (error instanceof CatalogReadError && error.code === "FORBIDDEN") redirect("/admin/login?error=1");
      if (error instanceof CatalogReadError && error.code === "INVALID_INPUT") invalidMemberCursor = true;
      else members = { state: "ERROR", items: [], issues: [], nextCursor: null,
        previousCursor: null, origin: "NONE" };
    }
  }
  let candidateQuery: CandidateQuery = { search: "", status: "all", cursor: null, direction: "after" };
  let candidateResult: CandidateResult | null = null;
  try { candidateQuery = parseCandidateQuery(knownQuery); }
  catch {
    candidateResult = invalidCandidateResult(knownQuery);
    try { candidateQuery = parseCandidateQuery({ ...knownQuery,
      candidate_cursor: undefined, candidate_direction: undefined }); }
    catch { /* Invalid search/status remains an explicit invalid state. */ }
  }
  if (detail.state === "COMPLETE" && !candidateResult) {
    try { candidateResult = hasUnsupported
      ? { state: "INCOMPLETE", items: [], nextCursor: null, previousCursor: null }
      : await loadCandidateProducts(repository, candidateQuery); }
    catch (error) {
      if (error instanceof CatalogReadError && error.code === "FORBIDDEN") redirect("/admin/login?error=1");
      candidateResult = { state: "ERROR", items: [], nextCursor: null, previousCursor: null };
    }
  }
  const candidateHrefFor = (cursor: string | null, direction: "after" | "before" = "after") =>
    candidateHref(id, memberQuery, { ...candidateQuery, cursor, direction }, rawMemberEntries);
  return <><AdminPageHeader eyebrow="CATALOG / COLLECTIONS / DETAIL" title="Collection detail"
    description="Read-only collection details with LOCAL DEMO drafts for basic information and associated products. Changes stay in browser memory, are never saved to the database, and are lost on refresh or departure.">
    <AdminBadge>{detail.state === "COMPLETE" ? "LOCAL DEMO / NOT CONNECTED" : detail.state === "NOT_CONNECTED" ? "Not Connected" : detail.state}</AdminBadge>
  </AdminPageHeader>
    <p className="mb-5"><GuardedAdminLink href="/admin/collections" className="admin-inline-link">← Back to Collections</GuardedAdminLink></p>
    {hasUnsupported && <div className="admin-card admin-collection-state" role="alert">
      <h2>Unsupported URL parameters</h2>
      <p>This URL contains unsupported query parameters. Member and candidate results are paused until you remove them. Other URL errors still require their own recovery.</p>
      <GuardedAdminLink href={clearUnsupportedCollectionParamsHref(id, rawQuery)} className="admin-inline-link">
        Clear unsupported parameters</GuardedAdminLink>
    </div>}
    <CollectionDetailPanel detail={detail} members={members} invalidMemberCursor={invalidMemberCursor}
      urlPaused={hasUnsupported}
      candidateQuery={candidateQuery} candidateUrlEntries={rawCandidateEntries} />
    <CollectionEditors key={id.toLowerCase()} collectionId={id} detail={detail}
      members={members} pageKey={pageKey}
      candidate={detail.state === "COMPLETE" && candidateResult ? {
        collectionId: id, memberUrlEntries: rawMemberEntries, query: candidateQuery,
        urlPaused: hasUnsupported,
        hasCandidateCursor: rawQuery.candidate_cursor !== undefined && candidateResult.state !== "INVALID_QUERY",
        result: candidateResult, testData: detail.origin === "OFFLINE_FIXTURE",
        nextHref: candidateResult.nextCursor ? candidateHrefFor(candidateResult.nextCursor) : null,
        previousHref: candidateResult.previousCursor ? candidateHrefFor(candidateResult.previousCursor, "before") : null,
        firstHref: candidateHrefFor(null),
      } : null} />
  </>;
}
