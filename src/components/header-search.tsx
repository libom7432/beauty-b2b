"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { SearchAutocomplete } from "@/components/search-autocomplete";

export function HeaderSearch({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).search;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);
  return <div ref={root} className="header-search">
    <button ref={trigger} className="header-search-link" type="button" aria-label={copy.label} title={copy.label} aria-expanded={open} aria-controls={open ? popoverId : undefined}
      onClick={() => setOpen((value) => !value)}>
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 5 5" /></svg>
    </button>
    {open && <div id={popoverId} className="header-search-popover"><SearchAutocomplete locale={locale} compact autoFocus onNavigate={() => setOpen(false)} onEscape={() => { setOpen(false); trigger.current?.focus(); }} /></div>}
  </div>;
}
