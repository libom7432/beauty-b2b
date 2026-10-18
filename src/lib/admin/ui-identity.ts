import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { CatalogImportError } from "../catalog-import/transaction.ts";
import { requireAdminIdentity } from "../catalog-import/admin-auth.ts";
import { createAdminAuthClient } from "./supabase-server.ts";
import { adminDependencies } from "./server-access.ts";

/** Request-scoped UI identity. The private directory remains the authority. */
export const getAdminUIIdentity = cache(async () => {
  const client = await createAdminAuthClient();
  if (!client) redirect("/admin/login");
  try {
    return await requireAdminIdentity(client, adminDependencies(client));
  } catch (error) {
    if (error instanceof CatalogImportError && error.code === "PERMISSION_DENIED") redirect("/admin/login?error=1");
    throw error;
  }
});
