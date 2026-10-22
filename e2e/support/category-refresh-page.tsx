"use client";

import { useState } from "react";
import { AdminCategoryTree } from "@/components/admin/admin-category-tree";
import type { AdminCategoryDTO, AdminCategoryReadResult } from "@/lib/catalog-read/types";

// Copied into the isolated Playwright app only. It never enters the production route tree.
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const category = (n: number, name: string, parentId: string | null = null): AdminCategoryDTO => ({
  id: id(n), parentId, slug: name.toLowerCase().replaceAll(" ", "-"), status: "published",
  nameEn: name, nameZh: `分类 ${n}`, descriptionEn: "Original description",
  descriptionZh: "原始描述", sortOrder: n,
});
const a = category(1, "Category A");
const b = category(2, "Category B");
const c = category(3, "Category C", b.id);
const read = (items: AdminCategoryDTO[], state: "COMPLETE" | "INCOMPLETE" = "COMPLETE"):
  AdminCategoryReadResult => ({ state, items, treeIds: items.map((item) => item.id),
    totalCount: items.length, origin: "OFFLINE_FIXTURE", issues: [] });

export default function CategoryRefreshFixturePage() {
  const [result, setResult] = useState<AdminCategoryReadResult>(() => read([a, b, c]));
  return <>
    <div role="group" aria-label="Fixture source updates">
      <button type="button" onClick={() => setResult(read([b, c]))}>Remove A from source</button>
      <button type="button" onClick={() => setResult(read([{ ...a, nameEn: "Server changed A" }, b, c]))}>Update A in source</button>
      <button type="button" onClick={() => setResult(read([{ ...c }, { ...b }, { ...a }]))}>Reorder source</button>
      <button type="button" onClick={() => setResult(read([a, b, c], "INCOMPLETE"))}>Incomplete source</button>
      <button type="button" onClick={() => setResult({ state: "NOT_CONNECTED", items: [], treeIds: [],
        issues: [], totalCount: null, origin: "NONE" })}>Disconnect source</button>
      <button type="button" onClick={() => setResult({ state: "ERROR", items: [], treeIds: [],
        issues: [], totalCount: null, origin: "NONE" })}>Fail source</button>
    </div>
    <AdminCategoryTree result={result} />
  </>;
}
