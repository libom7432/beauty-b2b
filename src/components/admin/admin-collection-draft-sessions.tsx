"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type ReactNode } from "react";
import type { AdminCollectionDetailResult } from "@/lib/catalog-read/types";
import { createCollectionDraftSessionOwner } from
  "@/lib/admin/collection-draft-session-owner";
import { basicSessionDirty, type AdminCollectionDraftSessions } from
  "@/lib/admin/collection-draft-session";
import { useAdminUnsavedChanges } from "./admin-unsaved-changes";

export type SessionOwner = ReturnType<typeof createCollectionDraftSessionOwner>;
type SessionContext = { owner: SessionOwner; active: boolean; visitEpoch: number };
const Context = createContext<SessionContext | null>(null);

export function AdminCollectionDraftSessionProvider({ children, owner, active, visitEpoch }: {
  children: ReactNode; owner: SessionOwner; active: boolean; visitEpoch: number;
}) {
  const { registerDirtyGetter } = useAdminUnsavedChanges();
  useLayoutEffect(() => registerDirtyGetter(owner.getGlobalDirty), [registerDirtyGetter, owner]);
  return <Context.Provider value={{ owner, active, visitEpoch }}>{children}</Context.Provider>;
}

export function useAdminCollectionDraftSessions() {
  const context = useContext(Context);
  if (!context) throw new Error("Admin collection draft session provider is missing");
  const snapshot = useSyncExternalStore(context.owner.subscribe,
    context.owner.getSnapshot, context.owner.getSnapshot);
  return { ...snapshot, ...context.owner, identityVerified: context.active,
    visitEpoch: context.visitEpoch };
}

/** Reads the Shell's synchronous gate without subscribing to its Basic draft data. */
export function useAdminCollectionDraftAccess() {
  const context = useContext(Context);
  if (!context) throw new Error("Admin collection draft session provider is missing");
  return { identityVerified: context.active, visitEpoch: context.visitEpoch,
    getAccessEpoch: context.owner.getAccessEpoch,
    isCurrentAccess: context.owner.isCurrentAccess };
}

/** One visit for both Basic and the future Membership session consumer.
 * A new Shell access epoch or mounted visit gets a new key. */
export function useAdminCollectionDraftVisit(collectionId: string,
  detail: AdminCollectionDetailResult): string | null {
  const { enter, leave, acceptDetail, getSnapshot, identityVerified, visitEpoch } =
    useAdminCollectionDraftSessions();
  const visitRef = useRef<string | null>(null);
  const initialDetail = useRef(detail);
  const [visitKey, setVisitKey] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!identityVerified) return;
    const key = window.crypto.randomUUID();
    const token = enter(collectionId, key, initialDetail.current);
    if (!token) return;
    visitRef.current = key;
    setVisitKey(key);
    return () => {
      leave(collectionId, key);
      if (visitRef.current === key) visitRef.current = null;
    };
  }, [collectionId, enter, leave, identityVerified, visitEpoch]);
  useLayoutEffect(() => {
    const key = visitRef.current;
    if (!identityVerified || !key) return;
    const entry = getSnapshot().state.entries[collectionId.toLowerCase()];
    if (!entry || entry.activeVisitKey !== key) return;
    acceptDetail(collectionId, key,
      { collectionId: entry.collectionId, generation: entry.generation }, detail);
  }, [collectionId, detail, acceptDetail, getSnapshot, identityVerified, visitEpoch]);
  return identityVerified ? visitKey : null;
}

export function sessionBasicDirty(state: AdminCollectionDraftSessions, id: string): boolean {
  const entry = state.entries[id.toLowerCase()];
  return entry ? basicSessionDirty(entry) : false;
}
