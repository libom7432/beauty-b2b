import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Collection } from "@/lib/catalog/types";
import { localizedPath } from "@/lib/site/paths";
import { CatalogMedia } from "@/components/catalog-media";
import { getDictionary } from "@/i18n/dictionaries";
import { collectionVisuals } from "@/lib/site/visual-assets";

export function CollectionCard({ collection, locale }: { collection: Collection; locale: Locale }) {
  const href = localizedPath(locale, `/collections/${collection.slug}`);
  const image = collectionVisuals[collection.id];
  return <article className="collection-card-v3"><Link href={href} aria-label={collection.name[locale]} className="collection-card-link"><div className="card-media-link"><CatalogMedia visual={collection.visual} image={image} alt={image?.alt[locale]} sizes="(max-width: 680px) 100vw, (max-width: 900px) 50vw, 33vw" /></div><div className="collection-card-copy"><p className="eyebrow">{getDictionary(locale).common.collectionKinds[collection.kind]}</p><div className="collection-card-title"><h3>{collection.name[locale]}</h3><span className="collection-card-arrow" aria-hidden="true">↗</span></div><p>{collection.shortDescription[locale]}</p></div></Link></article>;
}
