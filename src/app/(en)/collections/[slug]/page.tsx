import type { Metadata } from "next";
import { collections } from "@/lib/catalog/collections";
import { CollectionDetailPage } from "@/features/pages/catalog-pages";
import { collectionMetadata, requireCollection } from "@/features/pages/route-data";

type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return collections.map((item) => ({ slug: item.slug })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return collectionMetadata("en", (await params).slug);
}
export default async function Page({ params }: Props) {
  return <CollectionDetailPage locale="en" collection={requireCollection((await params).slug)} />;
}
