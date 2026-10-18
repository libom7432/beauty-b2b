import "server-only";
import { redirect } from "next/navigation";
import { createAdminAuthClient } from "./supabase-server.ts";
import { adminDirectory } from "./directory.ts";
import { checkAdminAccess } from "./access.ts";
import type { CatalogAuthDependencies, CatalogPermission } from "../catalog-import/admin-auth.ts";

export type AuthClient = NonNullable<Awaited<ReturnType<typeof createAdminAuthClient>>>;
export function adminDependencies(client: AuthClient): CatalogAuthDependencies {
  return { provider: { async verifySession() {
    const { data, error } = await client.auth.getUser();
    return !error && data.user ? { identity_provider: "supabase", provider_subject: data.user.id } : null;
  } }, directory: adminDirectory };
}

export async function requireAdminPage(permission?: CatalogPermission) {
  const client = await createAdminAuthClient();
  if (!client) redirect("/admin/login");
  const access = await checkAdminAccess(client, adminDependencies(client), permission);
  if (access === "anonymous") redirect("/admin/login");
  if (access !== "allowed") redirect("/admin/login?error=1");
}
