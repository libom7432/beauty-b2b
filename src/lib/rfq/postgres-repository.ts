import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { RFQItemSnapshot } from "./types";
import type { RFQRecord, RFQRepository, RFQTransaction, RFQWrite } from "./api";

export type RFQDatabaseErrorKind =
  | "CONFIGURATION"
  | "IDEMPOTENCY_CONFLICT"
  | "RFQ_NUMBER_CONFLICT"
  | "DATABASE_UNAVAILABLE"
  | "UNEXPECTED_DATABASE_ERROR";

// Fixed messages only: never attach a raw pg error, SQL, URL, or customer data.
export class RFQDatabaseError extends Error {
  constructor(readonly kind: RFQDatabaseErrorKind) {
    super(kind);
    this.name = "RFQDatabaseError";
  }
}

type PostgreSQLError = { code?: unknown; constraint?: unknown };
const unavailableCodes = new Set([
  "08000", "08001", "08003", "08004", "08006", "08007", "08P01",
  "57P01", "57P02", "57P03", "53300", "53400", "57014",
  "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT",
]);

export function mapRFQDatabaseError(error: unknown): RFQDatabaseError {
  if (error instanceof RFQDatabaseError) return error;
  const pgError = error && typeof error === "object" ? error as PostgreSQLError : {};
  if (pgError.code === "23505") {
    if (pgError.constraint === "rfq_requests_rfq_number_key") return new RFQDatabaseError("RFQ_NUMBER_CONFLICT");
    if (pgError.constraint === "rfq_requests_idempotency_key_key") return new RFQDatabaseError("IDEMPOTENCY_CONFLICT");
  }
  if (typeof pgError.code === "string" && (pgError.code.startsWith("08") || unavailableCodes.has(pgError.code)))
    return new RFQDatabaseError("DATABASE_UNAVAILABLE");
  return new RFQDatabaseError("UNEXPECTED_DATABASE_ERROR");
}

export function rfqPoolConfiguration(raw: string | undefined) {
  if (!raw) throw new RFQDatabaseError("CONFIGURATION");
  try {
    const url = new URL(raw);
    const user = decodeURIComponent(url.username);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !database ||
        !url.password || !(user === "rfq_api" || /^rfq_api\.[A-Za-z0-9_-]+$/.test(user)) ||
        url.search || url.hash) throw new Error("Invalid RFQ connection URL");
    const port = url.port ? Number(url.port) : 5432;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid RFQ database port");
    return {
      host: url.hostname,
      port,
      user,
      password: decodeURIComponent(url.password),
      database,
      ssl: { rejectUnauthorized: true, servername: url.hostname },
      max: 1,
      connectionTimeoutMillis: 3_000,
      query_timeout: 10_000,
      idleTimeoutMillis: 10_000,
      pipeline: false,
      application_name: "rfq_api",
    } as const;
  } catch { throw new RFQDatabaseError("CONFIGURATION"); }
}

let sharedPool: Pool | undefined;

// Lazy initialization prevents the application build and disabled route from
// opening any connection. One pool is shared by requests in a warm Node worker.
export function getRFQPool(): Pool {
  if (sharedPool) return sharedPool;
  const pool = new Pool(rfqPoolConfiguration(process.env.RFQ_DATABASE_URL));
  // pg removes broken idle clients; a listener prevents an uncaught event.
  // Never log the raw error because it may contain connection details.
  pool.on("error", () => {});
  sharedPool = pool;
  return pool;
}

type MetadataRow = QueryResultRow & {
  id: string;
  rfq_number: string;
  request_fingerprint: string;
  status: "received";
  created_at: Date | string;
};

function recordFromRow(row: MetadataRow): RFQRecord {
  return {
    id: row.id,
    rfqNumber: row.rfq_number,
    fingerprint: row.request_fingerprint,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  };
}

const SELECT_BY_KEY = `SELECT id, rfq_number, request_fingerprint, status, created_at
FROM rfq_private.rfq_requests WHERE idempotency_key = $1`;

const INSERT_REQUEST = `INSERT INTO rfq_private.rfq_requests (
  rfq_number, idempotency_key, request_fingerprint, full_name, email,
  company_name, country, whatsapp, website, buyer_type, requirements,
  customization, purchase_timeline
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id, rfq_number, request_fingerprint, status, created_at`;

const INSERT_NOTIFICATION = `INSERT INTO rfq_private.rfq_notification_jobs (rfq_request_id)
VALUES ($1)`;

class PostgreSQLRFQTransaction implements RFQTransaction {
  constructor(private readonly client: PoolClient) {}

  async findByKey(key: string): Promise<RFQRecord | null> {
    const result = await this.client.query<MetadataRow>(SELECT_BY_KEY, [key]);
    return result.rows[0] ? recordFromRow(result.rows[0]) : null;
  }

  async insertRequestIfAbsent(write: RFQWrite): Promise<RFQRecord | null> {
    const { contact, buyerType, requirements, customization, purchaseTimeline } = write.draft;
    const result = await this.client.query<MetadataRow>(INSERT_REQUEST, [
      write.rfqNumber, write.key, write.fingerprint, contact.fullName, contact.email,
      contact.companyName, contact.country, contact.whatsapp ?? null, contact.website ?? null,
      buyerType ?? null, requirements, JSON.stringify(customization ?? []), purchaseTimeline ?? null,
    ]);
    return result.rows[0] ? recordFromRow(result.rows[0]) : null;
  }

  async insertItems(requestId: string, items: readonly RFQItemSnapshot[]): Promise<void> {
    if (!items.length) throw new RFQDatabaseError("UNEXPECTED_DATABASE_ERROR");
    const values: unknown[] = [];
    const placeholders = items.map((item) => {
      const offset = values.length;
      values.push(requestId, item.productId, item.sku ?? null, item.quantity,
        JSON.stringify({ productName: item.productName, productSlug: item.productSlug,
          selectedVariant: item.selectedVariant }));
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}::jsonb)`;
    });
    const sql = `INSERT INTO rfq_private.rfq_items
      (rfq_request_id, product_id, sku, quantity, product_snapshot)
      VALUES ${placeholders.join(", ")}`;
    await this.client.query(sql, values);
  }

  async insertNotificationJob(requestId: string): Promise<void> {
    await this.client.query(INSERT_NOTIFICATION, [requestId]);
  }
}

export class PostgreSQLRFQRepository implements RFQRepository {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async transaction<T>(work: (tx: RFQTransaction) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try { client = await this.pool.connect(); }
    catch { throw new RFQDatabaseError("DATABASE_UNAVAILABLE"); }
    let begun = false;
    let destroy = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      begun = true;
      // Transaction-local GUC survives only until COMMIT/ROLLBACK, which is
      // compatible with a transaction pooler that swaps backends afterward.
      await client.query("SET LOCAL statement_timeout = 8000");
      const result = await work(new PostgreSQLRFQTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      destroy = true;
      if (begun) {
        try { await client.query("ROLLBACK"); }
        catch { /* The connection is discarded below. Keep the primary error. */ }
      }
      throw mapRFQDatabaseError(error);
    } finally {
      client.release(destroy);
    }
  }
}

export function getPostgreSQLRFQRepository(): PostgreSQLRFQRepository {
  return new PostgreSQLRFQRepository(getRFQPool());
}
