import type { RFQInboxStatus } from "./inbox.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statusValues: readonly RFQInboxStatus[] = ["received", "reviewed", "closed"];
const allowed: Readonly<Record<RFQInboxStatus, readonly RFQInboxStatus[]>> = {
  received: ["reviewed"], reviewed: ["closed"], closed: ["reviewed"],
};

export type RFQStatusCommand = Readonly<{ rfqId: string; operationId: string;
  expectedStatus: RFQInboxStatus; expectedVersion: number; targetStatus: RFQInboxStatus }>;
export type RFQStatusAudit = Readonly<{ operationId: string; rfqId: string; actorId: string;
  occurredAt: string; oldStatus: RFQInboxStatus; newStatus: RFQInboxStatus;
  oldVersion: number; newVersion: number }>;
export type RFQStatusResult = Readonly<{ kind: "APPLIED" | "REPLAYED"; audit: RFQStatusAudit }>;
export type RFQStatusSourceResult = RFQStatusResult |
  Readonly<{ kind: "CONFLICT"; reason: "STALE_VERSION" | "STATUS_MISMATCH" | "OPERATION_REUSED" | "UNKNOWN_STATUS" }> |
  Readonly<{ kind: "NOT_FOUND" }>;

/** The future database adapter must atomically perform a version compare-and-swap,
 * insert exactly one audit event, and deduplicate operationId within one transaction. */
export interface RFQStatusSource {
  transitionAtomically(command: RFQStatusCommand & Readonly<{ actorId: string; occurredAt: string }>):
    Promise<RFQStatusSourceResult>;
}

export class RFQStatusError extends Error {
  readonly code: "FORBIDDEN" | "INVALID_INPUT" | "INVALID_TRANSITION" | "CONFLICT" |
    "NOT_FOUND" | "NOT_CONNECTED" | "SOURCE_UNAVAILABLE";
  readonly reason?: "STALE_VERSION" | "STATUS_MISMATCH" | "OPERATION_REUSED" | "UNKNOWN_STATUS";
  constructor(code: RFQStatusError["code"], reason?: RFQStatusError["reason"]) {
    super(code); this.name = "RFQStatusError"; this.code = code; this.reason = reason;
  }
}

function validateCommand(value: unknown): RFQStatusCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RFQStatusError("INVALID_INPUT");
  const input = value as Record<string, unknown>;
  const keys = ["rfqId", "operationId", "expectedStatus", "expectedVersion", "targetStatus"];
  if (Object.keys(input).length !== keys.length || Object.keys(input).some((key) => !keys.includes(key)) ||
    typeof input.rfqId !== "string" || !uuid.test(input.rfqId) ||
    typeof input.operationId !== "string" || !uuid.test(input.operationId) ||
    !statusValues.includes(input.expectedStatus as RFQInboxStatus) ||
    !statusValues.includes(input.targetStatus as RFQInboxStatus) ||
    !Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0)
    throw new RFQStatusError("INVALID_INPUT");
  const command = input as RFQStatusCommand;
  if (!allowed[command.expectedStatus].includes(command.targetStatus))
    throw new RFQStatusError("INVALID_TRANSITION");
  return { rfqId: command.rfqId, operationId: command.operationId,
    expectedStatus: command.expectedStatus, expectedVersion: command.expectedVersion,
    targetStatus: command.targetStatus };
}

function projectResult(raw: RFQStatusSourceResult, command: RFQStatusCommand,
  actorId: string, occurredAt: string): RFQStatusResult {
  if (!raw || typeof raw !== "object") throw new RFQStatusError("SOURCE_UNAVAILABLE");
  if (raw.kind === "NOT_FOUND") throw new RFQStatusError("NOT_FOUND");
  if (raw.kind === "CONFLICT") {
    if (!["STALE_VERSION", "STATUS_MISMATCH", "OPERATION_REUSED", "UNKNOWN_STATUS"].includes(raw.reason))
      throw new RFQStatusError("SOURCE_UNAVAILABLE");
    throw new RFQStatusError("CONFLICT", raw.reason);
  }
  if (raw.kind !== "APPLIED" && raw.kind !== "REPLAYED") throw new RFQStatusError("SOURCE_UNAVAILABLE");
  const event = raw.audit;
  if (!event || typeof event.rfqId !== "string" || typeof event.occurredAt !== "string" ||
    event.operationId !== command.operationId || event.rfqId.toLowerCase() !== command.rfqId.toLowerCase() ||
    event.actorId !== actorId || event.oldStatus !== command.expectedStatus ||
    event.newStatus !== command.targetStatus || event.oldVersion !== command.expectedVersion ||
    event.newVersion !== command.expectedVersion + 1 || !Number.isFinite(Date.parse(event.occurredAt)) ||
    (raw.kind === "APPLIED" && event.occurredAt !== occurredAt))
    throw new RFQStatusError("SOURCE_UNAVAILABLE");
  return { kind: raw.kind, audit: { operationId: event.operationId, rfqId: event.rfqId,
    actorId: event.actorId, occurredAt: event.occurredAt, oldStatus: event.oldStatus,
    newStatus: event.newStatus, oldVersion: event.oldVersion, newVersion: event.newVersion } };
}

/** Authorize on every operation. No client-supplied actor, time, permission, or audit outcome is accepted. */
export function createRFQStatusService(source: RFQStatusSource | null,
  authorize: () => Promise<string>, clock: () => Date = () => new Date()) {
  return {
    async changeStatus(input: unknown): Promise<RFQStatusResult> {
      let actorId: string;
      try { actorId = await authorize(); } catch { throw new RFQStatusError("FORBIDDEN"); }
      if (!uuid.test(actorId)) throw new RFQStatusError("FORBIDDEN");
      const command = validateCommand(input);
      if (!source) throw new RFQStatusError("NOT_CONNECTED");
      let instant: Date;
      try { instant = clock(); } catch { throw new RFQStatusError("SOURCE_UNAVAILABLE"); }
      if (!(instant instanceof Date) || !Number.isFinite(instant.getTime()))
        throw new RFQStatusError("SOURCE_UNAVAILABLE");
      let result: RFQStatusSourceResult;
      try { result = await source.transitionAtomically({ ...command, actorId, occurredAt: instant.toISOString() }); }
      catch { throw new RFQStatusError("SOURCE_UNAVAILABLE"); }
      return projectResult(result, command, actorId, instant.toISOString());
    },
  };
}
