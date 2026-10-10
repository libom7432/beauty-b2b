"use client";

import { useRef, type ReactNode } from "react";

export function MobileFilterDrawer({ label, closeLabel, children }: { label: string; closeLabel: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <div className="catalog-filters-mobile">
    <button className="catalog-filter-trigger" type="button" onClick={() => dialog.current?.showModal()}>{label}</button>
    <dialog ref={dialog} className="catalog-filter-dialog" aria-label={label} onClick={(event) => {
      if (event.target === dialog.current) dialog.current?.close();
    }} onClickCapture={(event) => {
      if ((event.target as HTMLElement).closest("a[href]")) dialog.current?.close();
    }}>
      <div className="catalog-filter-drawer">
        <button className="catalog-filter-close" type="button" onClick={() => dialog.current?.close()} aria-label={closeLabel}>×</button>
        {children}
      </div>
    </dialog>
  </div>;
}
