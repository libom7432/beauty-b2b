import "server-only";
import pg from "pg";
import { CatalogReadError } from "./errors.ts";
import { createPostgresCatalogReadSource, type ReadSnapshot } from "./postgres-core.ts";
import { requireLocalCatalogReadUrl } from "./postgres-local-config.ts";

/** This entry is deliberately not wired into server.ts or any route in B4-A. */
export function createLocalPostgresCatalogReadSource() {
  const value = requireLocalCatalogReadUrl(process.env.CATALOG_READ_LOCAL_DATABASE_URL, process.env.NODE_ENV);

  const pool = new pg.Pool({ connectionString: value, max: 3, idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 2_000, query_timeout: 5_000, statement_timeout: 5_000, ssl: false });
  const snapshot: ReadSnapshot = async (work) => {
    let client: pg.PoolClient;
    try { client = await pool.connect(); }
    catch { throw new CatalogReadError("NOT_CONFIGURED"); }
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
      try { await client.query("ROLLBACK"); } catch { /* Connection is discarded by the pool. */ }
      if (error instanceof CatalogReadError) throw error;
      throw new CatalogReadError("SOURCE_UNAVAILABLE");
    } finally { client.release(); }
  };
  return { source: createPostgresCatalogReadSource(snapshot), close: () => pool.end() };
}
