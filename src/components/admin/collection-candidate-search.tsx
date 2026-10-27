"use client";

import { useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CandidateQuery, CandidateResult } from "@/lib/admin/collection-candidate-search";
import type { UrlEntry } from "@/lib/admin/collection-detail-query";
import type { CandidateLocalMembershipStatus } from "@/lib/admin/collection-candidate-membership-status";
import type { AdminCollectionMembershipCheckResult } from "@/lib/catalog-read/types";
import { AdminBadge, AdminTable } from "./ui";

const stateCopy: Record<CandidateResult["state"], string> = {
  RESULTS: "Current query page", EMPTY: "No products matched this query.",
  EMPTY_PAGE: "No products beyond this cursor. Return to the first candidate page.",
  NOT_CONNECTED: "Product database not connected. No candidate data is available.",
  ERROR: "Candidate products could not be read. Try again later.",
  INCOMPLETE: "Candidate page could not be verified. Results are hidden.",
  INVALID_QUERY: "Candidate search or status is invalid. Clear the filters.",
  INVALID_CURSOR: "Candidate cursor is invalid. Clear the cursor to start again.",
};
const urlPausedCopy = "Candidate read paused by URL parameters. Remove unsupported URL parameters before searching.";
const membershipCopy: Record<CandidateLocalMembershipStatus, string> = {
  DRAFT_ADDED: "Draft Added", PENDING_REMOVAL: "Pending Removal",
  ALREADY_MEMBER: "Already in Collection", MEMBERSHIP_UNAVAILABLE: "Membership Status Unavailable",
  NOT_VERIFIED: "Membership Not Verified",
};
export type CandidateVerificationDisplay = Readonly<{
  productId: string; phase: "VERIFYING" | "RESULT" | "FAILED" | "EXPIRED";
  status?: AdminCollectionMembershipCheckResult["status"];
}>;
const verificationCopy: Record<AdminCollectionMembershipCheckResult["status"], string> = {
  MEMBER: "Member (exact GET check)", NOT_MEMBER: "Not a Member — Verified for this view only",
  NOT_CONNECTED: "Verification Not Connected", ERROR: "Verification Error",
  INCOMPLETE: "Verification Incomplete",
};

export function CollectionCandidateSearch({ collectionId, memberUrlEntries, query, result, testData,
  hasCandidateCursor, urlPaused = false, membershipStatuses, verification, canVerify,
  onVerify, onInvalidateVerification,
  nextHref, previousHref, firstHref }: {
  collectionId: string; memberUrlEntries: readonly UrlEntry[]; query: CandidateQuery;
  hasCandidateCursor: boolean;
  urlPaused?: boolean;
  result: CandidateResult; testData: boolean;
  membershipStatuses: Readonly<Record<string, CandidateLocalMembershipStatus>>;
  verification: CandidateVerificationDisplay | null;
  canVerify: boolean;
  onVerify: (productId: string) => void;
  onInvalidateVerification: () => void;
  nextHref: string | null; previousHref: string | null; firstHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = (href: string) => { onInvalidateVerification(); startTransition(() => router.push(href)); };
  const hrefFor = (nextSearch: string, nextStatus: CandidateQuery["status"]) => {
    const params = new URLSearchParams();
    for (const [key, value] of memberUrlEntries) {
      if (key !== "candidate_q" && key !== "candidate_status" &&
        key !== "candidate_cursor" && key !== "candidate_direction") params.append(key, value);
    }
    if (nextSearch.trim()) params.set("candidate_q", nextSearch.trim());
    if (nextStatus !== "all") params.set("candidate_status", nextStatus);
    const suffix = params.toString();
    return `/admin/collections/${encodeURIComponent(collectionId)}${suffix ? `?${suffix}` : ""}`;
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    navigate(hrefFor(String(values.get("candidate_q") ?? ""),
      String(values.get("candidate_status") ?? "all") as CandidateQuery["status"]));
  };
  const clear = () => navigate(hrefFor("", "all"));
  const displayState = urlPaused && result.state === "INCOMPLETE" ? "URL_PAUSED" : result.state;
  const rows = displayState === "RESULTS" ? result.items : [];
  return <section className="admin-card admin-table-panel admin-candidate-panel" aria-label="Candidate product search">
    <div className="admin-table-top"><div><h2>Candidate product search</h2>
      <p>Read-only search. Local membership labels reflect loaded draft facts only. This page cannot prove that a product is not already associated with this Collection.</p>
    </div><div className="admin-table-badges">{testData && <AdminBadge tone="warning">TEST DATA / LOCAL DEMO</AdminBadge>}
      <AdminBadge>{displayState}</AdminBadge></div></div>
    <form key={`${query.search}:${query.status}`} className="admin-candidate-filters" role="search" onSubmit={submit}>
      <label htmlFor="candidate-search">Search code or English / Chinese name</label>
      <input id="candidate-search" name="candidate_q" type="search" maxLength={100} defaultValue={query.search} />
      <label htmlFor="candidate-status">Product status</label>
      <select id="candidate-status" name="candidate_status" defaultValue={query.status}>
        <option value="all">All</option><option value="draft">Draft</option>
        <option value="published">Published</option><option value="retired">Retired</option>
      </select>
      <button type="submit" disabled={pending}>Search candidates</button>
      <button type="button" disabled={pending} onClick={clear}>Clear candidate filters</button>
    </form>
    <p className="admin-candidate-state" role={displayState === "ERROR" || displayState === "INCOMPLETE" ||
      displayState === "INVALID_CURSOR" || displayState === "INVALID_QUERY" || displayState === "URL_PAUSED" ? "alert" : "status"}>
      {pending ? "Loading candidate page…" : displayState === "URL_PAUSED" ? urlPausedCopy : stateCopy[result.state]}
      {query.search && ` · Search: ${query.search}`}{query.status !== "all" && ` · Status: ${query.status}`}
    </p>
    {rows.length > 0 && <AdminTable caption="Candidate products on current query page"
      headings={["Product UUID", "Product Code", "Display name", "Status", "Local membership", "Exact GET verification"]}>
      {rows.map((item) => {
        const membership = membershipStatuses[item.productId] ?? "MEMBERSHIP_UNAVAILABLE";
        const current = membership === "NOT_VERIFIED" && verification?.productId === item.productId
          ? verification : null;
        return <tr key={item.productId} data-product-id={item.productId}>
        <td>{item.productId}</td><td>{item.productCode}</td>
        <td>{item.displayName?.trim() || "名称不可用"}</td>
        <td>{item.status}</td>
        <td><span data-membership-status={membership}>{membershipCopy[membership]}</span></td>
        <td><span role="status" data-verification-status={current?.phase ?? "NOT_VERIFIED"}>
          {current?.phase === "VERIFYING" ? "Verifying…" :
            current?.phase === "EXPIRED" ? "Verification Expired — verify again" :
              current?.phase === "FAILED" ? "Verification Error — no trusted result" :
                current?.phase === "RESULT" && current.status ? verificationCopy[current.status] :
                  membership === "NOT_VERIFIED" ? "Not Verified" : "Local draft fact; exact check unavailable"}
        </span>{membership === "NOT_VERIFIED" && canVerify &&
          <button type="button" disabled={pending || current?.phase === "VERIFYING"}
            onClick={() => onVerify(item.productId)}>Verify Membership</button>}</td>
      </tr>; })}
    </AdminTable>}
    <nav className="admin-product-pagination" aria-label="Candidate product pages">
      {previousHref ? <button type="button" disabled={pending} onClick={() => navigate(previousHref)}>Previous</button>
        : <span aria-disabled="true">Previous</span>}
      {hasCandidateCursor && <button type="button" disabled={pending} onClick={() => navigate(firstHref)}>First candidate page</button>}
      {nextHref ? <button type="button" disabled={pending} onClick={() => navigate(nextHref)}>Next</button>
        : <span aria-disabled="true">Next</span>}
    </nav>
  </section>;
}
