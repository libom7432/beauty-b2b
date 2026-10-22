"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AdminBadge, AdminPageHeader } from "./ui";
import type { AdminCategoryDTO, AdminCategoryReadResult } from "@/lib/catalog-read/types";

const compare = (a: AdminCategoryDTO, b: AdminCategoryDTO) =>
  a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const label = (item: AdminCategoryDTO) => item.nameEn || item.nameZh || item.slug;
const issueText: Record<string, string> = {
  DUPLICATE_ID: "Duplicate category UUID", MISSING_PARENT: "Parent category is missing",
  CYCLE: "Category ancestry contains a cycle", UNREACHABLE: "Category cannot reach a root",
  DEPTH_OVER_3: "Category exceeds the three-level business target",
  INVALID_ROW: "Category row is invalid", COUNT_MISMATCH: "Category set is truncated or cannot be proven complete",
};

export function AdminCategoryTree({ result }: { result: AdminCategoryReadResult }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const treeIds = useMemo(() => new Set(result.treeIds), [result.treeIds]);
  const byId = useMemo(() => new Map(result.items.filter((item) => treeIds.has(item.id))
    .map((item) => [item.id, item])), [result.items, treeIds]);
  const children = useMemo(() => {
    const groups = new Map<string | null, AdminCategoryDTO[]>();
    for (const item of byId.values()) groups.set(item.parentId,
      [...(groups.get(item.parentId) ?? []), item]);
    for (const group of groups.values()) group.sort(compare);
    return groups;
  }, [byId]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const path = (item: AdminCategoryDTO) => {
    const names = [label(item)];
    let cursor = item.parentId;
    while (cursor) {
      const parent = byId.get(cursor);
      if (!parent) break;
      names.unshift(label(parent));
      cursor = parent.parentId;
    }
    return names.join(" / ");
  };
  const needle = search.trim().toLocaleLowerCase();
  const matches = needle ? [...byId.values()].filter((item) =>
    [item.nameEn, item.nameZh, item.slug].some((value) => value.toLocaleLowerCase().includes(needle)))
    .sort(compare) : [];
  const toggle = (id: string) => setCollapsed((prior) => {
    const next = new Set(prior);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const renderBranch = (parentId: string | null): ReactNode => <ul className="admin-category-branches">
    {(children.get(parentId) ?? []).map((item) => {
      const nested = children.get(item.id) ?? [];
      const isCollapsed = collapsed.has(item.id);
      return <li key={item.id}>
        <div className="admin-category-row">
          {nested.length ? <button type="button" aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${label(item)}`}
            aria-expanded={!isCollapsed} onClick={() => toggle(item.id)}>{isCollapsed ? "+" : "−"}</button>
            : <span className="admin-category-spacer" aria-hidden="true" />}
          <button type="button" className="admin-category-select" aria-current={selectedId === item.id ? "true" : undefined}
            onClick={() => setSelectedId(item.id)}>{label(item)}</button>
          <span className="admin-category-status">{item.status}</span>
        </div>
        {nested.length > 0 && !isCollapsed && renderBranch(item.id)}
      </li>;
    })}
  </ul>;

  return <>
    <AdminPageHeader eyebrow="CATALOG / CATEGORIES" title="Categories"
      description="Review the read-only category hierarchy and its existing fields.">
      <AdminBadge tone="warning">READ ONLY / NOT CONNECTED FOR WRITES</AdminBadge>
    </AdminPageHeader>
    {result.state === "NOT_CONNECTED" ? <section className="admin-card" role="status">
      <h2>Category database not connected</h2><p>No category records were loaded.</p>
    </section> : result.state === "ERROR" ? <section className="admin-card" role="alert">
      <h2>Categories unavailable</h2><p>The read-only category source could not be read.</p>
    </section> : <>
      <p className="admin-category-provenance">{result.origin === "OFFLINE_FIXTURE"
        ? "Isolated offline test data" : "Read-only category database"}</p>
      {result.state === "INCOMPLETE" && <p className="admin-category-notice" role="status">
        Category data is incomplete. This is not a verified full hierarchy.</p>}
      {result.items.length === 0 && result.state === "COMPLETE" ? <section className="admin-card" role="status">
        <h2>No categories</h2><p>The complete category set is empty.</p>
      </section> : <div className="admin-category-layout">
        <section className="admin-card" aria-label="Category hierarchy">
          <h2>Category hierarchy</h2>
          <label className="admin-category-search">Search categories
            <input value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="English, 中文 or slug" />
          </label>
          {needle ? <ul className="admin-category-search-results">{matches.map((item) => <li key={item.id}>
            <button type="button" onClick={() => setSelectedId(item.id)}>{path(item)}</button>
          </li>)}</ul> : renderBranch(null)}
          {needle && matches.length === 0 && <p>No matching categories in the loaded set.</p>}
          {!needle && treeIds.size === 0 && <p>No verifiable category roots in the loaded set.</p>}
        </section>
        <section className="admin-card" aria-label="Category detail">
          <h2>Category detail</h2>
          {selected ? <dl className="admin-detail-list">
            <div><dt>UUID</dt><dd>{selected.id}</dd></div>
            <div><dt>Path</dt><dd>{path(selected)}</dd></div>
            <div><dt>Slug</dt><dd>{selected.slug}</dd></div>
            <div><dt>Status</dt><dd>{selected.status}</dd></div>
            <div><dt>English name</dt><dd>{selected.nameEn || "Not provided"}</dd></div>
            <div><dt>中文名称</dt><dd>{selected.nameZh || "未提供"}</dd></div>
            <div><dt>English description</dt><dd>{selected.descriptionEn || "Not provided"}</dd></div>
            <div><dt>中文描述</dt><dd>{selected.descriptionZh || "未提供"}</dd></div>
            <div><dt>Sort order</dt><dd>{selected.sortOrder}</dd></div>
          </dl> : <p>Select a category to view its read-only fields.</p>}
        </section>
      </div>}
      {result.issues.length > 0 && <section className="admin-card admin-category-diagnostics" aria-label="Category diagnostics">
        <h2>Category diagnostics</h2><ul>{result.issues.map((issue, index) => <li key={`${issue.code}-${issue.categoryId}-${index}`}>
          {issueText[issue.code]}{issue.categoryId ? ` · ${issue.categoryId}` : ""}
        </li>)}</ul>
      </section>}
    </>}
  </>;
}
