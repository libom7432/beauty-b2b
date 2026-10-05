import type { Metadata } from "next";
import { products } from "@/lib/catalog/products";
import { ProductDetailPage } from "@/features/pages/catalog-pages";
import { productMetadata, requireProduct } from "@/features/pages/route-data";

type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return products.map((item) => ({ slug: item.slug })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return productMetadata("zh", (await params).slug);
}
export default async function Page({ params }: Props) {
  return <ProductDetailPage locale="zh" product={requireProduct((await params).slug)} />;
}
