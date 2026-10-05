import type { Product } from "./types";

// Editorial examples only. Replace with verified catalog records before launch.
export const products: Product[] = [
  {
    id: "concept-almond-nails", slug: "almond-press-on-concept", sku: "DEMO-PO-001",
    name: { en: "Almond Press-On Concept", zh: "杏仁形穿戴甲概念款" },
    shortDescription: { en: "A soft neutral nail direction for a refined edit.", zh: "柔和中性色调的精致美甲方向。" },
    description: { en: "An illustrative product concept for future private label planning.", zh: "用于未来自有品牌规划的示意产品概念。" },
    categoryId: "press-on-nails", subcategoryId: "press-on-shapes", childCategoryId: "shape-almond",
    images: [{ alt: { en: "Illustrative almond press-on nail concept", zh: "杏仁形穿戴甲概念示意图" }, visual: "press-on" }],
    attributes: { shape: "Almond", length: "Medium", finish: "Gloss", color: "Neutral" },
    variants: [{ id: "concept-almond-nails-neutral", sku: "DEMO-PO-001-N", attributes: { color: "Neutral" } }],
    collections: ["minimal", "wedding", "inclusive-color-stories"],
    customizationOptions: ["product", "color", "finish", "logo", "packaging"],
    featured: true, newArrival: true,
    seo: { title: { en: "Almond Press-On Concept", zh: "杏仁形穿戴甲概念款" }, description: { en: "Explore an illustrative press-on nail concept for B2B planning.", zh: "探索用于 B2B 规划的穿戴甲示意款。" }, indexable: false },
    rfq: { enabled: false, fields: ["quantity", "destination", "branding", "packaging", "notes"] }, isMock: true,
  },
  {
    id: "concept-gel-color", slug: "soft-rose-gel-concept", sku: "DEMO-GE-001",
    name: { en: "Soft Rose Gel Concept", zh: "柔雾玫瑰凝胶概念款" },
    shortDescription: { en: "A muted color direction for modern nail lines.", zh: "适合现代美甲系列的柔和色彩方向。" },
    description: { en: "An illustrative gel color concept for future assortment planning.", zh: "用于未来产品组合规划的凝胶色彩示意概念。" },
    categoryId: "gel-polish", subcategoryId: "gel-colors",
    images: [{ alt: { en: "Illustrative soft rose gel polish concept", zh: "柔雾玫瑰凝胶概念示意图" }, visual: "gel" }],
    attributes: { color: "Soft Rose", finish: "Gloss", type: "Gel" },
    variants: [{ id: "concept-gel-color-rose", sku: "DEMO-GE-001-R", attributes: { color: "Soft Rose" } }],
    collections: ["minimal", "french", "inclusive-color-stories"],
    customizationOptions: ["color", "finish", "logo", "packaging"],
    featured: true, newArrival: true,
    seo: { title: { en: "Soft Rose Gel Concept", zh: "柔雾玫瑰凝胶概念款" }, description: { en: "Explore an illustrative gel color concept for B2B planning.", zh: "探索用于 B2B 规划的凝胶色彩示意款。" }, indexable: false },
    rfq: { enabled: false, fields: ["quantity", "destination", "targetMarket", "branding", "notes"] }, isMock: true,
  },
  {
    id: "concept-nail-lamp", slug: "studio-lamp-concept", sku: "DEMO-LA-001",
    name: { en: "Studio Nail Lamp Concept", zh: "工作室美甲灯概念款" },
    shortDescription: { en: "A considered equipment direction for nail professionals.", zh: "面向专业美甲场景的设备设计方向。" },
    description: { en: "An illustrative lamp concept. Technical specifications are not yet available.", zh: "美甲灯示意概念，技术规格尚未提供。" },
    categoryId: "nail-lamps", subcategoryId: "lamp-led",
    images: [{ alt: { en: "Illustrative studio nail lamp concept", zh: "工作室美甲灯概念示意图" }, visual: "lamp" }],
    attributes: {}, variants: [], collections: [],
    customizationOptions: ["logo", "packaging"], featured: true, newArrival: false,
    seo: { title: { en: "Studio Nail Lamp Concept", zh: "工作室美甲灯概念款" }, description: { en: "Explore an illustrative nail lamp concept for B2B planning.", zh: "探索用于 B2B 规划的美甲灯示意款。" }, indexable: false },
    rfq: { enabled: false, fields: ["quantity", "destination", "targetMarket", "notes"] }, isMock: true,
  },
];

export function getProductBySlug(slug: string) { return products.find((product) => product.slug === slug); }
export function getFeaturedProducts() { return products.filter((product) => product.featured); }
export function getNewArrivals() { return products.filter((product) => product.newArrival); }
export function getProductsForCategory(categoryId: string) {
  return products.filter((product) => [product.categoryId, product.subcategoryId, product.childCategoryId].includes(categoryId));
}
