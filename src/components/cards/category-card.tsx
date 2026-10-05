import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Category } from "@/lib/catalog/types";
import { getCategorySlugPath } from "@/lib/catalog/taxonomy";
import { localizedPath } from "@/lib/site/paths";
import { CatalogMedia } from "@/components/catalog-media";
import { getDictionary } from "@/i18n/dictionaries";
import { categoryVisuals } from "@/lib/site/visual-assets";

export function CategoryCard({ category, locale }: { category: Category; locale: Locale }) {
  const href = localizedPath(locale, `/products/${getCategorySlugPath(category).join("/")}`);
  const image = categoryVisuals[category.id];
  return <article className="category-card-v3">
    <Link href={href} aria-label={`${getDictionary(locale).common.explore} ${category.name[locale]}`} className="card-media-link"><CatalogMedia visual={category.visual} image={image} alt={image?.alt[locale]} sizes="(max-width: 680px) 100vw, (max-width: 900px) 50vw, 33vw" /></Link>
    <div className="card-copy"><div><h3>{category.name[locale]}</h3><p>{category.shortDescription[locale]}</p></div><Link href={href} className="text-link">{getDictionary(locale).common.explore} <span aria-hidden="true">↗</span></Link></div>
  </article>;
}
