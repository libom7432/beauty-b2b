"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ADMIN_NAVIGATION, adminRouteLabel, isAdminCollectionDetailPath, type AdminNavItem } from "@/lib/admin/navigation";
import { LogoutForm } from "@/app/admin/logout-form";
import { AdminUnsavedChangesProvider, useAdminUnsavedChanges } from "./admin-unsaved-changes";
import { AdminCollectionDraftSessionProvider } from "./admin-collection-draft-sessions";
import { createCollectionDraftSessionOwner } from "@/lib/admin/collection-draft-session-owner";
import { collectionSessionDirty } from "@/lib/admin/collection-draft-session";

type IdentityState = { phase: "VERIFYING" | "INVALID" } |
  { phase: "VERIFIED"; routeKey: string; identityKey: string; canReadCatalog: boolean;
    canReadRFQ: boolean; visitEpoch: number };
type Confirmation = { kind: "VERIFIED"; key: string; canReadCatalog: boolean; canReadRFQ: boolean } |
  { kind: "REJECTED" } | { kind: "UNAVAILABLE" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sessionHash = /^[0-9a-f]{64}$/;
const locationRouteKey = () =>
  `${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`;
const requiresCatalogRead = (pathname: string) => ADMIN_NAVIGATION.some((item) =>
  item.permission === "catalog.read" &&
  (pathname === item.href || pathname.startsWith(`${item.href}/`)));
const requiresRFQRead = (pathname: string) => pathname === "/admin/rfq" || pathname.startsWith("/admin/rfq/");

function SidebarContents({ items, pathname, onNavigate, onClose, closeButton }: {
  items: readonly AdminNavItem[]; pathname: string; onNavigate?: () => void;
  onClose?: () => void; closeButton?: React.RefObject<HTMLButtonElement | null>;
}) {
  const { requestNavigation } = useAdminUnsavedChanges();
  const navigate = (target: string) => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const result = requestNavigation({ type: "PUSH", scope: "GLOBAL", target, trigger });
    if (result === "EXECUTED") onNavigate?.();
  };
  return <>
    <div className="admin-sidebar-top">
      <Link href="/admin" className="admin-brand"
        onNavigate={(event) => { event.preventDefault(); navigate("/admin"); }}>
        <span className="admin-brand-mark" aria-hidden="true">B.</span>
        <span><strong>BEAUTY B2B</strong><small>ADMIN CONSOLE</small></span>
      </Link>
      {onClose && <button ref={closeButton} type="button" className="admin-mobile-close" aria-label="Close menu" onClick={onClose}>×</button>}
    </div>
    <p className="admin-sidebar-label">WORKSPACE</p>
    <nav aria-label="Admin navigation" className="admin-navigation">
      {items.map((item) => {
        const current = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
        return <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined}
          className={`admin-nav-link${current ? " admin-nav-link-active" : ""}`}
          onNavigate={(event) => { event.preventDefault(); navigate(item.href); }}>
          <span>{item.label}</span><span className="admin-nav-number" aria-hidden="true">{item.number}</span>
        </Link>;
      })}
    </nav>
    <div className="admin-sidebar-bottom"><span className="admin-status-dot" /> READ ONLY · SPRINT 2.6</div>
  </>;
}

function AdminShellContents({ children, items, administrator, onSignOut, onSignOutFailure }: {
  children: ReactNode; items: readonly AdminNavItem[]; administrator: string;
  onSignOut: () => void; onSignOutFailure: () => void;
}) {
  const { requestNavigation, registerDialogPreparation } = useAdminUnsavedChanges();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const mobileDialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef(false);
  const previousPathname = useRef(pathname);
  const title = adminRouteLabel(pathname);
  const productDetail = pathname.startsWith("/admin/products/");
  const collectionDetail = isAdminCollectionDetailPath(pathname);

  const navigateBreadcrumb = (target: string) => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestNavigation({ type: "PUSH", scope: "GLOBAL", target, trigger });
  };

  const closeMenu = useCallback((restore: boolean) => {
    restoreFocus.current = restore;
    if (mobileDialog.current?.open) mobileDialog.current.close();
    setMenuOpen(false);
  }, []);

  useLayoutEffect(() => registerDialogPreparation(() => {
    if (!mobileDialog.current?.open) return null;
    closeMenu(false);
    return menuButton.current;
  }), [registerDialogPreparation, closeMenu]);

  useEffect(() => {
    const dialog = mobileDialog.current;
    if (!dialog) return;
    if (menuOpen && !dialog.open) {
      dialog.showModal();
      closeButton.current?.focus();
    } else if (!menuOpen && dialog.open) {
      dialog.close();
    }
  }, [menuOpen]);

  useEffect(() => {
    const dialog = mobileDialog.current;
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  useEffect(() => {
    if (previousPathname.current !== pathname) {
      previousPathname.current = pathname;
      closeMenu(false);
    }
  }, [pathname, closeMenu]);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 850px)");
    const onBreakpointChange = () => closeMenu(false);
    mobile.addEventListener("change", onBreakpointChange);
    return () => mobile.removeEventListener("change", onBreakpointChange);
  }, [closeMenu]);

  const onDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX >= bounds.right ||
      event.clientY < bounds.top || event.clientY >= bounds.bottom) closeMenu(true);
  };

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
    if (!focusable.length) return;
    const current = document.activeElement;
    if (event.shiftKey && current === focusable[0]) {
      event.preventDefault();
      focusable.at(-1)?.focus();
    } else if (!event.shiftKey && current === focusable.at(-1)) {
      event.preventDefault();
      focusable[0].focus();
    }
  };

  return <div className="admin-shell">
    <aside className="admin-sidebar" aria-label="Admin sidebar">
      <SidebarContents items={items} pathname={pathname} />
    </aside>
    <dialog ref={mobileDialog} id="admin-mobile-dialog" className="admin-mobile-dialog" aria-label="Admin menu"
      onCancel={(event) => { event.preventDefault(); closeMenu(true); }}
      onClose={() => { setMenuOpen(false); if (restoreFocus.current) menuButton.current?.focus(); restoreFocus.current = false; }}
      onKeyDown={onDialogKeyDown}
      onClick={onDialogClick}>
      <SidebarContents items={items} pathname={pathname} closeButton={closeButton}
        onClose={() => closeMenu(true)} onNavigate={() => closeMenu(false)} />
    </dialog>
    <div className="admin-main-column">
      <header className="admin-topbar">
        <div className="admin-topbar-leading">
          <button ref={menuButton} type="button" className="admin-menu-trigger" aria-label="Open admin menu"
            aria-expanded={menuOpen} aria-controls="admin-mobile-dialog" onClick={() => setMenuOpen(true)}>
            <span aria-hidden="true">☰</span>
          </button>
          <div>
            <nav aria-label="Breadcrumb" className="admin-breadcrumb">
              <Link href="/admin" onNavigate={(event) => { event.preventDefault(); navigateBreadcrumb("/admin"); }}>Admin</Link>
              {pathname !== "/admin" && <><span aria-hidden="true">/</span>{productDetail ? <><Link href="/admin/products" onNavigate={(event) => { event.preventDefault(); navigateBreadcrumb("/admin/products"); }}>Products</Link><span aria-hidden="true">/</span><span aria-current="page">Detail</span></> : collectionDetail ? <><Link href="/admin/collections" onNavigate={(event) => { event.preventDefault(); navigateBreadcrumb("/admin/collections"); }}>Collections</Link><span aria-hidden="true">/</span><span aria-current="page">Detail</span></> : <span aria-current="page">{title}</span>}</>}
            </nav>
            <p className="admin-topbar-title">{title}</p>
          </div>
        </div>
        <div className="admin-account"><span className="admin-avatar" role="img" aria-label={`Administrator ID ending ${administrator}`}>A</span><span className="admin-account-copy"><strong>Administrator</strong><small>ID · {administrator}</small></span><LogoutForm onStart={onSignOut} onFailure={onSignOutFailure} /></div>
      </header>
      <main id="admin-content" className="admin-content">{children}</main>
    </div>
  </div>;
}

export function AdminShell(props: { children: ReactNode; items: readonly AdminNavItem[];
  administrator: string; adminId: string; sessionKey: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const routeKey = `${pathname}?${search.toString()}`;
  const expectedKey = `${props.adminId}:${props.sessionKey}`;
  const [owner, setOwner] = useState(() => createCollectionDraftSessionOwner(false));
  const [identity, setIdentity] = useState<IdentityState>({ phase: "VERIFYING" });
  const [revokedRoute, setRevokedRoute] = useState<string | null>(null);
  const revokedRouteRef = useRef<string | null>(null);
  const sequence = useRef(0);
  const request = useRef<AbortController | null>(null);
  const invalidateGuard = useRef<(() => void) | null>(null);
  const invalidateCurrentGuard = useCallback(() => invalidateGuard.current?.(), []);
  const catalogRoute = requiresCatalogRead(pathname);
  const rfqRoute = requiresRFQRead(pathname);
  const catalogDenied = catalogRoute && revokedRoute === routeKey;
  const active = identity.phase === "VERIFIED" && identity.routeKey === routeKey &&
    identity.identityKey === expectedKey && !catalogDenied &&
    (!catalogRoute || identity.canReadCatalog) && (!rfqRoute || identity.canReadRFQ);
  const draftActive = active && identity.canReadCatalog;
  const visitEpoch = identity.phase === "VERIFIED" ? identity.visitEpoch : 0;
  const authorityEpoch = owner.getAccessEpoch();
  const readGuardAuthority = () => active && owner.getAccessEpoch() === authorityEpoch &&
    (!identity.canReadCatalog || owner.isCurrentAccess(authorityEpoch))
    ? { identityKey: expectedKey, accessEpoch: authorityEpoch } : null;
  const readCollectionDirty = (collectionId: string) => {
    const entry = owner.getSnapshot().state.entries[collectionId.toLowerCase()];
    return entry ? collectionSessionDirty(entry) : false;
  };

  const verifyIdentity = useCallback((markPending = true, targetRoute = locationRouteKey()) => {
    if (revokedRouteRef.current && revokedRouteRef.current !== targetRoute) {
      revokedRouteRef.current = null;
      setRevokedRoute(null);
    }
    invalidateGuard.current?.();
    owner.lock();
    const current = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (markPending) setIdentity({ phase: "VERIFYING" });
    void fetch("/api/admin/session-identity", { cache: "no-store", credentials: "same-origin",
      signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (response): Promise<Confirmation> => {
        if (response.status === 401 || response.status === 403) return { kind: "REJECTED" };
        if (!response.ok) return { kind: "UNAVAILABLE" };
        const body: unknown = await response.json();
        if (!body || typeof body !== "object") return { kind: "UNAVAILABLE" };
        const value = body as Record<string, unknown>;
        if (typeof value.adminId !== "string" || !uuid.test(value.adminId) ||
          typeof value.sessionKey !== "string" || !sessionHash.test(value.sessionKey) ||
          typeof value.canReadCatalog !== "boolean" || typeof value.canReadRFQ !== "boolean")
          return { kind: "UNAVAILABLE" };
        return { kind: "VERIFIED", key: `${value.adminId}:${value.sessionKey}`,
          canReadCatalog: value.canReadCatalog, canReadRFQ: value.canReadRFQ };
      })
      .then((confirmation) => {
        const latestRoute = locationRouteKey();
        if (controller.signal.aborted || current !== sequence.current ||
          latestRoute !== targetRoute) return;
        if (confirmation.kind === "VERIFIED" && confirmation.key === expectedKey) {
          if (!confirmation.canReadRFQ && requiresRFQRead(targetRoute.split("?", 1)[0])) {
            owner.destroy();
            revokedRouteRef.current = targetRoute;
            setRevokedRoute(targetRoute);
            setIdentity({ phase: "VERIFYING" });
            router.replace("/admin?rfq=forbidden");
            return;
          }
          if (!confirmation.canReadCatalog) {
            owner.destroy();
            if (requiresCatalogRead(targetRoute.split("?", 1)[0])) {
              // Drop stale server children before navigating. A later response for
              // this route must not remount an editor built from the old source.
              revokedRouteRef.current = targetRoute;
              setRevokedRoute(targetRoute);
              setIdentity({ phase: "VERIFYING" });
              router.replace("/admin/login?error=1");
              return;
            }
            router.refresh();
          } else if (revokedRouteRef.current === targetRoute) {
            // A newly restored grant still needs a fresh server page. The old
            // Collections children remain unmounted until we leave this route.
            setIdentity({ phase: "VERIFYING" });
            router.replace("/admin");
            return;
          } else if (owner.isDestroyed()) {
            const replacement = createCollectionDraftSessionOwner(false);
            replacement.unlock();
            setOwner(replacement);
            router.refresh();
          } else owner.unlock();
          setIdentity({ phase: "VERIFIED", routeKey: targetRoute, identityKey: confirmation.key,
            canReadCatalog: confirmation.canReadCatalog, canReadRFQ: confirmation.canReadRFQ,
            visitEpoch: current });
        } else if (confirmation.kind === "REJECTED" ||
          confirmation.kind === "VERIFIED") {
          owner.destroy();
          setIdentity({ phase: "INVALID" });
          router.refresh();
        } else setIdentity({ phase: "INVALID" });
      })
      .catch(() => {
        if (controller.signal.aborted || current !== sequence.current) return;
        setIdentity({ phase: "INVALID" });
      });
  }, [owner, expectedKey, router]);

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => { if (mounted) verifyIdentity(false, routeKey); });
    return () => { mounted = false; request.current?.abort(); invalidateCurrentGuard(); owner.lock(); };
  }, [verifyIdentity, owner, routeKey, invalidateCurrentGuard]);
  useEffect(() => {
    const onHidden = () => {
      ++sequence.current;
      request.current?.abort();
      invalidateGuard.current?.();
      owner.lock();
      setIdentity({ phase: "VERIFYING" });
    };
    const onFocus = () => verifyIdentity();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") verifyIdentity();
      else onHidden();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onHidden);
    window.addEventListener("pageshow", onFocus);
    window.addEventListener("storage", onFocus);
    window.addEventListener("popstate", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onHidden);
      window.removeEventListener("pageshow", onFocus);
      window.removeEventListener("storage", onFocus);
      window.removeEventListener("popstate", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [verifyIdentity, owner]);
  const signOut = useCallback(() => {
    ++sequence.current;
    request.current?.abort();
    invalidateGuard.current?.();
    owner.lock();
    setIdentity({ phase: "INVALID" });
  }, [owner]);

  return <AdminUnsavedChangesProvider readAuthority={readGuardAuthority}
    invalidationRef={invalidateGuard}
    readCollectionDirty={readCollectionDirty}><AdminCollectionDraftSessionProvider owner={owner}
    active={draftActive} visitEpoch={visitEpoch}>
    <div hidden={!active} inert={!active} aria-hidden={!active}>
      {!catalogDenied && <AdminShellContents {...props}
        items={identity.phase === "VERIFIED" ? props.items.filter((item) =>
          (item.permission !== "catalog.read" || identity.canReadCatalog) &&
          (item.permission !== "rfq.read" || identity.canReadRFQ)) : props.items}
        onSignOut={signOut} onSignOutFailure={verifyIdentity} />}
    </div>
    {!active && <div className="admin-identity-status" role="status">
      {identity.phase === "INVALID" ? "Admin identity is unavailable. Reload or sign in again."
        : "Confirming administrator identity…"}
    </div>}
  </AdminCollectionDraftSessionProvider></AdminUnsavedChangesProvider>;
}
