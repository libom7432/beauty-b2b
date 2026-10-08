import type { Metadata } from "next";
import { categories, getCategorySlugPath } from "@/lib/catalog/taxonomy";
import { CategoryPage } from "@/features/pages/catalog-pages";
import { categoryMetadata, requireCategory } from "@/features/pages/route-data";

type Props = { params: Promise<{ category: string; subcategory: string }>; searchParams: Promise<{ page?: string | string[] }> };
export function generateStaticParams() {
  return categories.filter((item) => item.depth === 2).map((item) => {
    const path = getCategorySlugPath(item);
    return { category: path[0], subcategory: path[1] };
  });
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params;
  return categoryMetadata("zh", [p.category, p.subcategory]);
}
export default async function Page({ params, searchParams }: Props) {
  const p = await params;
  return <CategoryPage locale="zh" category={requireCategory([p.category, p.subcategory])} pageQuery={(await searchParams).page} />;
}
