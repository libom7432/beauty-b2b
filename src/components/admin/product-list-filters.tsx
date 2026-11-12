"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AdminCategoryOptions } from "@/lib/catalog-read/types";
import type { AdminProductsUrlQuery } from "@/lib/admin/products-query";
import { useAdminUnsavedChanges } from "./admin-unsaved-changes";

type Fields = Pick<AdminProductsUrlQuery, "search" | "status" | "category" | "sort">;
type ClearAttempt = { id: number; origin: string; committedKey: string; target: "/admin/products" };
const clean: Fields = { search: "", status: "all", category: "", sort: "updated_desc" };
const fieldsOf = (query: AdminProductsUrlQuery): Fields => ({
  search: query.search, status: query.status, category: query.category, sort: query.sort,
});
const fieldKey = (fields: Fields) => JSON.stringify(fields);
const committedQueryKey = (query: AdminProductsUrlQuery) => JSON.stringify([
  fieldsOf(query), query.cursor, query.direction, query.page,
]);
const historyFields = (): Fields => {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("status");
  const sort = params.get("sort");
  return {
    search: (params.get("q") ?? "").trim(),
    status: status === "draft" || status === "published" || status === "retired" ? status : "all",
    category: params.get("category") ?? "",
    sort: sort === "updated_asc" || sort === "product_code_asc" || sort === "product_code_desc"
      ? sort : "updated_desc",
  };
};

export function ProductListFilters({ query, categories, categoryOptionsUnavailable = false }: {
  query: AdminProductsUrlQuery; categories?: AdminCategoryOptions; categoryOptionsUnavailable?: boolean;
}) {
  const pathname = usePathname();
  const { requestNavigation, isNavigationBusy, resumeNavigation } = useAdminUnsavedChanges();
  const searchParams = useSearchParams();
  const locationKey = `${pathname}?${searchParams.toString()}`;
  const serverFields = fieldsOf(query);
  const serverKey = fieldKey(serverFields);
  const committedKey = committedQueryKey(query);
  const [editable, setEditable] = useState<Fields>(serverFields);
  const [pending, setPending] = useState(false);
  const [recoverable, setRecoverable] = useState(false);
  const attemptRef = useRef<ClearAttempt | null>(null);
  const nextAttemptId = useRef(0);
  const observedServerKey = useRef(serverKey);
  const preserveLateClear = useRef(false);

  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      attemptRef.current = null;
      preserveLateClear.current = false;
      setPending(false);
      setRecoverable(false);
      setEditable(fieldsOf(query));
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, [query]);

  useEffect(() => {
    const restoreHistory = () => {
      attemptRef.current = null;
      preserveLateClear.current = false;
      setPending(false);
      setRecoverable(false);
      setEditable(historyFields());
    };
    window.addEventListener("popstate", restoreHistory);
    return () => window.removeEventListener("popstate", restoreHistory);
  }, []);

  useEffect(() => {
    const attempt = attemptRef.current;
    const clearCommitted = pathname === "/admin/products" && searchParams.toString() === "" &&
      serverKey === fieldKey(clean);
    if (attempt && clearCommitted) {
      attemptRef.current = null;
      observedServerKey.current = serverKey;
      preserveLateClear.current = false;
      setEditable(clean);
      setPending(false);
      setRecoverable(false);
      return;
    }
    if (attempt && committedKey !== attempt.committedKey) {
      // A different server query committed while Clear was in flight. Its
      // result now owns the form; the old Clear response may still arrive.
      attemptRef.current = null;
      observedServerKey.current = serverKey;
      preserveLateClear.current = false;
      setEditable(serverFields);
      setPending(false);
      setRecoverable(false);
      return;
    }
    if (serverKey !== observedServerKey.current) {
      observedServerKey.current = serverKey;
      if (preserveLateClear.current && clearCommitted) {
        preserveLateClear.current = false;
        setRecoverable(false);
      } else if (!attempt) {
        preserveLateClear.current = false;
        setEditable(serverFields);
        setRecoverable(false);
      }
    }
  }, [locationKey, pathname, searchParams, serverKey, serverFields, committedKey]);

  const beginClear = (event: { preventDefault(): void }) => {
    event.preventDefault();
    // A resumed request can still commit. Do not attach a second Clear attempt to its target.
    if (attemptRef.current || preserveLateClear.current || isNavigationBusy()) return;
    if (pathname === "/admin/products" && searchParams.toString() === "" &&
      serverKey === fieldKey(clean)) {
      setEditable(clean);
      setRecoverable(false);
      return;
    }
    const result = requestNavigation({ type: "PUSH", scope: "CURRENT", target: "/admin/products",
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null });
    if (result !== "EXECUTED") return;
    attemptRef.current = { id: ++nextAttemptId.current, origin: locationKey,
      committedKey, target: "/admin/products" };
    preserveLateClear.current = false;
    setRecoverable(false);
    setPending(true);
  };

  const resumeEditing = () => {
    if (!attemptRef.current) return;
    if (isNavigationBusy() && !resumeNavigation("/admin/products")) return;
    attemptRef.current = null;
    preserveLateClear.current = true;
    setPending(false);
    setRecoverable(true);
  };

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (attemptRef.current) return;
    const params = new URLSearchParams({ q: editable.search, status: editable.status,
      category: editable.category, sort: editable.sort });
    requestNavigation({ type: "PUSH", scope: "CURRENT",
      target: `/admin/products?${params.toString()}`,
      trigger: (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null });
  };

  return <form className="admin-product-filters" action="/admin/products" method="get" role="search"
    aria-busy={pending} onSubmit={applyFilters}>
    <fieldset disabled={pending} style={{ display: "contents" }}>
      <label>Search products<input aria-label="Search products" name="q" type="search" maxLength={100}
        value={editable.search} onChange={(event) => setEditable({ ...editable, search: event.target.value })}
        placeholder="Code or English / Chinese name" /></label>
      <label>Status<select aria-label="Status" name="status" value={editable.status}
        onChange={(event) => setEditable({ ...editable, status: event.target.value as Fields["status"] })}>
        <option value="all">All</option><option value="draft">Draft</option>
        <option value="published">Published</option><option value="retired">Retired</option>
      </select></label>
      <label>Primary category<select aria-label="Primary category" name="category" value={editable.category}
        onChange={(event) => setEditable({ ...editable, category: event.target.value })}>
        <option value="">All categories</option>
        {editable.category && !categories?.items.some((item) => item.id === editable.category) &&
          <option value={editable.category}>Selected category unavailable</option>}
        {categories?.items.map((item) => <option key={item.id} value={item.id}>{item.nameEn || item.nameZh || item.id}</option>)}
      </select></label>
      <label>Sort by<select aria-label="Sort by" name="sort" value={editable.sort}
        onChange={(event) => setEditable({ ...editable, sort: event.target.value as Fields["sort"] })}>
        <option value="updated_desc">Recently updated</option>
        <option value="updated_asc">Oldest updated</option>
        <option value="product_code_asc">Product code A–Z</option>
        <option value="product_code_desc">Product code Z–A</option>
      </select></label>
      <div className="admin-product-filter-actions"><button type="submit">Apply Filters</button>
        <Link href="/admin/products" prefetch={false} aria-disabled={pending || recoverable}
          onNavigate={beginClear}>Clear Filters</Link></div>
    </fieldset>
    {pending && <div role="status">Clearing filters. Wait for the updated products, or resume editing if navigation does not finish.</div>}
    {pending && <button type="button" onClick={resumeEditing}>Resume editing filters</button>}
    {recoverable && <p role="status">Editing resumed. The earlier Clear Filters request may still finish. Use Apply Filters to submit your edits.</p>}
    {categories?.hasMore && <p className="admin-category-limit">Only the first 50 primary categories are available in this selector.</p>}
    {categoryOptionsUnavailable && <p className="admin-category-limit">Primary category options are not connected.</p>}
  </form>;
}
