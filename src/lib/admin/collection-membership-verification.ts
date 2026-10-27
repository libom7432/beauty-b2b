import type { AdminCollectionMembershipCheckResult } from "../catalog-read/types.ts";
import type { CandidateQuery, CandidateResult } from "./collection-candidate-search.ts";

export const VERIFICATION_LIFETIME_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = new Set(["MEMBER", "NOT_MEMBER", "NOT_CONNECTED", "ERROR", "INCOMPLETE"]);
const origins = new Set(["NONE", "OFFLINE_FIXTURE", "READ_ONLY_DATABASE"]);

export type VerificationIdentity = Readonly<{
  collectionId: string; productId: string; viewKey: string;
  generation: number; sequence: number; checkedAtMs: number;
}>;
export type VerifiedObservation = VerificationIdentity & Readonly<{
  status: AdminCollectionMembershipCheckResult["status"];
  origin: AdminCollectionMembershipCheckResult["origin"];
  expiresAtMs: number;
}>;

export function candidateVerificationViewKey(collectionId: string, query: CandidateQuery,
  result: CandidateResult, urlPaused: boolean, memberPageKey: string): string {
  return JSON.stringify([collectionId.toLowerCase(), query.search, query.status,
    query.cursor, query.direction, result.state, urlPaused, memberPageKey,
    result.items.map((item) => item.productId)]);
}

/** Decode only the four fields that the authorized GET route promises. */
export function readMembershipCheckResponse(httpStatus: number, payload: unknown,
  identity: VerificationIdentity, nowMs: number): VerifiedObservation | null {
  if (httpStatus !== 200 || !Number.isFinite(nowMs) ||
    !Number.isFinite(identity.checkedAtMs) || nowMs < identity.checkedAtMs ||
    nowMs >= identity.checkedAtMs + VERIFICATION_LIFETIME_MS ||
    !payload || typeof payload !== "object" || Array.isArray(payload) ||
    Object.getPrototypeOf(payload) !== Object.prototype) return null;
  const fields = Object.getOwnPropertyDescriptors(payload);
  const keys = Reflect.ownKeys(fields);
  if (keys.length !== 4 || keys.some((key) => typeof key !== "string" ||
    !["collectionId", "productId", "status", "origin"].includes(key) ||
    !("value" in fields[key]))) return null;
  const collectionId = fields.collectionId?.value;
  const productId = fields.productId?.value;
  const status = fields.status?.value;
  const origin = fields.origin?.value;
  if (typeof collectionId !== "string" || !UUID.test(collectionId) ||
    collectionId.toLowerCase() !== identity.collectionId.toLowerCase() ||
    typeof productId !== "string" || !UUID.test(productId) ||
    productId.toLowerCase() !== identity.productId.toLowerCase() ||
    !statuses.has(status) || !origins.has(origin) ||
    ((status === "MEMBER" || status === "NOT_MEMBER") && origin === "NONE")) return null;
  return { ...identity, status, origin,
    expiresAtMs: identity.checkedAtMs + VERIFICATION_LIFETIME_MS };
}

export function isCurrentVerification(observation: VerificationIdentity,
  current: Pick<VerificationIdentity, "collectionId" | "productId" | "viewKey" |
    "generation" | "sequence">): boolean {
  return observation.collectionId === current.collectionId &&
    observation.productId === current.productId &&
    observation.viewKey === current.viewKey &&
    observation.generation === current.generation &&
    observation.sequence === current.sequence;
}

/** A delayed browser timer cannot extend an exact check's monotonic lifetime. */
export function verificationHasExpired(observation: VerifiedObservation, nowMs: number): boolean {
  return !Number.isFinite(nowMs) || !Number.isFinite(observation.checkedAtMs) ||
    !Number.isFinite(observation.expiresAtMs) || nowMs < observation.checkedAtMs ||
    observation.expiresAtMs !== observation.checkedAtMs + VERIFICATION_LIFETIME_MS ||
    nowMs >= observation.expiresAtMs;
}

/** Recheck this at the point of use; a stored RESULT phase is not proof of freshness. */
export function isFreshNotMemberVerification(observation: VerifiedObservation | null,
  current: Pick<VerificationIdentity, "collectionId" | "productId" | "viewKey" |
    "generation" | "sequence">, sourceAndDraftReady: boolean, nowMs: number): boolean {
  return !!observation && sourceAndDraftReady && observation.status === "NOT_MEMBER" &&
    (observation.origin === "OFFLINE_FIXTURE" || observation.origin === "READ_ONLY_DATABASE") &&
    isCurrentVerification(observation, current) && !verificationHasExpired(observation, nowMs);
}
