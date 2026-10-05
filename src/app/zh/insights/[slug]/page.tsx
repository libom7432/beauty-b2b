import type { Metadata } from "next";
import { insights } from "@/lib/catalog/insights";
import { InsightDetailPage } from "@/features/pages/content-pages";
import { insightMetadata, requireInsight } from "@/features/pages/route-data";

type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return insights.map((item) => ({ slug: item.slug })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return insightMetadata("zh", (await params).slug);
}
export default async function Page({ params }: Props) {
  return <InsightDetailPage locale="zh" article={requireInsight((await params).slug)} />;
}
