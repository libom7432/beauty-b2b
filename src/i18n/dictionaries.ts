import type { Locale } from "./config";

const dictionaries = {
  en: {
    languageLabel: "Language",
    heading: "A foundation for wholesale beauty",
    description:
      "Our B2B website is taking shape. Press-on nails and false eyelashes are the first product categories planned.",
  },
  zh: {
    languageLabel: "语言",
    heading: "美妆批发网站基础已就绪",
    description: "我们的 B2B 网站正在建设中。首批规划的产品类别为穿戴甲和假睫毛。",
  },
} satisfies Record<Locale, { languageLabel: string; heading: string; description: string }>;

export function getDictionary(locale: Locale) {
  return dictionaries[locale];
}
