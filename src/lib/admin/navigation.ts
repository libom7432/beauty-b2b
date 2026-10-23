import type { CatalogPermission } from "../catalog-import/admin-auth.ts";

export type AdminNavItem = Readonly<{
  href: string;
  label: string;
  number: string;
  permission?: CatalogPermission;
}>;

export const ADMIN_NAVIGATION: readonly AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", number: "01" },
  { href: "/admin/products", label: "Products", number: "02", permission: "catalog.read" },
  { href: "/admin/categories", label: "Categories", number: "03", permission: "catalog.read" },
  { href: "/admin/collections", label: "Collections", number: "04", permission: "catalog.read" },
  { href: "/admin/media", label: "Media", number: "05", permission: "catalog.read" },
  { href: "/admin/imports", label: "Imports", number: "06", permission: "catalog.import.receipt.read" },
];

export function visibleAdminNavigation(permissions: readonly CatalogPermission[]): readonly AdminNavItem[] {
  return ADMIN_NAVIGATION.filter((item) => !item.permission || permissions.includes(item.permission));
}

// Matches the UUID syntax used by the collection detail route, without importing its server-only cursor module.
const ADMIN_COLLECTION_DETAIL_PATH = /^\/admin\/collections\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAdminCollectionDetailPath(pathname: string): boolean {
  return ADMIN_COLLECTION_DETAIL_PATH.test(pathname);
}

export function adminRouteLabel(pathname: string): string {
  if (pathname.startsWith("/admin/products/")) return "Product detail";
  if (isAdminCollectionDetailPath(pathname)) return "Collection detail";
  return ADMIN_NAVIGATION.find((item) => item.href === pathname)?.label ?? "Admin";
}
