"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { products } from "@/lib/catalog/products";
import { addInquiryItem, readInquiry, removeInquiryItem, restoreInquiryItem, updateInquiryQuantity, type InquiryItem, type InquiryRemoval } from "@/lib/catalog/inquiry";

const STORAGE_KEY = "beauty-b2b-inquiry-v1";
type InquirySnapshot = { items: InquiryItem[]; ready: boolean };
const serverSnapshot: InquirySnapshot = { items: [], ready: false };
let snapshot: InquirySnapshot = serverSnapshot;
const listeners = new Set<() => void>();

function getSnapshot() {
  if (!snapshot.ready) {
    let items: InquiryItem[] = [];
    try { items = readInquiry(localStorage.getItem(STORAGE_KEY), products); } catch { /* Storage can be unavailable. */ }
    snapshot = { items, ready: true };
  }
  return snapshot;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    snapshot = { items: readInquiry(event.newValue, products), ready: true };
    listeners.forEach((notify) => notify());
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}
function updateItems(items: InquiryItem[]) {
  snapshot = { items, ready: true };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* Keep the in-memory list usable. */ }
  listeners.forEach((notify) => notify());
}
type InquiryContextValue = {
  items: InquiryItem[];
  itemCount: number;
  ready: boolean;
  addItem: (productId: string, sku: string) => void;
  removeItem: (sku: string) => InquiryRemoval | undefined;
  restoreItem: (removal: InquiryRemoval) => void;
  updateQuantity: (sku: string, quantity: number) => void;
  clearInquiry: () => void;
  hasItem: (sku: string) => boolean;
};
const InquiryContext = createContext<InquiryContextValue | null>(null);

export function InquiryProvider({ children }: { children: ReactNode }) {
  const { items, ready } = useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);

  const value: InquiryContextValue = {
    items, itemCount: items.length, ready,
    addItem: (productId, sku) => updateItems(addInquiryItem(getSnapshot().items, products, productId, sku, new Date().toISOString())),
    removeItem: (sku) => {
      const result = removeInquiryItem(getSnapshot().items, sku);
      if (result.removed) updateItems(result.items);
      return result.removed;
    },
    restoreItem: (removal) => updateItems(restoreInquiryItem(getSnapshot().items, removal)),
    updateQuantity: (sku, quantity) => updateItems(updateInquiryQuantity(getSnapshot().items, sku, quantity)),
    clearInquiry: () => updateItems([]),
    hasItem: (sku) => items.some((item) => item.sku === sku),
  };
  return <InquiryContext.Provider value={value}>{children}</InquiryContext.Provider>;
}

export function useInquiry() {
  const context = useContext(InquiryContext);
  if (!context) throw new Error("useInquiry must be used within InquiryProvider");
  return context;
}
