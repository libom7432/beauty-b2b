// Copied only into the temporary Playwright project, never imported by production code.
import type { CatalogReadSource, AdminCollectionSourceRow, CollectionSourceQuery,
  CollectionSourcePage, AdminCollectionMemberSourceRow, PrivateCatalogBundle } from "@/lib/catalog-read/types";
import { createOfflineCatalogSource, notConfiguredCatalogSource } from "@/lib/catalog-read/offline";
import { CatalogReadError } from "@/lib/catalog-read/errors";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const updated = "2026-10-01T00:00:00.000Z";
const created = "2026-09-01T00:00:00.000Z";
const rows: AdminCollectionSourceRow[] = Array.from({ length: 32 }, (_, index) => {
  const number = index + 1;
  const status = number % 3 === 1 ? "draft" : number % 3 === 2 ? "published" : "retired";
  return { id: id(number), slug: `collection-${number}`,
    name_en: `Collection ${number}`, name_zh: `集合 ${number}`,
    description_en: number === 1 ? "" : "Test description",
    description_zh: number === 1 ? "" : "测试描述", status,
    sort_order: number, published_at: status === "published" ? updated : null,
    created_at: created, updated_at: updated };
});
const compare = (a: AdminCollectionSourceRow, b: AdminCollectionSourceRow) =>
  a.sort_order - b.sort_order || a.id.localeCompare(b.id);
const memberRows: AdminCollectionMemberSourceRow[] = Array.from({ length: 61 }, (_, index) => ({
  collection_id: id(1), product_id: id(index + 101), sort_order: index,
  product_code: `FAMILY-${index + 101}`, name_en: `Product ${index + 101}`,
  name_zh: `商品 ${index + 101}`, product_status: index === 0 ? "draft" : "published",
}));
memberRows.push({ collection_id: id(2), product_id: id(202), sort_order: 0,
  product_code: "FAMILY-202", name_en: "Draft Product", name_zh: "草稿商品", product_status: "draft" });

const productRows: PrivateCatalogBundle[] = Array.from({ length: 61 }, (_, index) => {
  const number = index + 101;
  const productId = id(number);
  const status = index % 3 === 0 ? "draft" as const :
    index % 3 === 1 ? "published" as const : "retired" as const;
  return { product: { id: productId, product_code: `FAMILY-${number}`,
    slug: `fixture-family-${number}`, product_type: "press-on", status,
    attributes: {}, customization_options: [], oem: false, odm: false,
    lead_time_min_days: null, lead_time_max_days: null, seo_indexable: false,
    featured: false, new_arrival: false, published_at: status === "published" ? updated : null,
    created_at: created, updated_at: updated },
    translations: [{ product_id: productId, locale: "en" as const, name: `Candidate ${number}`,
      short_description: "", description: "", seo_title: "", seo_description: "",
      created_at: created, updated_at: updated },
      { product_id: productId, locale: "zh" as const, name: `候选商品 ${number}`,
        short_description: "", description: "", seo_title: "", seo_description: "",
        created_at: created, updated_at: updated }],
    variants: [], categoryLinks: [], categories: [], images: [] };
});
const productSource = createOfflineCatalogSource(productRows);

export function createCollectionsFixtureSource(state: string): CatalogReadSource {
  const sourceRows = state === "collections-empty" ? [] : rows;
  return { ...notConfiguredCatalogSource,
    mode: "offline",
    async checkAdminCollectionMembership(collectionId: string, productId: string) {
      if (state === "collections-check-delay")
        await new Promise((resolve) => setTimeout(resolve, 1600));
      if (state === "collections-check-error") throw Error("private://membership-check-secret");
      return { collectionId, productId, complete: state !== "collections-check-incomplete",
        collectionExists: sourceRows.some((row) => row.id === collectionId),
        productExists: productRows.some((row) => row.product.id === productId),
        membershipExists: memberRows.some((row) => row.collection_id === collectionId &&
          row.product_id === productId) };
    },
    async listAdmin(query) {
      if (state === "collections-candidates-not-connected") throw new CatalogReadError("NOT_CONFIGURED");
      if (state === "collections-candidates-error") throw Error("private://candidate-source-secret");
      const page = await productSource.listAdmin(query);
      if (state === "collections-candidates-incomplete" && page.rows.length)
        return { ...page, rows: [page.rows[0], page.rows[0]] };
      return page;
    },
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
    async getAdminCollectionById(collectionId: string) {
      if (state === "collections-detail-error") throw Error("private://collections-secret");
      const found = sourceRows.find((row) => row.id === collectionId) ?? null;
      return { row: state === "collections-detail-not-found" ? null :
        state === "collections-long" && found?.id === id(1)
          ? { ...found, slug: `long-${"a".repeat(150)}`, name_en: `Name ${"N".repeat(150)}`,
              name_zh: `名称${"长".repeat(120)}` } : found,
        complete: state !== "collections-detail-incomplete" };
    },
    async listAdminCollectionMembers(query: CollectionSourceQuery) {
      if (state === "collections-members-error") throw Error("private://collections-secret");
      const eligible = state === "collections-members-empty" ? [] : memberRows.filter((row) =>
        row.collection_id === query.collectionId).map((row) => state === "collections-long" &&
          row.product_id === id(101) ? { ...row, product_code: `CODE-${"X".repeat(180)}`,
            name_en: `Product ${"P".repeat(160)}`, name_zh: `商品${"长".repeat(120)}` } : row);
      const boundary = query.boundary ? eligible.find((row) => row.product_id === query.boundary?.id &&
        row.sort_order === query.boundary.sortOrder) : null;
      const inRange = eligible.filter((row) => {
        if (!query.boundary) return true;
        const order = row.sort_order - query.boundary.sortOrder || row.product_id.localeCompare(query.boundary.id);
        return query.direction === "after" ? order >= (query.includeBoundary ? 0 : 1) :
          order <= (query.includeBoundary ? 0 : -1);
      }).sort((a, b) => a.sort_order - b.sort_order || a.product_id.localeCompare(b.product_id));
      const selected = query.direction === "before" ? inRange.slice(-query.limit - 1) :
        inRange.slice(0, query.limit + 1);
      const pageRows = state === "collections-members-not-found" ||
        state === "collections-members-empty-page" && query.boundary && !query.includeBoundary
        ? [] : selected;
      const window = { requestedRowCount: query.limit + 1, returnedRowCount: pageRows.length,
        exhausted: pageRows.length < query.limit + 1 };
      return { rows: pageRows, window: state === "collections-members-incomplete"
        ? { ...window, returnedRowCount: pageRows.length + 1 } : window,
        boundary: boundary ? { id: boundary.product_id, sortOrder: boundary.sort_order } : null,
        collectionExists: state !== "collections-members-not-found" &&
          sourceRows.some((row) => row.id === query.collectionId) };
    },
  };
}
