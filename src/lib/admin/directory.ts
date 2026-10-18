import "server-only";
import { Pool } from "pg";
import type { CatalogAdminDirectory, AdminIdentity } from "../catalog-import/admin-auth.ts";
import { permissionsForRole, type AdminRole } from "./permissions.ts";

let pool: Pool | undefined;
function getPool(): Pool {
  if (pool) return pool;
  const raw = process.env.ADMIN_DIRECTORY_DATABASE_URL;
  if (!raw) throw new Error("Admin directory is not configured");
  const url = new URL(raw);
  const user = decodeURIComponent(url.username);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.password ||
    !(user === "admin_directory_runtime" || /^admin_directory_runtime\.[A-Za-z0-9_-]+$/.test(user)) ||
    url.search || url.hash) throw new Error("Admin directory configuration is invalid");
  pool = new Pool({ connectionString: raw, ssl: { rejectUnauthorized: true, servername: url.hostname },
    max: 2, connectionTimeoutMillis: 3000, query_timeout: 5000, idleTimeoutMillis: 10000,
    application_name: "admin_directory" });
  pool.on("error", () => {});
  return pool;
}

type Row = { id: string; auth_user_id: string; status: "active" | "disabled";
  role: AdminRole; created_at: Date | string; disabled_at: Date | string | null };

export const adminDirectory: CatalogAdminDirectory = {
  async findByProviderIdentity(identity): Promise<AdminIdentity | null> {
    if (identity.identity_provider !== "supabase" || !/^[0-9a-f-]{36}$/i.test(identity.provider_subject)) return null;
    const client = await getPool().connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL ROLE admin_directory_reader");
      const result = await client.query<Row>(`SELECT id, auth_user_id, status, role, created_at, disabled_at
        FROM admin_private.admin_users WHERE auth_user_id = $1`, [identity.provider_subject]);
      await client.query("COMMIT");
      const row = result.rows[0];
      if (!row) return null;
      return { admin_id: row.id, identity_provider: "supabase", provider_subject: row.auth_user_id,
        status: row.status, created_at: new Date(row.created_at).toISOString(),
        disabled_at: row.disabled_at ? new Date(row.disabled_at).toISOString() : null,
        permissions: permissionsForRole(row.role) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  },
};
