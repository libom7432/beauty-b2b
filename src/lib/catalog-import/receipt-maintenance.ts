/** Offline transaction contract for an approved, server-only receipt maintenance worker. */
export type ReceiptMaintenanceErrorCode =
  | "PERMISSION_DENIED" | "INVALID_BATCH_LIMIT" | "CATALOG_RECEIPT_MAINTENANCE_BUSY"
  | "MAINTENANCE_FAILED" | "COMMIT_UNKNOWN";

/** PostgreSQL standard lock_not_available, also raised by the fixed purge function. */
export const RECEIPT_MAINTENANCE_BUSY_SQLSTATE = "55P03";

function isBusyLock(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && error.code === RECEIPT_MAINTENANCE_BUSY_SQLSTATE;
}

export class ReceiptMaintenanceError extends Error {
  readonly code: ReceiptMaintenanceErrorCode;
  constructor(code: ReceiptMaintenanceErrorCode) {
    super(code);
    this.name = "ReceiptMaintenanceError";
    this.code = code;
  }
}

/** A production implementation must use one verified connection and database time. */
export interface ReceiptMaintenanceTransaction {
  /** Try catalog advisory transaction lock 725604510131 before receipt row locks; fail with 55P03 when busy. */
  acquireCatalogLock(): Promise<void>;
  /** Call only the fixed, batch-limited maintenance function; return a count, never rows. */
  purgeDue(limit: number): Promise<number>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  discard(): void;
}

export interface ReceiptMaintenanceAdapter {
  /** Implement with trusted server task identity; client input is never an authority. */
  authorizeTask(): Promise<boolean>;
  begin(): Promise<ReceiptMaintenanceTransaction>;
}

export type ReceiptMaintenanceResult = Readonly<{ purged_count: number }>;

/** One bounded transaction per call; scheduling, credentials and SQL are intentionally absent. */
export class ReceiptLifecycleMaintenance {
  private readonly adapter: ReceiptMaintenanceAdapter;
  constructor(adapter: ReceiptMaintenanceAdapter) { this.adapter = adapter; }

  async runBatch(limit = 100): Promise<ReceiptMaintenanceResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw new ReceiptMaintenanceError("INVALID_BATCH_LIMIT");
    let authorized = false;
    try { authorized = await this.adapter.authorizeTask(); } catch { /* deny closed */ }
    if (!authorized) throw new ReceiptMaintenanceError("PERMISSION_DENIED");
    let tx: ReceiptMaintenanceTransaction;
    try { tx = await this.adapter.begin(); }
    catch { throw new ReceiptMaintenanceError("MAINTENANCE_FAILED"); }
    let commitAttempted = false;
    try {
      await tx.acquireCatalogLock();
      const purged = await tx.purgeDue(limit);
      if (!Number.isSafeInteger(purged) || purged < 0 || purged > limit)
        throw new ReceiptMaintenanceError("MAINTENANCE_FAILED");
      commitAttempted = true;
      await tx.commit();
      return Object.freeze({ purged_count: purged });
    } catch (error) {
      let rollbackFailed = false;
      try { await tx.rollback(); } catch { rollbackFailed = true; tx.discard(); }
      if (commitAttempted) {
        tx.discard();
        // The transaction may already have committed. The next run may safely repeat the fixed purge.
        throw new ReceiptMaintenanceError("COMMIT_UNKNOWN");
      }
      if (!rollbackFailed && isBusyLock(error))
        throw new ReceiptMaintenanceError("CATALOG_RECEIPT_MAINTENANCE_BUSY");
      throw new ReceiptMaintenanceError("MAINTENANCE_FAILED");
    }
  }
}
