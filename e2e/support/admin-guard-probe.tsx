"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { useAdminUnsavedChanges } from "@/components/admin/admin-unsaved-changes";

/** Mounted only in the isolated Admin fixture; the Guard and Owner are production components. */
export function AdminGuardProbe() {
  const { requestNavigation, approveNavigation } = useAdminUnsavedChanges();
  const [enabled, setEnabled] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [approvalId, setApprovalId] = useState("");
  useEffect(() => {
    queueMicrotask(() => setEnabled(document.cookie.split("; ").includes("admin-guard-probe=1")));
  }, []);
  if (!enabled) return null;
  const submit = (event: MouseEvent<HTMLButtonElement>, target: string,
    scope: "GLOBAL" | "COLLECTION" | "CURRENT" = "GLOBAL") => {
    const result = requestNavigation({ target, type: "PUSH", scope,
      collectionId: location.pathname.split("/")[3], trigger: event.currentTarget });
    setResults((prior) => [...prior, result]);
  };
  return <aside aria-label="Isolated guard probe" data-testid="admin-guard-probe">
    <button type="button" onClick={(event) => submit(event, "/admin")}>Probe Dashboard</button>
    <button type="button" onClick={(event) => submit(event, "/admin/products")}>Probe Products</button>
    <button type="button" onClick={(event) => submit(event, "/admin", "COLLECTION")}>Probe Collection scope</button>
    <button type="button" onClick={(event) => submit(event,
      "/admin/collections/00000002-0000-4000-8000-000000000000", "CURRENT")}>Probe Other Collection</button>
    <label>Probe approval ID<input value={approvalId}
      onChange={(event) => setApprovalId(event.target.value)} /></label>
    <button type="button" onClick={() => approveNavigation(Number(approvalId))}>Probe approve ID</button>
    <output data-testid="guard-probe-results">{results.join(",")}</output>
  </aside>;
}
