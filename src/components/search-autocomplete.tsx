"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { products } from "@/lib/catalog/products";
import { categories } from "@/lib/catalog/taxonomy";
import { normalizeSearchQuery } from "@/lib/catalog/search";
import { getProductSuggestions, suggestionKeyAction } from "@/lib/catalog/suggestions";
import { searchSortHref } from "@/lib/catalog/sort";
import { localizedPath } from "@/lib/site/paths";
import { CatalogMedia } from "@/components/catalog-media";

export function SearchAutocomplete({ locale, initialQuery = "", compact = false, autoFocus = false, onNavigate, onEscape }: {
  locale: Locale; initialQuery?: string; compact?: boolean; autoFocus?: boolean; onNavigate?: () => void; onEscape?: () => void;
}) {
  const copy = getDictionary(locale).search;
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const id = useId();
  const [input, setInput] = useState(initialQuery);
  const [settled, setSettled] = useState(normalizeSearchQuery(initialQuery));
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const query = normalizeSearchQuery(input);
  const searchPath = localizedPath(locale, "/search");
  const allHref = searchSortHref(searchPath, query, "featured");

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { setFocused(false); setActiveIndex(-1); }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  const suggestions = useMemo(() => getProductSuggestions(settled, products, categories, locale), [settled, locale]);
  const open = focused && Array.from(query).length >= 2 && settled === query;
  const options = open ? suggestions.length + 1 : 0;
  const optionId = (index: number) => `${id}-option-${index}`;
  const navigate = (href: string) => { setFocused(false); setActiveIndex(-1); onNavigate?.(); router.push(href); };

  return <div ref={root} className={`search-autocomplete${compact ? " search-autocomplete-compact" : ""}`} onBlurCapture={(event) => {
    if (!root.current?.contains(event.relatedTarget as Node | null)) { setFocused(false); setActiveIndex(-1); }
  }}>
    <form action={searchPath} method="get" role="search" className="search-form">
      <label htmlFor={`${id}-input`} className={compact ? "search-autocomplete-visually-hidden" : ""}>{copy.label}</label>
      <div className="search-form-controls">
        <input id={`${id}-input`} name="q" type="search" value={input} autoFocus={autoFocus} autoComplete="off" maxLength={120}
          placeholder={copy.placeholder} role="combobox" aria-autocomplete="list" aria-haspopup="listbox"
          aria-expanded={open} aria-controls={open ? `${id}-listbox` : undefined}
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          onFocus={() => setFocused(true)} onChange={(event) => { setInput(event.target.value); setFocused(true); setActiveIndex(-1); }}
          onKeyDown={(event) => {
            const result = suggestionKeyAction(event.key, activeIndex, options);
            if (result.action === "close") {
              if (open || compact) { event.preventDefault(); setFocused(false); setActiveIndex(-1); onEscape?.(); }
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              if (open) { event.preventDefault(); setActiveIndex(result.activeIndex); }
            } else if (result.action === "navigate" && open) {
              event.preventDefault();
              navigate(activeIndex === suggestions.length ? allHref : localizedPath(locale, `/product/${suggestions[activeIndex].product.slug}`));
            }
          }} />
        <button type="submit">{copy.action}</button>
      </div>
    </form>
    <span className="search-autocomplete-visually-hidden" role="status" aria-live="polite">
      {open ? suggestions.length ? copy.suggestionsCount.replace("{count}", String(suggestions.length)) : copy.noSuggestions : ""}
    </span>
    {open && <div className="search-suggestions" id={`${id}-listbox`} role="listbox" aria-label={copy.suggestionsLabel}>
      {suggestions.length ? suggestions.map(({ product, sku }, index) => {
        const image = product.images.find((item) => item.role === "primary") ?? product.images[0];
        return <Link key={product.id} id={optionId(index)} role="option" aria-selected={index === activeIndex}
          className={`search-suggestion-item${index === activeIndex ? " is-active" : ""}`}
          href={localizedPath(locale, `/product/${product.slug}`)} onMouseEnter={() => setActiveIndex(index)} onClick={() => { setFocused(false); onNavigate?.(); }}>
          <span className="search-suggestion-image"><CatalogMedia visual={image?.visual ?? "press-on"} image={image} alt={image?.alt[locale] ?? ""} sizes="56px" /></span>
          <span className="search-suggestion-copy"><strong>{product.name[locale]}</strong><small>SKU: {sku}</small>{image?.isPlaceholder && <small>{copy.placeholderImage}</small>}</span>
        </Link>;
      }) : <p className="search-suggestion-empty">{copy.noSuggestions}</p>}
      <Link id={optionId(suggestions.length)} role="option" aria-selected={activeIndex === suggestions.length}
        className={`search-suggestion-all${activeIndex === suggestions.length ? " is-active" : ""}`}
        href={allHref} onMouseEnter={() => setActiveIndex(suggestions.length)} onClick={() => { setFocused(false); onNavigate?.(); }}>
        {copy.viewAllResults} <span aria-hidden="true">↗</span>
      </Link>
    </div>}
  </div>;
}
