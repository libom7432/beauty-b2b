import type { AdminCategoryDTO, AdminCategoryIssue, AdminCategorySourceResult,
  AdminCategorySourceRow } from "./types.ts";

export const MAX_ADMIN_CATEGORIES = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = new Set(["draft", "published", "retired"]);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Only these catalog columns cross the Admin render boundary. */
function safeCategory(row: AdminCategorySourceRow): AdminCategoryDTO | null {
  if (!row || !UUID.test(row.id) || row.parent_id !== null && !UUID.test(row.parent_id) ||
    typeof row.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug) ||
    !STATUS.has(row.status) || ![row.name_en, row.name_zh, row.description_en,
      row.description_zh].every((value) => typeof value === "string") ||
    !Number.isInteger(row.sort_order) || Math.abs(row.sort_order) > 2147483647) return null;
  return { id: row.id, parentId: row.parent_id, slug: row.slug, status: row.status,
    nameEn: row.name_en, nameZh: row.name_zh, descriptionEn: row.description_en,
    descriptionZh: row.description_zh, sortOrder: row.sort_order };
}

export function inspectAdminCategories(result: AdminCategorySourceResult) {
  const issues: AdminCategoryIssue[] = [];
  const add = (code: AdminCategoryIssue["code"], categoryId: string | null) =>
    issues.push({ code, categoryId });
  const items: AdminCategoryDTO[] = [];
  // The optional 501st row proves truncation; it must never reach the client DTO.
  for (const row of result.rows.slice(0, MAX_ADMIN_CATEGORIES)) {
    const safe = safeCategory(row);
    if (safe) items.push(safe);
    else add("INVALID_ROW", typeof row?.id === "string" ? row.id : null);
  }
  items.sort((a, b) => a.sortOrder - b.sortOrder || compare(a.id, b.id));
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  for (const [id, count] of counts) if (count > 1) add("DUPLICATE_ID", id);
  const unique = new Map(items.filter((item) => counts.get(item.id) === 1).map((item) => [item.id, item]));
  const treeIds: string[] = [];
  for (const item of items) {
    if (counts.get(item.id) !== 1) continue;
    let cursor: AdminCategoryDTO | undefined = item;
    const visited = new Set<string>();
    let depth = 0;
    let valid = true;
    while (cursor) {
      if (visited.has(cursor.id)) { add("CYCLE", item.id); valid = false; break; }
      visited.add(cursor.id);
      depth++;
      if (!cursor.parentId) break;
      const parent: AdminCategoryDTO | undefined = unique.get(cursor.parentId);
      if (!parent) { add(cursor === item ? "MISSING_PARENT" : "UNREACHABLE", item.id);
        valid = false; break; }
      cursor = parent;
    }
    if (valid) {
      treeIds.push(item.id);
      if (depth > 3) add("DEPTH_OVER_3", item.id);
    }
  }
  if (!result.allCategories || !Number.isSafeInteger(result.totalCount) ||
    result.totalCount! < 0 || result.totalCount !== result.rows.length ||
    result.rows.length > MAX_ADMIN_CATEGORIES) add("COUNT_MISMATCH", null);
  return { items, treeIds, issues,
    state: issues.some((issue) => issue.code !== "DEPTH_OVER_3") ? "INCOMPLETE" as const : "COMPLETE" as const,
    totalCount: Number.isSafeInteger(result.totalCount) ? result.totalCount : null };
}
