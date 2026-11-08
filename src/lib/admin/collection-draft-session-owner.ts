import type { AdminCollectionDetailResult, AdminCollectionMemberListResult } from "../catalog-read/types.ts";
import type { CollectionBasicDraft } from "./collection-basic-editor-draft.ts";
import { activateCollectionDraftSession, acceptCollectionDraftSource,
  beginCollectionDraftSourceRead, cleanupCleanCollectionSessions,
  createAdminCollectionDraftSessions, deactivateCollectionDraftSession,
  discardCollectionBasic, globalCollectionSessionDirty, initializeCollectionDraftSession,
  applyCollectionMembershipAction, discardCollectionMembership, updateCollectionBasicField,
  type MembershipSessionAction, type AdminCollectionDraftSessions,
  type CollectionDraftSessionCode, type CollectionDraftSessionResult,
  type CollectionDraftSessionToken } from "./collection-draft-session.ts";

export type CapacityError = "PAYLOAD_LIMIT" | "DIRTY_COLLECTION_LIMIT";
export type SourceAcceptance = Readonly<{
  code: CollectionDraftSessionCode; token: CollectionDraftSessionToken | null;
}>;
export type MemberSourcePayload = Readonly<{ collectionId: string; pageKey: string;
  detail: AdminCollectionDetailResult; members: AdminCollectionMemberListResult | null }>;
export type CollectionDraftOwnerSnapshot = Readonly<{
  state: AdminCollectionDraftSessions;
  capacityErrors: Readonly<Record<string, CapacityError>>;
}>;

const capacityCode = (code: CollectionDraftSessionCode): code is CapacityError =>
  code === "PAYLOAD_LIMIT" || code === "DIRTY_COLLECTION_LIMIT";

async function readMemberSource(url: string, signal: AbortSignal): Promise<MemberSourcePayload> {
  const response = await fetch(url, { method: "GET", cache: "no-store", signal });
  if (response.status !== 200 || !response.headers.get("Content-Type")?.includes("application/json") ||
    !response.headers.get("Cache-Control")?.includes("no-store")) throw new Error("SOURCE_UNAVAILABLE");
  return await response.json() as MemberSourcePayload;
}

/** One instance per mounted AdminShell. No module-level draft state or persistence. */
export function createCollectionDraftSessionOwner(initiallyUnlocked = true,
  sourceReader: (url: string, signal: AbortSignal) => Promise<MemberSourcePayload> = readMemberSource) {
  let snapshot: CollectionDraftOwnerSnapshot = {
    state: createAdminCollectionDraftSessions(), capacityErrors: {} };
  let unlocked = initiallyUnlocked;
  let destroyed = false;
  let accessEpoch = 0;
  const listeners = new Set<() => void>();
  const sourceRequests = new Map<string, AbortController>();
  const getSnapshot = () => snapshot;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const apply = (transition: (current: AdminCollectionDraftSessions) =>
    CollectionDraftSessionResult, id?: string): CollectionDraftSessionResult => {
    const previous = snapshot;
    const result = transition(previous.state);
    let capacityErrors = previous.capacityErrors;
    if (id) {
      const next = { ...capacityErrors };
      if (capacityCode(result.code)) next[id] = result.code;
      else delete next[id];
      if (next[id] !== capacityErrors[id] ||
        Object.keys(next).length !== Object.keys(capacityErrors).length) capacityErrors = next;
    }
    if (result.state !== previous.state || capacityErrors !== previous.capacityErrors) {
      snapshot = { state: result.state, capacityErrors };
      for (const listener of listeners) listener();
    }
    return result;
  };
  const currentVisit = (id: string, visitKey: string) => {
    const entry = snapshot.state.entries[id.toLowerCase()];
    return entry?.activeVisitKey === visitKey ? entry : null;
  };
  const enter = (id: string, visitKey: string, detail: AdminCollectionDetailResult) => {
    if (!unlocked || destroyed) return null;
    const normalized = id.toLowerCase();
    const initialized = apply((current) => initializeCollectionDraftSession(current, normalized,
      detail.state === "COMPLETE" ? detail.item : null), normalized);
    if (initialized.code !== "APPLIED" && initialized.code !== "UNCHANGED") return null;
    const activated = apply((current) => activateCollectionDraftSession(current, normalized, visitKey), normalized);
    return activated.code === "APPLIED" || activated.code === "UNCHANGED" ? activated.token : null;
  };
  const leave = (id: string, visitKey: string) => {
    if (destroyed) return;
    const entry = currentVisit(id, visitKey);
    if (!entry) return;
    sourceRequests.get(entry.collectionId)?.abort();
    sourceRequests.delete(entry.collectionId);
    apply((current) => deactivateCollectionDraftSession(current,
      { collectionId: entry.collectionId, generation: entry.generation }), entry.collectionId);
  };
  const acceptDetail = (id: string, visitKey: string,
    token: CollectionDraftSessionToken, detail: AdminCollectionDetailResult): SourceAcceptance => {
    if (!unlocked || destroyed) return { code: "STALE_GENERATION", token: null };
    const entry = currentVisit(id, visitKey);
    if (!entry || token.collectionId.toLowerCase() !== entry.collectionId ||
      token.generation !== entry.generation) return { code: "STALE_GENERATION", token: null };
    let sourceToken = token;
    if (entry.sourceState !== "NEEDS_REVALIDATION") {
      const begun = apply((current) => beginCollectionDraftSourceRead(current, sourceToken), entry.collectionId);
      if (begun.code !== "APPLIED" || !begun.token)
        return { code: begun.code, token: begun.token };
      sourceToken = begun.token;
    }
    // S2 transfers only Basic ownership. No member page or exact check is cached here.
    const accepted = apply((current) => acceptCollectionDraftSource(current, sourceToken,
      detail, null, "first"), entry.collectionId);
    return { code: accepted.code, token: accepted.token };
  };
  /** A source read owns its S1 generation from before the network request starts.
   * RSC props cannot be supplied here: their request-start identity is unknown. */
  const loadMemberSource = async (id: string, visitKey: string, epoch: number,
    pageKey: string):
    Promise<SourceAcceptance> => {
    const stale: SourceAcceptance = { code: "STALE_GENERATION", token: null };
    if (!isCurrentAccess(epoch)) return stale;
    const entry = currentVisit(id, visitKey);
    if (!entry || !/^(first|(?:after|before):[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(pageKey) ||
      pageKey.length > 519) return { code: "ACTION_REJECTED", token: null };
    const initialToken = { collectionId: entry.collectionId, generation: entry.generation };
    const begun = apply((current) => beginCollectionDraftSourceRead(current, initialToken),
      entry.collectionId);
    if (begun.code !== "APPLIED" || !begun.token)
      return { code: begun.code, token: begun.token };
    const sourceToken = begun.token;
    const [direction, cursor] = pageKey === "first" ? [null, null] : pageKey.split(":");
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}&direction=${direction}` : "";
    const url = `/api/admin/collections/${encodeURIComponent(entry.collectionId)}/member-source${query}`;
    sourceRequests.get(entry.collectionId)?.abort();
    const controller = new AbortController();
    sourceRequests.set(entry.collectionId, controller);
    let payload: MemberSourcePayload;
    try { payload = await sourceReader(url, controller.signal); }
    catch { return controller.signal.aborted ? stale : { code: "SOURCE_NOT_READY", token: null }; }
    finally {
      if (sourceRequests.get(entry.collectionId) === controller)
        sourceRequests.delete(entry.collectionId);
    }
    if (controller.signal.aborted) return stale;
    if (!isCurrentAccess(epoch)) return stale;
    const current = currentVisit(id, visitKey);
    if (!current || current.generation !== sourceToken.generation) return stale;
    let source: MemberSourcePayload;
    try {
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        Object.getPrototypeOf(payload) !== Object.prototype) return { code: "ACTION_REJECTED", token: null };
      const fields = Object.getOwnPropertyDescriptors(payload);
      if (Reflect.ownKeys(fields).length !== 4 ||
        ["collectionId", "pageKey", "detail", "members"].some((key) =>
          !fields[key] || !("value" in fields[key])))
        return { code: "ACTION_REJECTED", token: null };
      source = { collectionId: fields.collectionId.value, pageKey: fields.pageKey.value,
        detail: fields.detail.value, members: fields.members.value } as MemberSourcePayload;
    } catch { return { code: "ACTION_REJECTED", token: null }; }
    if (typeof source.collectionId !== "string" ||
      source.collectionId.toLowerCase() !== entry.collectionId || source.pageKey !== pageKey)
      return { code: "ACTION_REJECTED", token: null };
    if (!isCurrentAccess(epoch) || currentVisit(id, visitKey)?.generation !== sourceToken.generation)
      return stale;
    const accepted = apply((state) => acceptCollectionDraftSource(state, sourceToken,
      source.detail, source.members, pageKey), entry.collectionId);
    return { code: accepted.code, token: accepted.token };
  };
  const editBasic = <K extends keyof CollectionBasicDraft>(id: string,
    visitKey: string, field: K, value: CollectionBasicDraft[K]): CollectionDraftSessionCode => {
    if (!unlocked || destroyed) return "STALE_GENERATION";
    const entry = currentVisit(id, visitKey);
    if (!entry) return "STALE_GENERATION";
    return apply((current) => updateCollectionBasicField(current,
      { collectionId: entry.collectionId, generation: entry.generation }, field, value),
    entry.collectionId).code;
  };
  const discardBasic = (id: string, visitKey: string): SourceAcceptance => {
    if (!unlocked || destroyed) return { code: "STALE_GENERATION", token: null };
    const entry = currentVisit(id, visitKey);
    if (!entry) return { code: "STALE_GENERATION", token: null };
    const discarded = apply((current) => discardCollectionBasic(current,
      { collectionId: entry.collectionId, generation: entry.generation }), entry.collectionId);
    return { code: discarded.code, token: discarded.token };
  };
  /** Every Membership write is checked against the visit, Shell access epoch and
   * S1 generation captured by its caller. The S1 transition remains the only writer. */
  const membershipAction = (id: string, visitKey: string, epoch: number,
    generation: number, action: MembershipSessionAction): CollectionDraftSessionCode => {
    if (!isCurrentAccess(epoch)) return "STALE_GENERATION";
    const entry = currentVisit(id, visitKey);
    if (!entry || entry.generation !== generation) return "STALE_GENERATION";
    return apply((current) => applyCollectionMembershipAction(current,
      { collectionId: entry.collectionId, generation }, action), entry.collectionId).code;
  };
  const discardMembership = (id: string, visitKey: string, epoch: number,
    generation: number): CollectionDraftSessionCode => {
    if (!isCurrentAccess(epoch)) return "STALE_GENERATION";
    const entry = currentVisit(id, visitKey);
    if (!entry || entry.generation !== generation) return "STALE_GENERATION";
    return apply((current) => discardCollectionMembership(current,
      { collectionId: entry.collectionId, generation }), entry.collectionId).code;
  };
  const getGlobalDirty = () => globalCollectionSessionDirty(snapshot.state);
  const cleanupClean = (protectedId: string | null = null) =>
    !unlocked || destroyed ? "STALE_GENERATION" :
      apply((current) => cleanupCleanCollectionSessions(current, protectedId)).code;
  // A callback from an earlier verification cannot become valid again after unlock.
  const lock = () => {
    unlocked = false;
    accessEpoch++;
    for (const controller of sourceRequests.values()) controller.abort();
    sourceRequests.clear();
  };
  const unlock = () => { if (!destroyed) unlocked = true; };
  const getAccessEpoch = () => accessEpoch;
  const isCurrentAccess = (epoch: number) =>
    unlocked && !destroyed && epoch === accessEpoch;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    unlocked = false;
    for (const controller of sourceRequests.values()) controller.abort();
    sourceRequests.clear();
    snapshot = { state: createAdminCollectionDraftSessions(), capacityErrors: {} };
    for (const listener of listeners) listener();
  };
  const isDestroyed = () => destroyed;
  return { getSnapshot, subscribe, enter, leave, acceptDetail, loadMemberSource, editBasic,
    discardBasic, membershipAction, discardMembership, getGlobalDirty, cleanupClean,
    lock, unlock, destroy, isDestroyed,
    getAccessEpoch, isCurrentAccess };
}
