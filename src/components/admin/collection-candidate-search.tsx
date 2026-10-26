"use client";

import { useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CandidateQuery, CandidateResult } from "@/lib/admin/collection-candidate-search";
import type { UrlEntry } from "@/lib/admin/collection-detail-query";
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

export function CollectionCandidateSearch({ collectionId, memberUrlEntries, query, result, testData,
  hasCandidateCursor, urlPaused = false,
  nextHref, previousHref, firstHref }: {
  collectionId: string; memberUrlEntries: readonly UrlEntry[]; query: CandidateQuery;
  hasCandidateCursor: boolean;
  urlPaused?: boolean;
  result: CandidateResult; testData: boolean;
  nextHref: string | null; previousHref: string | null; firstHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = (href: string) => startTransition(() => router.push(href));
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
      <p>Read-only search. This page cannot prove that a product is not already associated with this Collection.</p>
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
      headings={["Product UUID", "Product Code", "Display name", "Status"]}>
      {rows.map((item) => <tr key={item.productId}>
        <td>{item.productId}</td><td>{item.productCode}</td>
        <td>{item.displayName?.trim() || "名称不可用"}</td>
        <td>{item.status}</td>
      </tr>)}
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
