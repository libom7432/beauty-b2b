import type { Insight } from "./types";

// Topic previews, not published articles.
export const insights: Insight[] = [
  { id: "assortment-planning", slug: "planning-a-nail-assortment", topic: { en: "PRODUCT STRATEGY", zh: "产品策略" }, title: { en: "Planning a Nail Assortment for Retail", zh: "如何规划零售美甲产品组合" }, excerpt: { en: "Questions to consider when shaping a focused product range.", zh: "构建聚焦产品系列时值得考虑的问题。" }, seo: { title: { en: "Planning a Nail Assortment", zh: "规划美甲产品组合" }, description: { en: "An upcoming guide to nail assortment planning.", zh: "即将推出的美甲产品组合规划指南。" }, indexable: false }, isMock: true },
  { id: "private-label-planning", slug: "preparing-a-private-label-brief", topic: { en: "PRIVATE LABEL", zh: "自有品牌" }, title: { en: "Preparing a Private Label Brief", zh: "准备自有品牌项目需求简报" }, excerpt: { en: "The product, brand and packaging decisions to organize early.", zh: "尽早梳理产品、品牌与包装方面的决策。" }, seo: { title: { en: "Private Label Brief Guide", zh: "自有品牌需求简报指南" }, description: { en: "An upcoming guide to private label project planning.", zh: "即将推出的自有品牌项目规划指南。" }, indexable: false }, isMock: true },
];

export function getInsightBySlug(slug: string) { return insights.find((insight) => insight.slug === slug); }
