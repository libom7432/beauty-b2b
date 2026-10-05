import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Collection } from "@/lib/catalog/types";
import { localizedPath } from "@/lib/site/paths";
import { CatalogMedia } from "@/components/catalog-media";
import { getDictionary } from "@/i18n/dictionaries";

export function CollectionCard({ collection, locale }: { collection: Collection; locale: Locale }) {
  const href = localizedPath(locale, `/collections/${collection.slug}`);
  return <article className="collection-card-v3"><Link href={href} aria-label={collection.name[locale]} className="card-media-link"><CatalogMedia visual={collection.visual} /></Link><div className="collection-card-copy"><p className="eyebrow">{getDictionary(locale).common.collectionKinds[collection.kind]}</p><h3><Link href={href}>{collection.name[locale]}</Link></h3><p>{collection.shortDescription[locale]}</p></div></article>;
}
