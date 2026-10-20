import "server-only";
import pg from "pg";
import { CatalogReadError } from "./errors.ts";
import { createPostgresCatalogReadSource, type ReadSnapshot } from "./postgres-core.ts";
import { requireSupabaseCatalogConfig } from "./postgres-supabase-config.ts";

type SourceHandle = ReturnType<typeof createPostgresCatalogReadSource>;
let handle: SourceHandle | undefined;

/** Lazily constructs one bounded pool per Node process; no connection occurs at import time. */
export function getSupabaseCatalogReadSource(): SourceHandle {
  if (handle) return handle;
  const config = requireSupabaseCatalogConfig(process.env);
  const pool = new pg.Pool({ host: config.host, port: config.port, database: config.database,
    user: config.user, password: config.password, max: config.poolMax,
    ssl: { ca: config.ca, rejectUnauthorized: true, servername: config.host },
    connectionTimeoutMillis: 3_000, query_timeout: 5_000, statement_timeout: 5_000,
    idleTimeoutMillis: 10_000, allowExitOnIdle: true,
    application_name: "catalog_admin_read" });
  pool.on("error", () => { /* Idle errors are reported as SOURCE_UNAVAILABLE on the next read. */ });
  const snapshot: ReadSnapshot = async (work) => {
    let client: pg.PoolClient;
    try { client = await pool.connect(); }
    catch { throw new CatalogReadError("SOURCE_UNAVAILABLE"); }
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await work({ select: async <T>(sql: string, values: readonly unknown[]) => {
        if (!/^\s*(?:SELECT|WITH RECURSIVE)\b/i.test(sql) || sql.includes(";"))
          throw new CatalogReadError("INTERNAL_ERROR");
        const response = await client.query<T & pg.QueryResultRow>(sql, [...values]);
        return response.rows;
      } });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* The pool discards broken connections. */ }
      if (error instanceof CatalogReadError) throw error;
      throw new CatalogReadError("SOURCE_UNAVAILABLE");
    } finally { client.release(); }
  };
  handle = createPostgresCatalogReadSource(snapshot);
  return handle;
}
