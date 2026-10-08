import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Category } from "@/lib/catalog/types";
import { getCategorySlugPath } from "@/lib/catalog/taxonomy";
import { localizedPath } from "@/lib/site/paths";
import { CatalogMedia } from "@/components/catalog-media";
import { getDictionary } from "@/i18n/dictionaries";
import { categoryVisuals } from "@/lib/site/visual-assets";
import type { HomeCategoryEntry } from "@/lib/site/home-category-entries";

type Props = { category: Category; locale: Locale; entry?: never } | { entry: HomeCategoryEntry; locale: Locale; category?: never };

export function CategoryCard(props: Props) {
  const { locale } = props;
  const category = props.entry ?? props.category;
  const path = props.entry ? props.entry.path : `/products/${getCategorySlugPath(props.category).join("/")}`;
  const href = localizedPath(locale, path);
  const image = categoryVisuals[category.id];
  return <article className="category-card-v3">
    <Link href={href} aria-label={`${getDictionary(locale).common.explore} ${category.name[locale]}`} className="category-card-link">
      <div className="card-media-link"><CatalogMedia visual={category.visual} image={image} alt={image?.alt[locale]} sizes="(max-width: 680px) 100vw, (max-width: 900px) 50vw, 33vw" /></div>
      <div className="card-copy"><div><h3>{category.name[locale]}</h3><p>{category.shortDescription[locale]}</p></div><span className="text-link">{getDictionary(locale).common.explore} <span aria-hidden="true" className="category-card-arrow">↗</span></span></div>
    </Link>
  </article>;
}
