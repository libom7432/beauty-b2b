"use client";

import { useRouter } from "next/navigation";
import type { ProductSort } from "@/lib/catalog/sort";

export function ProductSortSelect({ label, value, options }: {
  label: string;
  value: ProductSort;
  options: { value: ProductSort; label: string; href: string }[];
}) {
  const router = useRouter();
  return <label className="product-sort-select"><span>{label}</span><span className="product-sort-control"><select value={value} onChange={(event) => {
    const destination = options.find((option) => option.value === event.currentTarget.value);
    if (destination) router.push(destination.href, { scroll: false });
  }}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 5 4 4 4-4" /></svg></span></label>;
}
