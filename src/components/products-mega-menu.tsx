"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

const CLOSE_DELAY_MS = 150;

type ProductsMegaMenuProps = {
  href: string;
  label: string;
  toggleLabel: string;
  children: ReactNode;
};

export function ProductsMegaMenu({ href, label, toggleLabel, children }: ProductsMegaMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelClose() {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function closeNow() {
    cancelClose();
    setOpen(false);
  }

  function scheduleClose() {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (rootRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
      setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    };
  }, []);

  function handleLinkClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as Element).closest("a")) closeNow();
  }

  return <div
    className="products-menu"
    ref={rootRef}
    onMouseEnter={() => { cancelClose(); setOpen(true); }}
    onMouseLeave={scheduleClose}
    onFocusCapture={(event) => {
      cancelClose();
      if (!toggleRef.current?.contains(event.target)) setOpen(true);
    }}
    onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose();
    }}
    onClickCapture={handleLinkClick}
  >
    <div className="products-menu-trigger">
      <Link href={href}>{label}</Link>
      <button
        ref={toggleRef}
        type="button"
        className="products-menu-toggle"
        aria-label={toggleLabel}
        aria-expanded={open}
        aria-controls="products-mega-menu"
        onClick={() => { cancelClose(); setOpen((current) => !current); }}
      ><span aria-hidden="true">⌄</span></button>
    </div>
    <div id="products-mega-menu" className="products-menu-panel" hidden={!open}>{children}</div>
  </div>;
}
