import "server-only";
import pg from "pg";
import { CatalogReadError } from "../catalog-read/errors.ts";
import { createRFQPublicCatalogReader, createRFQPublicReadSnapshot,
  requireRFQPublicCatalogConfig } from "./catalog-public-postgres.ts";
import type { RFQPublicCatalogLookup } from "./types.ts";

let reader: RFQPublicCatalogLookup | undefined;

/** The controlled server-only constructor accepts an already validated public config.
 * Pool construction is lazy in callers; no connection is opened at module import. */
export function createServerRFQPublicCatalogReader(config: ReturnType<typeof requireRFQPublicCatalogConfig>): RFQPublicCatalogLookup {
  const pool = new pg.Pool({ host: config.host, port: config.port, database: config.database,
    user: config.user, password: config.password, max: config.poolMax,
    ssl: { ca: config.ca, rejectUnauthorized: true, servername: config.host },
    connectionTimeoutMillis: 3_000, query_timeout: 5_000, statement_timeout: 5_000,
    idleTimeoutMillis: 10_000, allowExitOnIdle: true,
    application_name: "rfq_catalog_public_read" });
  pool.on("error", () => { /* The next read reports SOURCE_UNAVAILABLE. */ });
  const snapshot = createRFQPublicReadSnapshot(async () => {
    let client: pg.PoolClient;
    try { client = await pool.connect(); }
    catch { throw new CatalogReadError("SOURCE_UNAVAILABLE"); }
    return { query: async (sql: string, values: readonly unknown[] = []) => {
      const result = await client.query(sql, [...values]);
      return { rows: result.rows as unknown[] };
    }, release: (destroy?: boolean) => client.release(destroy) };
  });
  return createRFQPublicCatalogReader(snapshot);
}

/** Existing server accessor remains lazy and separate from Admin credentials. */
export function getServerRFQPublicCatalogReader(): RFQPublicCatalogLookup {
  if (reader) return reader;
  reader = createServerRFQPublicCatalogReader(requireRFQPublicCatalogConfig(process.env));
  return reader;
}
