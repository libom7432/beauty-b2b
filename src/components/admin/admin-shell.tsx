"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminRouteLabel, type AdminNavItem } from "@/lib/admin/navigation";
import { LogoutForm } from "@/app/admin/logout-form";
import { AdminUnsavedChangesProvider, useAdminUnsavedChanges } from "./admin-unsaved-changes";

function SidebarContents({ items, pathname, onNavigate, onClose, closeButton }: {
  items: readonly AdminNavItem[]; pathname: string; onNavigate?: () => void;
  onClose?: () => void; closeButton?: React.RefObject<HTMLButtonElement | null>;
}) {
  const { confirmNavigation } = useAdminUnsavedChanges();
  return <>
    <div className="admin-sidebar-top">
      <Link href="/admin" className="admin-brand"
        onNavigate={(event) => { if (!confirmNavigation()) event.preventDefault(); else onNavigate?.(); }}>
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
          onNavigate={(event) => { if (!confirmNavigation()) event.preventDefault(); else onNavigate?.(); }}>
          <span>{item.label}</span><span className="admin-nav-number" aria-hidden="true">{item.number}</span>
        </Link>;
      })}
    </nav>
    <div className="admin-sidebar-bottom"><span className="admin-status-dot" /> READ ONLY · SPRINT 2.6</div>
  </>;
}

function AdminShellContents({ children, items, administrator }: {
  children: ReactNode; items: readonly AdminNavItem[]; administrator: string;
}) {
  const { confirmNavigation } = useAdminUnsavedChanges();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const mobileDialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef(false);
  const previousPathname = useRef(pathname);
  const title = adminRouteLabel(pathname);
  const detail = pathname.startsWith("/admin/products/");

  const closeMenu = useCallback((restore: boolean) => {
    restoreFocus.current = restore;
    if (mobileDialog.current?.open) mobileDialog.current.close();
    setMenuOpen(false);
  }, []);

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
              <Link href="/admin" onNavigate={(event) => { if (!confirmNavigation()) event.preventDefault(); }}>Admin</Link>
              {pathname !== "/admin" && <><span aria-hidden="true">/</span>{detail ? <><Link href="/admin/products" onNavigate={(event) => { if (!confirmNavigation()) event.preventDefault(); }}>Products</Link><span aria-hidden="true">/</span><span aria-current="page">Detail</span></> : <span aria-current="page">{title}</span>}</>}
            </nav>
            <p className="admin-topbar-title">{title}</p>
          </div>
        </div>
        <div className="admin-account"><span className="admin-avatar" role="img" aria-label={`Administrator ID ending ${administrator}`}>A</span><span className="admin-account-copy"><strong>Administrator</strong><small>ID · {administrator}</small></span><LogoutForm /></div>
      </header>
      <main id="admin-content" className="admin-content">{children}</main>
    </div>
  </div>;
}

export function AdminShell(props: { children: ReactNode; items: readonly AdminNavItem[]; administrator: string }) {
  return <AdminUnsavedChangesProvider><AdminShellContents {...props} /></AdminUnsavedChangesProvider>;
}
