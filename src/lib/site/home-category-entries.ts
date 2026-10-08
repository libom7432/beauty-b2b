import type { Category } from "@/lib/catalog/types";

// Sprint 1 homepage editorial slots: six fixed cards, independent of catalog depth and count.
export type HomeCategoryEntry = Pick<Category, "id" | "name" | "shortDescription" | "visual"> & { path: string };

export const homeCategoryEntries: readonly HomeCategoryEntry[] = [
  { id: "press-on-nails", path: "/products/press-on-nails", name: { en: "Press-On Nails", zh: "穿戴甲" }, shortDescription: { en: "Ready-to-wear nail collections for brand programs.", zh: "适合品牌项目的即戴美甲系列。" }, visual: "press-on" },
  { id: "gel-polish", path: "/products/gel-polish", name: { en: "Gel & Polish", zh: "凝胶与甲油" }, shortDescription: { en: "Color and finish directions for nail brands.", zh: "面向美甲品牌的色彩与质感方向。" }, visual: "gel" },
  { id: "nail-lamps", path: "/products/nail-lamps", name: { en: "Nail Lamps", zh: "美甲灯" }, shortDescription: { en: "Professional lamp product directions.", zh: "专业美甲灯产品方向。" }, visual: "lamp" },
  { id: "nail-machines", path: "/products/nail-machines", name: { en: "Nail Machines", zh: "美甲机器" }, shortDescription: { en: "Equipment concepts for professional nail work.", zh: "面向专业美甲场景的设备方向。" }, visual: "machine" },
  { id: "nail-tools-care", path: "/products/nail-tools-care", name: { en: "Nail Tools & Care", zh: "美甲工具与护理" }, shortDescription: { en: "Tools and care essentials for a complete range.", zh: "构建完整系列所需的工具与护理品类。" }, visual: "tools" },
  { id: "nail-accessories", path: "/products/nail-art", name: { en: "Nail Accessories", zh: "美甲配饰" }, shortDescription: { en: "Details that complete a nail collection.", zh: "为美甲系列增添表达的配饰。" }, visual: "accessories" },
];
