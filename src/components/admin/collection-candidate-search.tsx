"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CandidateQuery, CandidateResult } from "@/lib/admin/collection-candidate-search";
import type { UrlEntry } from "@/lib/admin/collection-detail-query";
import type { CandidateLocalMembershipStatus } from "@/lib/admin/collection-candidate-membership-status";
import type { AdminCollectionMembershipCheckResult } from "@/lib/catalog-read/types";
import { AdminBadge, AdminTable } from "./ui";
import { useAdminUnsavedChanges } from "./admin-unsaved-changes";

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

type NavigationAttempt = Readonly<{
  id: number; origin: string; target: string; search: string;
  status: CandidateQuery["status"]; phase: "PENDING" | "SUPERSEDED" | "RECOVERABLE";
}>;

// URLSearchParams normalizes percent encoding; sorting distinct keys ignores harmless
// parameter ordering while preserving the order of repeated values for each key.
function comparableUrl(href: string): string {
  const url = new URL(href, window.location.origin);
  const grouped = new Map<string, string[]>();
  for (const [key, value] of url.searchParams) grouped.set(key, [...(grouped.get(key) ?? []), value]);
  const params = new URLSearchParams();
  for (const key of [...grouped.keys()].sort()) {
    for (const value of grouped.get(key) ?? []) params.append(key, value);
  }
  return `${url.pathname}${params.size ? `?${params}` : ""}`;
}

function targetQueryMatches(target: string, query: CandidateQuery): boolean {
  const params = new URL(target, window.location.origin).searchParams;
  return query.search === (params.get("candidate_q") ?? "") &&
    query.status === (params.get("candidate_status") ?? "all") &&
    query.cursor === params.get("candidate_cursor") &&
    query.direction === (params.get("candidate_direction") ?? "after");
}

export function CollectionCandidateSearch({ collectionId, query, result, testData,
  hasCandidateCursor, urlPaused = false, membershipStatuses, verification, canVerify,
  onVerify, onAdd, onInvalidateVerification, actionFeedback,
  nextHref, previousHref, firstHref }: {
  collectionId: string; memberUrlEntries: readonly UrlEntry[]; query: CandidateQuery;
  hasCandidateCursor: boolean;
  urlPaused?: boolean;
  result: CandidateResult; testData: boolean;
  membershipStatuses: Readonly<Record<string, CandidateLocalMembershipStatus>>;
  verification: CandidateVerificationDisplay | null;
  canVerify: boolean;
  onVerify: (productId: string) => void;
  onAdd: (productId: string) => void;
  onInvalidateVerification: () => void;
  actionFeedback: string | null;
  nextHref: string | null; previousHref: string | null; firstHref: string;
}) {
  const router = useRouter();
  const { isNavigationBusy } = useAdminUnsavedChanges();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locationKey = `${pathname}${searchParams.size ? `?${searchParams}` : ""}`;
  const { search: querySearch, status: queryStatus, cursor: queryCursor,
    direction: queryDirection } = query;
  const [transitionPending, startTransition] = useTransition();
  const [attempt, setAttempt] = useState<NavigationAttempt | null>(null);
  const attemptRef = useRef<NavigationAttempt | null>(null);
  const abandonedTargetRef = useRef<string | null>(null);
  const [navigationNotice, setNavigationNotice] = useState<"LATE" | "PRESERVED" | null>(null);
  const nextAttemptId = useRef(0);
  const sawTransitionPending = useRef<number | null>(null);
  const [searchInput, setSearchInput] = useState(query.search);
  const [statusInput, setStatusInput] = useState<CandidateQuery["status"]>(query.status);
  const editableRef = useRef({ search: query.search, status: query.status });
  const committedRef = useRef({ search: query.search, status: query.status });
  const searchRef = useRef<HTMLInputElement>(null);
  const focusAfterResume = useRef(false);
  const setEditable = (search: string, status: CandidateQuery["status"]) => {
    editableRef.current = { search, status };
    setSearchInput(search);
    setStatusInput(status);
    if (search === committedRef.current.search && status === committedRef.current.status)
      setNavigationNotice(null);
  };
  const publishAttempt = (next: NavigationAttempt | null) => {
    attemptRef.current = next;
    setAttempt(next);
  };
  useEffect(() => {
    const current = attemptRef.current;
    if (current && comparableUrl(locationKey) === current.target && targetQueryMatches(current.target,
      { search: querySearch, status: queryStatus, cursor: queryCursor, direction: queryDirection })) {
      publishAttempt(null);
      abandonedTargetRef.current = null;
      committedRef.current = { search: querySearch, status: queryStatus };
      setEditable(current.search, current.status);
      setNavigationNotice(current.search !== querySearch || current.status !== queryStatus
        ? "PRESERVED" : null);
    } else if (current && comparableUrl(locationKey) !== current.origin && current.phase === "PENDING") {
      publishAttempt({ ...current, phase: "SUPERSEDED" });
    } else if (!current) {
      const previous = committedRef.current;
      const editable = editableRef.current;
      const hasUnsubmittedInput = editable.search !== previous.search || editable.status !== previous.status;
      committedRef.current = { search: querySearch, status: queryStatus };
      if (abandonedTargetRef.current === comparableUrl(locationKey)) {
        abandonedTargetRef.current = null;
        setNavigationNotice("LATE");
      } else if (hasUnsubmittedInput &&
        (editable.search !== querySearch || editable.status !== queryStatus)) {
        abandonedTargetRef.current = null;
        setNavigationNotice("PRESERVED");
      } else {
        abandonedTargetRef.current = null;
        setNavigationNotice(null);
        setEditable(querySearch, queryStatus);
      }
    }
  }, [locationKey, querySearch, queryStatus, queryCursor, queryDirection]);
  useEffect(() => {
    if (!attempt && focusAfterResume.current) {
      focusAfterResume.current = false;
      searchRef.current?.focus();
    }
  }, [attempt]);
  useEffect(() => {
    const current = attemptRef.current;
    if (!current) return;
    if (transitionPending) sawTransitionPending.current = current.id;
    else if (sawTransitionPending.current === current.id && current.phase === "PENDING")
      publishAttempt({ ...current, phase: "RECOVERABLE" });
  }, [transitionPending, attempt]);
  const pending = attempt !== null;
  const showNavigationNotice = navigationNotice !== null &&
    (searchInput !== querySearch || statusInput !== queryStatus);
  const navigate = (href: string, nextSearch = editableRef.current.search,
    nextStatus = editableRef.current.status) => {
    if (attemptRef.current !== null || isNavigationBusy()) return;
    const origin = comparableUrl(window.location.href);
    const target = comparableUrl(href);
    onInvalidateVerification();
    if (target === origin) return;
    const next: NavigationAttempt = { id: ++nextAttemptId.current, origin, target,
      search: nextSearch, status: nextStatus, phase: "PENDING" };
    sawTransitionPending.current = null;
    setNavigationNotice(null);
    publishAttempt(next);
    try { startTransition(() => router.push(href)); }
    catch { publishAttempt({ ...next, phase: "RECOVERABLE" }); }
  };
  const hrefFor = (nextSearch: string, nextStatus: CandidateQuery["status"]) => {
    const params = new URLSearchParams(window.location.search);
    for (const key of ["candidate_q", "candidate_status", "candidate_cursor", "candidate_direction"])
      params.delete(key);
    if (nextSearch.trim()) params.set("candidate_q", nextSearch.trim());
    if (nextStatus !== "all") params.set("candidate_status", nextStatus);
    const suffix = params.toString();
    return `/admin/collections/${encodeURIComponent(collectionId)}${suffix ? `?${suffix}` : ""}`;
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { search, status } = editableRef.current;
    navigate(hrefFor(search, status), search.trim(), status);
  };
  const clear = () => {
    if (attemptRef.current !== null || isNavigationBusy()) return;
    const href = hrefFor("", "all");
    if (comparableUrl(href) === comparableUrl(window.location.href)) {
      onInvalidateVerification();
      setEditable("", "all");
      setNavigationNotice(null);
    } else navigate(href, "", "all");
  };
  const resumeEditing = () => {
    abandonedTargetRef.current = attemptRef.current?.target ?? null;
    focusAfterResume.current = true;
    publishAttempt(null);
  };
  const displayState = urlPaused && result.state === "INCOMPLETE" ? "URL_PAUSED" : result.state;
  const rows = displayState === "RESULTS" ? result.items : [];
  return <section className="admin-card admin-table-panel admin-candidate-panel" aria-label="Candidate product search">
    <div className="admin-table-top"><div><h2>Candidate product search</h2>
      <p>Read-only search. Local membership labels reflect loaded draft facts only. This page cannot prove that a product is not already associated with this Collection.</p>
    </div><div className="admin-table-badges">{testData && <AdminBadge tone="warning">TEST DATA / LOCAL DEMO</AdminBadge>}
      <AdminBadge>{displayState}</AdminBadge></div></div>
    <form className="admin-candidate-filters" role="search"
      data-navigation-attempt={attempt?.id ?? ""} data-navigation-phase={attempt?.phase ?? "IDLE"}
      aria-busy={pending} onSubmit={submit}>
      <label htmlFor="candidate-search">Search code or English / Chinese name</label>
      <input id="candidate-search" name="candidate_q" type="search" maxLength={100}
        ref={searchRef} value={searchInput}
        onChange={(event) => setEditable(event.target.value, editableRef.current.status)} disabled={pending} />
      <label htmlFor="candidate-status">Product status</label>
      <select id="candidate-status" name="candidate_status" value={statusInput}
        onChange={(event) => setEditable(editableRef.current.search,
          event.target.value as CandidateQuery["status"])} disabled={pending}>
        <option value="all">All</option><option value="draft">Draft</option>
        <option value="published">Published</option><option value="retired">Retired</option>
      </select>
      <button type="submit" disabled={pending}>Search candidates</button>
      <button type="button" disabled={pending} onClick={clear}>Clear candidate filters</button>
      {pending && <button type="button" onClick={resumeEditing}>Resume editing this search</button>}
    </form>
    {showNavigationNotice && <p className="admin-candidate-state" role="alert">
      {navigationNotice === "LATE" ?
        "An earlier candidate page finished after editing resumed. Your unsubmitted search is preserved; review the URL before submitting." :
        "Results reflect your last submitted search. Your current edits have not been applied. Review the URL before submitting."}
    </p>}
    <p className="admin-candidate-state" role={displayState === "ERROR" || displayState === "INCOMPLETE" ||
      displayState === "INVALID_CURSOR" || displayState === "INVALID_QUERY" || displayState === "URL_PAUSED" ? "alert" : "status"}>
      {pending ? attempt?.phase === "SUPERSEDED" ?
        "Another page navigation took precedence. Resume editing to submit this search again." :
        attempt?.phase === "RECOVERABLE" ?
          "Candidate navigation did not commit. Resume editing to retry; the earlier request may still finish." :
          "Loading candidate page… Search controls are unavailable until navigation completes. Resume editing is available if navigation stalls; the request may still finish." :
        displayState === "URL_PAUSED" ? urlPausedCopy : stateCopy[result.state]}
      {query.search && ` · Search: ${query.search}`}{query.status !== "all" && ` · Status: ${query.status}`}
    </p>
    {actionFeedback && <p className="admin-candidate-state" role="alert">{actionFeedback}</p>}
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
            onClick={() => onVerify(item.productId)}>Verify Membership</button>}
          {membership === "NOT_VERIFIED" && canVerify && current?.phase === "RESULT" &&
            current.status === "NOT_MEMBER" &&
            <button type="button" disabled={pending} onClick={() => onAdd(item.productId)}>
              Add to Draft</button>}</td>
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
