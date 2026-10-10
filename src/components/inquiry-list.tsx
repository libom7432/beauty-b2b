"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { products } from "@/lib/catalog/products";
import { findInquiryVariant, validQuantity, type InquiryRemoval } from "@/lib/catalog/inquiry";
import { localizedPath } from "@/lib/site/paths";
import { CatalogMedia } from "./catalog-media";
import { useInquiry } from "./inquiry-provider";

function QuantityInput({ sku, quantity, label, updateQuantity }: { sku: string; quantity: number; label: string; updateQuantity: (sku: string, quantity: number) => void }) {
  const [draft, setDraft] = useState(String(quantity));
  const commit = () => {
    const next = Number(draft);
    if (/^[1-9]\d*$/.test(draft) && validQuantity(next)) updateQuantity(sku, next);
    else setDraft(String(quantity));
  };
  return <label>{label}<input type="number" min="1" step="1" inputMode="numeric" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>;
}

export function InquiryList({ locale }: { locale: Locale }) {
  const { items, ready, removeItem, restoreItem, updateQuantity, clearInquiry } = useInquiry();
  const copy = getDictionary(locale).inquiry;
  const undoStack = useRef<InquiryRemoval[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const [undoCount, setUndoCount] = useState(0);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const dismissToast = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = null;
    undoStack.current = [];
    setUndoCount(0);
  };
  const startToastTimer = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      undoStack.current = [];
      setUndoCount(0);
      toastTimer.current = null;
    }, 5000);
  };
  const handleRemove = (sku: string) => {
    const removed = removeItem(sku);
    if (!removed) return;
    undoStack.current.push(removed);
    setUndoCount(undoStack.current.length);
    startToastTimer();
  };
  const handleUndo = () => {
    const last = undoStack.current.pop();
    if (!last) return;
    restoreItem(last);
    setUndoCount(undoStack.current.length);
    if (undoStack.current.length) startToastTimer();
    else if (toastTimer.current) { clearTimeout(toastTimer.current); toastTimer.current = null; }
  };
  const handleClear = () => {
    clearInquiry();
    dismissToast();
    confirmDialog.current?.close();
  };
  return <section className="inquiry-list" aria-label={copy.title}>
    {ready && items.length === 0 ? <div className="inquiry-empty"><p>{copy.empty}</p><Link href={localizedPath(locale, "/products")}>{copy.continueShopping}</Link></div> : null}
    {items.map((item) => {
      const match = findInquiryVariant(products, item.productId, item.sku);
      if (!match) return null;
      const { product, variant } = match;
      const image = product.images[variant.imageIndex ?? 0] ?? product.images[0];
      return <article className="inquiry-row" key={item.sku}>
        <Link className="inquiry-row-image" href={localizedPath(locale, `/product/${product.slug}`)} aria-label={product.name[locale]}><CatalogMedia visual={image?.visual ?? "press-on"} image={image} alt={image?.alt[locale] ?? ""} /></Link>
        <div className="inquiry-row-details"><Link href={localizedPath(locale, `/product/${product.slug}`)}>{product.name[locale]}</Link><span>SKU: {item.sku}</span><span>{copy.moq}: {variant.moq.quantity} {variant.moq.unit}</span>{image?.isPlaceholder && <small>{copy.placeholder}</small>}</div>
        <div className="inquiry-row-actions"><QuantityInput key={`${item.sku}:${item.quantity}`} sku={item.sku} quantity={item.quantity} label={copy.quantity} updateQuantity={updateQuantity} /><button type="button" onClick={() => handleRemove(item.sku)} aria-label={`${copy.remove}: ${product.name[locale]} ${item.sku}`}>{copy.remove}</button></div>
      </article>;
    })}
    {ready && items.length > 0 && <div className="inquiry-list-footer"><Link href={localizedPath(locale, "/products")}>{copy.continueShopping}</Link><button type="button" onClick={() => confirmDialog.current?.showModal()}>{copy.clear}</button></div>}
    <dialog className="inquiry-confirm-dialog" ref={confirmDialog} aria-labelledby="inquiry-clear-title" aria-describedby="inquiry-clear-description">
      <h2 id="inquiry-clear-title">{copy.clearConfirmTitle}</h2><p id="inquiry-clear-description">{copy.clearConfirmBody}</p>
      <div className="inquiry-confirm-actions"><button type="button" autoFocus onClick={() => confirmDialog.current?.close()}>{copy.cancel}</button><button type="button" onClick={handleClear}>{copy.confirmClear}</button></div>
    </dialog>
    {undoCount > 0 && <div className="inquiry-toast" role="status"><span>{copy.removed}</span><button type="button" onClick={handleUndo}>{copy.undo}</button></div>}
    <p className="inquiry-note">{copy.noSubmission}</p>
  </section>;
}
