"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { products } from "@/lib/catalog/products";
import { addInquiryItem, readInquiry, removeInquiryItem, restoreInquiryItem, updateInquiryQuantity, type InquiryItem, type InquiryRemoval } from "@/lib/catalog/inquiry";

const STORAGE_KEY = "beauty-b2b-inquiry-v1";
type InquirySnapshot = { items: InquiryItem[]; invalidItemCount: number; ready: boolean };
const serverSnapshot: InquirySnapshot = { items: [], invalidItemCount: 0, ready: false };
let snapshot: InquirySnapshot = serverSnapshot;
const listeners = new Set<() => void>();

function getSnapshot() {
  if (!snapshot.ready) {
    try { snapshot = restoredSnapshot(localStorage.getItem(STORAGE_KEY)); }
    catch { snapshot = { items: [], invalidItemCount: 0, ready: true }; /* Storage can be unavailable. */ }
  }
  return snapshot;
}
function restoredSnapshot(value: string | null): InquirySnapshot {
  const items = readInquiry(value, products);
  let invalidItemCount = 0;
  if (value) {
    try {
      const parsed: unknown = JSON.parse(value);
      invalidItemCount = Array.isArray(parsed) ? Math.max(0, parsed.length - items.length) : 1;
    } catch { invalidItemCount = 1; }
  }
  return { items, invalidItemCount, ready: true };
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    snapshot = restoredSnapshot(event.newValue);
    listeners.forEach((notify) => notify());
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}
function updateItems(items: InquiryItem[]) {
  snapshot = { items, invalidItemCount: 0, ready: true };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* Keep the in-memory list usable. */ }
  listeners.forEach((notify) => notify());
}
type InquiryContextValue = {
  items: InquiryItem[];
  itemCount: number;
  invalidItemCount: number;
  ready: boolean;
  addItem: (productId: string, sku: string) => void;
  removeItem: (sku: string) => InquiryRemoval | undefined;
  restoreItem: (removal: InquiryRemoval) => void;
  updateQuantity: (sku: string, quantity: number) => void;
  clearInquiry: () => void;
  discardInvalidItems: () => void;
  hasItem: (sku: string) => boolean;
};
const InquiryContext = createContext<InquiryContextValue | null>(null);

export function InquiryProvider({ children }: { children: ReactNode }) {
  const { items, invalidItemCount, ready } = useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);

  const value: InquiryContextValue = {
    items, itemCount: items.length, invalidItemCount, ready,
    addItem: (productId, sku) => updateItems(addInquiryItem(getSnapshot().items, products, productId, sku, new Date().toISOString())),
    removeItem: (sku) => {
      const result = removeInquiryItem(getSnapshot().items, sku);
      if (result.removed) updateItems(result.items);
      return result.removed;
    },
    restoreItem: (removal) => updateItems(restoreInquiryItem(getSnapshot().items, removal)),
    updateQuantity: (sku, quantity) => updateItems(updateInquiryQuantity(getSnapshot().items, sku, quantity)),
    clearInquiry: () => updateItems([]),
    discardInvalidItems: () => updateItems(getSnapshot().items),
    hasItem: (sku) => items.some((item) => item.sku === sku),
  };
  return <InquiryContext.Provider value={value}>{children}</InquiryContext.Provider>;
}

export function useInquiry() {
  const context = useContext(InquiryContext);
  if (!context) throw new Error("useInquiry must be used within InquiryProvider");
  return context;
}
