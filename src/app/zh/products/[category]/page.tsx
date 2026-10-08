import type { Metadata } from "next";
import { categories, getCategorySlugPath } from "@/lib/catalog/taxonomy";
import { CategoryPage, LegacyToolsCarePage } from "@/features/pages/catalog-pages";
import { categoryMetadata, legacyToolsCareMetadata, requireCategory } from "@/features/pages/route-data";

type Props = { params: Promise<{ category: string }> };
export function generateStaticParams() {
  return [...categories.filter((item) => item.depth === 1).map((item) => {
    const path = getCategorySlugPath(item);
    return { category: path[0] };
  }), { category: "nail-tools-care" }];
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params;
  if (p.category === "nail-tools-care") return legacyToolsCareMetadata("zh");
  return categoryMetadata("zh", [p.category]);
}
export default async function Page({ params }: Props) {
  const p = await params;
  if (p.category === "nail-tools-care") return <LegacyToolsCarePage locale="zh" />;
  return <CategoryPage locale="zh" category={requireCategory([p.category])} />;
}
