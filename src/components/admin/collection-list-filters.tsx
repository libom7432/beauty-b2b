"use client";

import type { FormEvent } from "react";
import type { AdminCollectionsUrlQuery } from "@/lib/admin/collections-query";
import { useAdminUnsavedChanges, GuardedAdminLink } from "./admin-unsaved-changes";

export function CollectionListFilters({ query }: { query: AdminCollectionsUrlQuery }) {
  const { requestNavigation } = useAdminUnsavedChanges();
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = new FormData(event.currentTarget).get("status");
    if (raw !== "all" && raw !== "draft" && raw !== "published" && raw !== "retired") return;
    const target = raw === "all" ? "/admin/collections" : `/admin/collections?status=${raw}`;
    requestNavigation({ type: "PUSH", scope: "CURRENT", target,
      trigger: (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null });
  };
  return <form action="/admin/collections" method="get" className="admin-collection-filters" onSubmit={apply}>
    <label>Status <select name="status" defaultValue={query.status} aria-label="Collection status">
      <option value="all">All statuses</option><option value="draft">Draft</option>
      <option value="published">Published</option><option value="retired">Retired</option>
    </select></label>
    <button type="submit">Apply filter</button>
    <GuardedAdminLink href="/admin/collections">Clear filters</GuardedAdminLink>
    <p>Name and Slug search is unavailable until a bounded server-side query is approved.</p>
  </form>;
}
