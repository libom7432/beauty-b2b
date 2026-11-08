import "server-only";
import { cache } from "react";
import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { CatalogImportError } from "../catalog-import/transaction.ts";
import { requireAdminIdentity } from "../catalog-import/admin-auth.ts";
import { createAdminAuthClient } from "./supabase-server.ts";
import { adminDependencies } from "./server-access.ts";
import { COLLECTION_UUID } from "../catalog-read/collections-cursor.ts";

/** A verified login session, distinct from a refreshed access token. */
export const readAdminUISession = cache(async () => {
  const client = await createAdminAuthClient();
  if (!client) return null;
  const admin = await requireAdminIdentity(client, adminDependencies(client));
  const { data, error } = await client.auth.getClaims();
  const claims = data?.claims;
  if (error || claims?.sub !== admin.provider_subject ||
    typeof claims.session_id !== "string" || !COLLECTION_UUID.test(claims.session_id))
    throw new CatalogImportError("PERMISSION_DENIED");
  return { admin, sessionKey: createHash("sha256").update(claims.session_id).digest("hex") };
});

export const getAdminUISession = cache(async () => {
  try {
    const session = await readAdminUISession();
    if (!session) redirect("/admin/login");
    return session;
  } catch (error) {
    if (error instanceof CatalogImportError && error.code === "PERMISSION_DENIED") redirect("/admin/login?error=1");
    throw error;
  }
});

/** Request-scoped UI identity. The private directory remains the authority. */
export const getAdminUIIdentity = cache(async () => {
  return (await getAdminUISession()).admin;
});
