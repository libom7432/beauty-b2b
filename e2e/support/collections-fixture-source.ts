// Copied only into the temporary Playwright project, never imported by production code.
import type { CatalogReadSource, AdminCollectionSourceRow, CollectionSourceQuery,
  CollectionSourcePage } from "@/lib/catalog-read/types";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const updated = "2026-10-01T00:00:00.000Z";
const rows: AdminCollectionSourceRow[] = Array.from({ length: 32 }, (_, index) => {
  const number = index + 1;
  const status = number % 3 === 1 ? "draft" : number % 3 === 2 ? "published" : "retired";
  return { id: id(number), slug: `collection-${number}`,
    name_en: `Collection ${number}`, name_zh: `集合 ${number}`,
    description_en: "Test description", description_zh: "测试描述", status,
    sort_order: number, published_at: status === "published" ? updated : null,
    updated_at: updated };
});
const compare = (a: AdminCollectionSourceRow, b: AdminCollectionSourceRow) =>
  a.sort_order - b.sort_order || a.id.localeCompare(b.id);

export function createCollectionsFixtureSource(state: string): CatalogReadSource {
  const sourceRows = state === "collections-empty" ? [] : rows;
  return {
    mode: "offline",
    async listAdminCollections(query: CollectionSourceQuery): Promise<CollectionSourcePage<AdminCollectionSourceRow>> {
      if (state === "collections-error") throw Error("private://collections-secret");
      const eligible = sourceRows.filter((row) => !query.status || row.status === query.status);
      const boundary = query.boundary ? eligible.find((row) => row.id === query.boundary?.id &&
        row.sort_order === query.boundary.sortOrder) : null;
      const inRange = eligible.filter((row) => {
        if (!query.boundary) return true;
        const order = row.sort_order - query.boundary.sortOrder || row.id.localeCompare(query.boundary.id);
        return query.direction === "after" ? order >= (query.includeBoundary ? 0 : 1) :
          order <= (query.includeBoundary ? 0 : -1);
      }).sort(compare);
      const selected = query.direction === "before" ? inRange.slice(-query.limit - 1) :
        inRange.slice(0, query.limit + 1);
      const pageRows = state === "collections-empty-page" && query.boundary && !query.includeBoundary ? [] : selected;
      const window = { requestedRowCount: query.limit + 1, returnedRowCount: pageRows.length,
        exhausted: pageRows.length < query.limit + 1 };
      if (state === "collections-incomplete")
        return { rows: pageRows, window: { ...window, returnedRowCount: pageRows.length + 1 },
          boundary: boundary ? { id: boundary.id, sortOrder: boundary.sort_order } : null };
      return { rows: pageRows, window,
        boundary: boundary ? { id: boundary.id, sortOrder: boundary.sort_order } : null };
    },
  } as CatalogReadSource;
}
