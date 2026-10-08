import type { LocalizedText } from "@/lib/catalog/types";

export type VisualAsset = {
  src: string;
  alt: LocalizedText;
  position?: string;
  mobilePosition?: string;
};

// Replace these paths with verified product photography when it becomes available.
export const homeVisuals = {
  hero: {
    src: "/images/hero/hero-nails-v1.png",
    alt: {
      en: "Beauty model showing soft pink French manicure nails",
      zh: "展示柔粉色法式美甲的美妆模特",
    },
    position: "92% center",
    mobilePosition: "95% center",
  },
  privateLabel: {
    src: "/images/private-label/private-label-v1.png",
    alt: {
      en: "Concept display of press-on nails with customizable packaging",
      zh: "穿戴甲与可定制包装的概念展示图",
    },
    position: "47% center",
  },
} satisfies Record<string, VisualAsset>;

export const categoryVisuals: Partial<Record<string, VisualAsset>> = {
  "press-on-nails": {
    src: "/images/categories/press-on-nails-v1.png",
    alt: {
      en: "Blush and nude press-on nails displayed in a presentation box",
      zh: "展示盒中的柔粉色与裸色穿戴甲",
    },
  },
  "gel-polish": {
    src: "/images/categories/gel-polish-v1.png",
    alt: {
      en: "Rose and nude nail polish bottles with an open brush",
      zh: "玫瑰色与裸色甲油瓶及打开的甲油刷",
    },
  },
  "nail-lamps": {
    src: "/images/categories/nail-lamps-tools-v1.png",
    alt: {
      en: "Nail lamp and manicure tools arranged on a studio table",
      zh: "工作台上的美甲灯与美甲工具",
    },
    position: "42% center",
  },
};

export const collectionVisuals: Partial<Record<string, VisualAsset>> = {
  "inclusive-color-stories": {
    src: "/images/collections/diverse-skin-tones-v1.png",
    alt: {
      en: "Nude and blush nail colors shown on hands with diverse skin tones",
      zh: "不同肤色手部展示裸色与柔粉色美甲",
    },
  },
};
