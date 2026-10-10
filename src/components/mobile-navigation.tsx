"use client";

import { useRef, type ReactNode } from "react";

export function MobileNavigation({ label, children }: { label: string; children: ReactNode }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  return <details className="mobile-navigation" ref={detailsRef}>
    <summary aria-label={label}><span /><span /></summary>
    <nav className="mobile-navigation-panel" aria-label={label} onClick={(event) => {
      if (event.target instanceof Element && event.target.closest("a") && detailsRef.current) detailsRef.current.open = false;
    }}>{children}</nav>
  </details>;
}
