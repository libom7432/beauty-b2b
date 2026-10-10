"use client";

import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { useInquiry } from "./inquiry-provider";

export function AddToInquiry({ productId, sku, locale, compact = false }: { productId: string; sku?: string; locale: Locale; compact?: boolean }) {
  const { addItem, hasItem, ready } = useInquiry();
  const copy = getDictionary(locale).inquiry;
  const added = !!sku && hasItem(sku);
  const label = added ? copy.added : copy.add;
  return <button className={`add-to-inquiry${compact ? " add-to-inquiry-compact" : ""}`} type="button" disabled={!ready || !sku || added} aria-label={`${label}${sku ? `: ${sku}` : ""}`} onClick={() => { if (sku) addItem(productId, sku); }}>
    {label}
  </button>;
}
