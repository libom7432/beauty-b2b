import type { CatalogPermission } from "../catalog-import/admin-auth.ts";

export type AdminRole = "super_admin" | "catalog_editor";
const all: readonly CatalogPermission[] = [
  "catalog.read", "catalog.create", "catalog.update", "catalog.publish", "catalog.retire",
  "catalog.images.manage", "catalog.import.preview", "catalog.import.commit",
  "catalog.import.receipt.read", "catalog.import.receipts.read",
];
const editor: readonly CatalogPermission[] = [
  "catalog.read", "catalog.create", "catalog.update", "catalog.images.manage",
  "catalog.import.preview", "catalog.import.receipt.read", "catalog.import.receipts.read",
];

export function permissionsForRole(role: AdminRole): readonly CatalogPermission[] {
  return role === "super_admin" ? all : role === "catalog_editor" ? editor : [];
}
