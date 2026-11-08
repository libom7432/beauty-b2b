"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef,
  useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type AdminGuardAuthority = Readonly<{ identityKey: string; accessEpoch: number }>;
type RequestBase = Readonly<{
  target: string;
  scope: "GLOBAL" | "COLLECTION";
  collectionId?: string;
  trigger?: HTMLElement | null;
}>;
export type AdminNavigationRequest =
  | (RequestBase & Readonly<{ type: "PUSH" | "REPLACE" }>)
  | (RequestBase & Readonly<{ type: "SIGN_OUT"; execute: () => void }>);
type NavigationIntent = AdminNavigationRequest & Readonly<{
  id: number;
  origin: string;
  authority: AdminGuardAuthority;
  trigger: HTMLElement | null;
  phase: "PENDING" | "CONFIRMING" | "NAVIGATING" | "RECOVERABLE_FAILURE";
}>;
type IntentOutcome = "IDLE" | "CANCELLED" | "COMMITTED" | "RESUMED" | "INVALIDATED";
type Guard = {
  setDirty: (dirty: boolean) => void;
  confirmNavigation: () => boolean;
  registerDirtyGetter: (getter: () => boolean) => () => void;
  registerDialogPreparation: (prepare: () => HTMLElement | null) => () => void;
  requestNavigation: (request: AdminNavigationRequest) => "EXECUTED" | "PENDING" | "REJECTED";
  cancelNavigation: () => void;
  approveNavigation: (id: number) => void;
};
const GuardContext = createContext<Guard | null>(null);
const warning = "You have unsaved local changes. Leave this page?";
const collectionPath = /^\/admin\/collections\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?|$)/i;

const routeFromRouter = (pathname: string, search: string) =>
  `${pathname}${search ? `?${search}` : ""}`;
const routeKey = () => routeFromRouter(window.location.pathname,
  new URLSearchParams(window.location.search).toString());
function safeAdminTarget(target: string): string | null {
  try {
    const url = new URL(target, window.location.href);
    if (url.origin !== window.location.origin ||
      (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/"))) return null;
    return routeFromRouter(url.pathname, url.searchParams.toString());
  } catch { return null; }
}

export function AdminUnsavedChangesProvider({ children, readAuthority, readCollectionDirty,
  invalidationRef }: {
  children: ReactNode;
  readAuthority?: () => AdminGuardAuthority | null;
  readCollectionDirty?: (collectionId: string) => boolean;
  invalidationRef?: RefObject<(() => void) | null>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // App Router hooks change with the committed route. The address bar alone
  // may already show a target while its RSC navigation is still pending.
  const committedRoute = routeFromRouter(pathname, search.toString());
  const [, setDirtyState] = useState(false);
  const legacyDirty = useRef(false);
  const sources = useRef(new Map<symbol, () => boolean>());
  const preparation = useRef<(() => HTMLElement | null) | null>(null);
  const authorityRef = useRef(readAuthority);
  const collectionDirtyRef = useRef(readCollectionDirty);
  useLayoutEffect(() => {
    authorityRef.current = readAuthority;
    collectionDirtyRef.current = readCollectionDirty;
  });
  const [intent, setIntent] = useState<NavigationIntent | null>(null);
  const [lastOutcome, setLastOutcome] = useState<IntentOutcome>("IDLE");
  const [abandonedNotice, setAbandonedNotice] = useState(false);
  const intentRef = useRef<NavigationIntent | null>(null);
  const nextId = useRef(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const abandonedTargets = useRef(new Set<string>());
  const abandonedOrigin = useRef<string | null>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);

  const publish = useCallback((next: NavigationIntent | null) => {
    intentRef.current = next;
    setIntent(next);
  }, []);
  const setDirty = useCallback((dirty: boolean) => {
    legacyDirty.current = dirty;
    setDirtyState(dirty);
  }, []);
  const registerDirtyGetter = useCallback((getter: () => boolean) => {
    const id = Symbol("admin dirty source");
    sources.current.set(id, getter);
    return () => { sources.current.delete(id); };
  }, []);
  const registerDialogPreparation = useCallback((prepare: () => HTMLElement | null) => {
    preparation.current = prepare;
    return () => { if (preparation.current === prepare) preparation.current = null; };
  }, []);
  const isDirty = useCallback(() => {
    if (legacyDirty.current) return true;
    for (const getter of sources.current.values()) {
      try { if (getter()) return true; } catch { return true; }
    }
    return false;
  }, []);
  const requestedDirty = useCallback((request: AdminNavigationRequest) => {
    if (request.scope === "COLLECTION") {
      if (!request.collectionId || !collectionDirtyRef.current) return true;
      try { return collectionDirtyRef.current(request.collectionId); } catch { return true; }
    }
    return isDirty();
  }, [isDirty]);
  const authorityMatches = useCallback((expected: AdminGuardAuthority) => {
    const actual = authorityRef.current?.();
    return !!actual && actual.identityKey === expected.identityKey &&
      actual.accessEpoch === expected.accessEpoch;
  }, []);
  const executeNavigation = useCallback((request: AdminNavigationRequest, target: string) => {
    if (request.type === "SIGN_OUT") request.execute();
    else if (request.type === "PUSH") router.push(target);
    else router.replace(target);
  }, [router]);
  const invalidate = useCallback((restore: boolean) => {
    const current = intentRef.current;
    if (!current) return;
    if (current.type !== "SIGN_OUT" && current.phase === "NAVIGATING" &&
      routeKey() !== current.target) {
      // An external route change may supersede this attempt without cancelling
      // its RSC response. Do not let a new attempt claim the same late target.
      abandonedOrigin.current = routeKey();
      abandonedTargets.current.add(current.target);
      setAbandonedNotice(true);
    }
    restoreFocusRef.current = restore ? current.trigger : null;
    setLastOutcome(restore ? "CANCELLED" : "INVALIDATED");
    publish(null);
  }, [publish]);
  useLayoutEffect(() => {
    if (!invalidationRef) return;
    const invalidateCurrent = () => invalidate(false);
    invalidationRef.current = invalidateCurrent;
    return () => {
      if (invalidationRef.current === invalidateCurrent) invalidationRef.current = null;
    };
  }, [invalidationRef, invalidate]);
  const cancelNavigation = useCallback(() => {
    if (intentRef.current?.phase === "PENDING" || intentRef.current?.phase === "CONFIRMING")
      invalidate(true);
  }, [invalidate]);
  const startNavigation = useCallback((current: NavigationIntent) => {
    const navigating = { ...current, phase: "NAVIGATING" as const };
    publish(navigating);
    try { executeNavigation(navigating, navigating.target); }
    catch {
      if (intentRef.current?.id === navigating.id)
        publish({ ...navigating, phase: "RECOVERABLE_FAILURE" });
    }
  }, [executeNavigation, publish]);
  const requestNavigation = useCallback((request: AdminNavigationRequest) => {
    if (intentRef.current) return "REJECTED";
    const target = safeAdminTarget(request.target);
    const authority = authorityRef.current?.();
    if (!target || !authority ||
      (request.type !== "PUSH" && request.type !== "REPLACE" && request.type !== "SIGN_OUT") ||
      (request.type === "SIGN_OUT" && typeof request.execute !== "function")) return "REJECTED";
    const origin = routeKey();
    if (abandonedOrigin.current === origin && abandonedTargets.current.has(target))
      return "REJECTED";
    if (request.scope === "COLLECTION" &&
      origin.match(collectionPath)?.[1].toLowerCase() !== request.collectionId?.toLowerCase())
      return "REJECTED";
    if (request.type !== "SIGN_OUT" && target === origin) return "REJECTED";
    if (!requestedDirty(request)) {
      if (!authorityMatches(authority) || routeKey() !== origin) return "REJECTED";
      const next: NavigationIntent = { ...request, target, id: ++nextId.current,
        origin, authority, trigger: request.trigger ?? null, phase: "NAVIGATING" };
      setLastOutcome("IDLE");
      startNavigation(next);
      return "EXECUTED";
    }
    // Closing the mobile menu is synchronous. React opens the guard dialog only
    // after that modal has closed, so there cannot be two active modal dialogs.
    const fallback = preparation.current?.() ?? null;
    const next: NavigationIntent = { ...request, target, id: ++nextId.current,
      origin, authority, trigger: fallback ?? request.trigger ?? null, phase: "PENDING" };
    setLastOutcome("IDLE");
    publish(next);
    return "PENDING";
  }, [authorityMatches, publish, requestedDirty, startNavigation]);
  const approveNavigation = useCallback((id: number) => {
    const current = intentRef.current;
    if (!current || current.id !== id || current.phase !== "CONFIRMING") return;
    if (routeKey() !== current.origin || !authorityMatches(current.authority) ||
      safeAdminTarget(current.target) !== current.target) {
      invalidate(false);
      return;
    }
    // Re-read the current draft before approval. The confirmation covers its
    // live state; approval never discards the Owner draft.
    requestedDirty(current);
    startNavigation(current);
  }, [authorityMatches, invalidate, requestedDirty, startNavigation]);
  const resumeEditing = useCallback(() => {
    const current = intentRef.current;
    if (!current || (current.phase !== "NAVIGATING" &&
      current.phase !== "RECOVERABLE_FAILURE")) return;
    if (!authorityMatches(current.authority) || routeKey() !== current.origin) {
      invalidate(false);
      return;
    }
    // A pending router.push cannot be cancelled by this button. Its target
    // cannot be reused by a new attempt from the same origin: a late old RSC
    // response would otherwise be indistinguishable from a new commit.
    if (current.phase === "NAVIGATING") {
      abandonedOrigin.current = current.origin;
      abandonedTargets.current.add(current.target);
      setAbandonedNotice(true);
    }
    restoreFocusRef.current = current.trigger;
    setLastOutcome("RESUMED");
    publish(null);
  }, [authorityMatches, invalidate, publish]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [isDirty]);
  const confirmNavigation = useCallback(() => !isDirty() || window.confirm(warning), [isDirty]);

  useLayoutEffect(() => {
    const current = intentRef.current;
    const address = routeKey();
    if (!current) {
      if (abandonedOrigin.current && committedRoute !== abandonedOrigin.current &&
        address === committedRoute) {
        abandonedOrigin.current = null;
        abandonedTargets.current.clear();
        setAbandonedNotice(false);
        setLastOutcome("IDLE");
      }
      return;
    }
    if (!authorityMatches(current.authority)) {
      invalidate(false);
      return;
    }
    if (current.phase === "NAVIGATING" || current.phase === "RECOVERABLE_FAILURE") {
      if (current.type !== "SIGN_OUT" && committedRoute === current.target &&
        address === current.target) {
        setLastOutcome("COMMITTED");
        publish(null);
      } else if ((address !== current.origin && address !== current.target) ||
        (committedRoute !== current.origin && committedRoute !== current.target)) {
        invalidate(false);
      }
      return;
    }
    if (address !== current.origin || committedRoute !== current.origin) {
      invalidate(false);
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    if (current.phase === "PENDING") publish({ ...current, phase: "CONFIRMING" });
    stayRef.current?.focus();
  }, [authorityMatches, committedRoute, intent, invalidate, publish, readAuthority]);
  useLayoutEffect(() => {
    if (intent?.phase === "PENDING" || intent?.phase === "CONFIRMING") return;
    if (dialogRef.current?.open) dialogRef.current.close();
    if (intent?.phase === "NAVIGATING" || intent?.phase === "RECOVERABLE_FAILURE") {
      resumeRef.current?.focus();
      return;
    }
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (target?.isConnected) target.focus();
  }, [intent]);
  useEffect(() => {
    const check = () => {
      const current = intentRef.current;
      if (!current) return;
      const address = routeKey();
      if (!authorityMatches(current.authority) ||
        (current.phase !== "NAVIGATING" && current.phase !== "RECOVERABLE_FAILURE" &&
          address !== current.origin) ||
        ((current.phase === "NAVIGATING" || current.phase === "RECOVERABLE_FAILURE") &&
          address !== current.origin && address !== current.target))
        invalidate(false);
    };
    window.addEventListener("popstate", check);
    window.addEventListener("focus", check);
    return () => {
      window.removeEventListener("popstate", check);
      window.removeEventListener("focus", check);
    };
  }, [authorityMatches, invalidate]);
  const trapFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
    if (!buttons.length) return;
    if (event.shiftKey && document.activeElement === buttons[0]) {
      event.preventDefault(); buttons.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
      event.preventDefault(); buttons[0].focus();
    }
  };

  const value = useMemo(() => ({ setDirty, confirmNavigation, registerDirtyGetter,
    registerDialogPreparation, requestNavigation, cancelNavigation, approveNavigation }),
  [setDirty, confirmNavigation, registerDirtyGetter, registerDialogPreparation,
    requestNavigation, cancelNavigation, approveNavigation]);
  return <GuardContext.Provider value={value}>{children}
    {(intent?.phase === "NAVIGATING" || intent?.phase === "RECOVERABLE_FAILURE") &&
      <div className="admin-guard-navigation-status" role="status" aria-live="polite">
        <p>{intent.phase === "RECOVERABLE_FAILURE"
          ? "Navigation could not start. / 导航未能开始。"
          : "Navigation is in progress. The earlier request may still finish. / 正在导航；此前的请求仍可能完成。"}</p>
        <button ref={resumeRef} type="button" onClick={resumeEditing}>
          Resume editing / 恢复编辑
        </button>
      </div>}
    {!intent && abandonedNotice &&
      <p className="admin-guard-resumed" role="status">
        An earlier navigation may still finish. Its destination cannot be submitted
        again from this page. / 此前的导航仍可能完成；在此页面无法再次提交同一目标。
      </p>}
    <dialog ref={dialogRef} className="admin-guard-dialog" aria-labelledby="admin-guard-title"
      data-navigation-intent-id={intent?.id ?? ""}
      data-navigation-lifecycle={intent?.phase ?? lastOutcome}
      aria-describedby="admin-guard-description" onKeyDown={trapFocus}
      onCancel={(event) => { event.preventDefault(); cancelNavigation(); }}>
      <h2 id="admin-guard-title">Unsaved local changes / 尚未保存的本地修改</h2>
      <p id="admin-guard-description">{intent?.type === "SIGN_OUT"
        ? "Signing out ends this local draft session. These changes are not saved to the server. / 登出将结束本地草稿会话；修改尚未保存到服务器。"
        : "These changes are not saved to the server. Continuing keeps the draft in this Admin tab for the current login session. / 修改尚未保存到服务器。继续导航后，同一登录会话中的此后台标签页会保留草稿。"}</p>
      <div className="admin-guard-actions">
        <button ref={stayRef} type="button" onClick={cancelNavigation}>Stay and keep editing / 留在此处继续编辑</button>
        <button type="button" onClick={() => intent && approveNavigation(intent.id)}>
          {intent?.type === "SIGN_OUT" ? "Sign out / 登出" : "Continue navigation / 继续导航"}</button>
      </div>
    </dialog>
  </GuardContext.Provider>;
}

export function useAdminUnsavedChanges(): Guard {
  const value = useContext(GuardContext);
  if (!value) throw new Error("Admin unsaved changes provider is missing");
  return value;
}

/** Existing links keep their synchronous confirmation until S4-C migration. */
export function GuardedAdminLink({ href, children, className }: {
  href: string; children: ReactNode; className?: string }) {
  const { confirmNavigation } = useAdminUnsavedChanges();
  return <Link href={href} className={className} onNavigate={(event) => {
    if (!confirmNavigation()) event.preventDefault();
  }}>{children}</Link>;
}
