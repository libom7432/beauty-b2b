/** Server-side catalog administrator identity and authorization contract. No provider or database is configured here. */
import { CatalogImportError, verifyCatalogActorContext, type ActorContext } from "./transaction.ts";

export const CATALOG_PERMISSIONS = [
  "catalog.import.preview",
  "catalog.import.commit",
  "catalog.import.receipt.read",
] as const;
export type CatalogPermission = (typeof CATALOG_PERMISSIONS)[number];
export type AdminIdentity = Readonly<{
  admin_id: string;
  identity_provider: string;
  provider_subject: string;
  status: "active" | "disabled";
  created_at: string;
  disabled_at: string | null;
  permissions: readonly CatalogPermission[];
}>;
export type VerifiedProviderIdentity = Readonly<{ identity_provider: string; provider_subject: string }>;

/** Implement only in a trusted server module; never accept a client-supplied identity as this result. */
export interface CatalogIdentityProvider {
  verifySession(session: unknown): Promise<VerifiedProviderIdentity | null>;
}
/** A private server-side directory maps a verified provider subject to a stable internal administrator ID. */
export interface CatalogAdminDirectory {
  findByProviderIdentity(identity: VerifiedProviderIdentity): Promise<AdminIdentity | null>;
}
export type CatalogAuthDependencies = Readonly<{
  provider: CatalogIdentityProvider;
  directory: CatalogAdminDirectory;
}>;
export type AuthorizedCatalogActor = Readonly<{
  admin_id: string;
  actor_id: string;
  permission: CatalogPermission;
}>;
export type AuthorizedCatalogCommit = AuthorizedCatalogActor & Readonly<{
  permission: "catalog.import.commit";
  actor_context: ActorContext;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied = (): never => { throw new CatalogImportError("PERMISSION_DENIED"); };
const validDate = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/** Recheck account state and grants on every request. The caller must supply trusted server adapters. */
export function requireCatalogPermission(
  session: unknown,
  permission: "catalog.import.commit",
  dependencies: CatalogAuthDependencies,
): Promise<AuthorizedCatalogCommit>;
export function requireCatalogPermission(
  session: unknown,
  permission: CatalogPermission,
  dependencies: CatalogAuthDependencies,
): Promise<AuthorizedCatalogActor>;
export async function requireCatalogPermission(
  session: unknown,
  permission: CatalogPermission,
  dependencies: CatalogAuthDependencies,
): Promise<AuthorizedCatalogActor | AuthorizedCatalogCommit> {
  if (!CATALOG_PERMISSIONS.includes(permission) || !dependencies?.provider?.verifySession || !dependencies?.directory?.findByProviderIdentity)
    return denied();
  const verified = await dependencies.provider.verifySession(session);
  if (!verified || typeof verified.identity_provider !== "string" || !verified.identity_provider.trim()
    || typeof verified.provider_subject !== "string" || !verified.provider_subject.trim()) return denied();
  const admin = await dependencies.directory.findByProviderIdentity(verified);
  if (!admin || admin.identity_provider !== verified.identity_provider || admin.provider_subject !== verified.provider_subject
    || !UUID.test(admin.admin_id) || admin.status !== "active" || admin.disabled_at !== null
    || !validDate(admin.created_at) || !Array.isArray(admin.permissions) || !admin.permissions.includes(permission)) return denied();
  if (permission !== "catalog.import.commit")
    return Object.freeze({ admin_id: admin.admin_id, actor_id: admin.admin_id, permission });
  const actor_context = await verifyCatalogActorContext(null, async () => ({ actor_id: admin.admin_id, role: "catalog_import" }));
  return Object.freeze({ admin_id: admin.admin_id, actor_id: admin.admin_id, permission, actor_context });
}
