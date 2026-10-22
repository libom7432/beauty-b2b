"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode } from "react";
import Link from "next/link";

type Guard = { setDirty: (dirty: boolean) => void; confirmNavigation: () => boolean };
const GuardContext = createContext<Guard | null>(null);
const warning = "Your local draft will be lost. Leave this page?";

export function AdminUnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const confirmNavigation = useCallback(() => {
    return !dirty || window.confirm(warning);
  }, [dirty]);
  const value = useMemo(() => ({ setDirty, confirmNavigation }), [confirmNavigation]);
  return <GuardContext.Provider value={value}>{children}</GuardContext.Provider>;
}

export function useAdminUnsavedChanges(): Guard {
  const value = useContext(GuardContext);
  if (!value) throw new Error("Admin unsaved changes provider is missing");
  return value;
}

/** Next Link's onNavigate guards controlled in-app links without replacing browser history. */
export function GuardedAdminLink({ href, children, className }: {
  href: string; children: ReactNode; className?: string }) {
  const { confirmNavigation } = useAdminUnsavedChanges();
  return <Link href={href} className={className} onNavigate={(event) => {
    if (!confirmNavigation()) event.preventDefault();
  }}>{children}</Link>;
}
