import type { Metadata } from "next";
import { categories, getCategorySlugPath } from "@/lib/catalog/taxonomy";
import { CategoryPage, LegacyToolsCarePage } from "@/features/pages/catalog-pages";
import { categoryMetadata, legacyToolsCareMetadata, requireCategory } from "@/features/pages/route-data";

type Props = { params: Promise<{ category: string }>; searchParams: Promise<{ page?: string | string[] }> };
export function generateStaticParams() {
  return [...categories.filter((item) => item.depth === 1).map((item) => {
    const path = getCategorySlugPath(item);
    return { category: path[0] };
  }), { category: "nail-tools-care" }];
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params;
  if (p.category === "nail-tools-care") return legacyToolsCareMetadata("en");
  return categoryMetadata("en", [p.category]);
}
export default async function Page({ params, searchParams }: Props) {
  const p = await params;
  if (p.category === "nail-tools-care") return <LegacyToolsCarePage locale="en" />;
  return <CategoryPage locale="en" category={requireCategory([p.category])} pageQuery={(await searchParams).page} />;
}
