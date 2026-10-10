import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Category } from "@/lib/catalog/types";
import { getCategoryById, getCategoryChildren, getCategorySlugPath, getTopCategories } from "@/lib/catalog/taxonomy";
import { filterHref, toggleFilter, type FilterGroup, type FilterSelection } from "@/lib/catalog/filter";
import type { ProductSort } from "@/lib/catalog/sort";
import { localizedPath } from "@/lib/site/paths";
import { getDictionary } from "@/i18n/dictionaries";
import { MobileFilterDrawer } from "@/components/mobile-filter-drawer";

export function CatalogFilters({ locale, category, groups, selection, basePath, sort }: {
  locale: Locale; category: Category; groups: FilterGroup[]; selection: FilterSelection; basePath: string; sort: ProductSort;
}) {
  const copy = getDictionary(locale).filters;
  const selected = groups.flatMap((group) => group.options.filter((option) => selection[group.key]?.includes(option.value)).map((option) => ({ group, option })));
  let root = category;
  while (root.parentId) {
    const parent = getCategoryById(root.parentId);
    if (!parent) break;
    root = parent;
  }
  // Categories use the existing stable hierarchy and paths; labels are display-only.
  const categoryLink = (item: Category, depth: number) => <Link key={item.id} className={`filter-category-depth-${depth}`} aria-current={item.id === category.id ? "page" : undefined} href={localizedPath(locale, `/products/${getCategorySlugPath(item).join("/")}`)} scroll={false}>{item.name[locale]}</Link>;
  const body = <>
    <div className="filter-panel-head"><h3>{copy.title}</h3><Link href={filterHref(basePath, {}, groups, undefined, sort)} scroll={false}>{copy.clearAll}</Link></div>
    <div className="filter-section"><h4>{copy.category}</h4><div className="filter-category-links">
      {getTopCategories().map((top) => <div key={top.id}>
        {categoryLink(top, 1)}
        {top.id === root.id && getCategoryChildren(top.id).map((sub) => <div key={sub.id}>
          {categoryLink(sub, 2)}
          {getCategoryChildren(sub.id).map((child) => categoryLink(child, 3))}
        </div>)}
      </div>)}
    </div></div>
    {groups.map((group) => <fieldset className="filter-section" key={group.key}><legend>{group.label[locale]}</legend><div className="filter-options">
      {group.options.map((option) => {
        const active = selection[group.key]?.includes(option.value) ?? false;
        return <Link key={option.value} href={filterHref(basePath, toggleFilter(selection, group.key, option.value), groups, undefined, sort)} scroll={false} aria-label={`${group.label[locale]}: ${option.label}`} className={active ? "filter-option is-active" : "filter-option"}><span aria-hidden="true" className="filter-check">{active ? "✓" : ""}</span>{option.label}</Link>;
      })}
    </div></fieldset>)}
    {selected.length > 0 && <div className="filter-selected"><h4>{copy.active}</h4><div>{selected.map(({ group, option }) => <Link key={`${group.key}-${option.value}`} href={filterHref(basePath, toggleFilter(selection, group.key, option.value), groups, undefined, sort)} scroll={false} aria-label={`${copy.remove} ${group.label[locale]}: ${option.label}`}>{option.label} <span aria-hidden="true">×</span></Link>)}</div></div>}
  </>;
  return <>
    <aside className="catalog-filters-desktop" aria-label={copy.title}>{body}</aside>
    <MobileFilterDrawer label={`${copy.open}${selected.length ? ` (${selected.length})` : ""}`} closeLabel={copy.close}>{body}</MobileFilterDrawer>
  </>;
}
