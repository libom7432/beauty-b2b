import type { Category, AttributeDefinition } from "./types";

export const categories: Category[] = [
  { id: "press-on-nails", slug: "press-on-nails", parentId: null, depth: 1, name: { en: "Press-On Nails", zh: "穿戴甲" }, shortDescription: { en: "Ready-to-wear nail collections for brand programs.", zh: "适合品牌项目的即戴美甲系列。" }, visual: "press-on", seo: { title: { en: "Press-On Nails", zh: "穿戴甲" }, description: { en: "Explore press-on nail categories for B2B and private label programs.", zh: "探索面向 B2B 与自有品牌项目的穿戴甲品类。" } } },
  { id: "gel-polish", slug: "gel-polish", parentId: null, depth: 1, name: { en: "Gel & Polish", zh: "凝胶与甲油" }, shortDescription: { en: "Color and finish directions for nail brands.", zh: "面向美甲品牌的色彩与质感方向。" }, visual: "gel", seo: { title: { en: "Gel & Polish", zh: "凝胶与甲油" }, description: { en: "Explore gel and polish product categories.", zh: "探索凝胶与甲油产品分类。" } } },
  { id: "nail-lamps", slug: "nail-lamps", parentId: null, depth: 1, name: { en: "Nail Lamps", zh: "美甲灯" }, shortDescription: { en: "Professional lamp product directions.", zh: "专业美甲灯产品方向。" }, visual: "lamp", seo: { title: { en: "Nail Lamps", zh: "美甲灯" }, description: { en: "Explore nail lamp product categories.", zh: "探索美甲灯产品分类。" } } },
  { id: "nail-machines", slug: "nail-machines", parentId: null, depth: 1, name: { en: "Nail Machines", zh: "美甲机器" }, shortDescription: { en: "Equipment concepts for professional nail work.", zh: "面向专业美甲场景的设备方向。" }, visual: "machine", seo: { title: { en: "Nail Machines", zh: "美甲机器" }, description: { en: "Explore nail machine product categories.", zh: "探索美甲机器产品分类。" } } },
  { id: "nail-tools-care", slug: "nail-tools-care", parentId: null, depth: 1, name: { en: "Nail Tools & Care", zh: "美甲工具与护理" }, shortDescription: { en: "Tools and care essentials for a complete range.", zh: "构建完整系列所需的工具与护理品类。" }, visual: "tools", seo: { title: { en: "Nail Tools & Care", zh: "美甲工具与护理" }, description: { en: "Explore nail tools and care categories.", zh: "探索美甲工具与护理分类。" } } },
  { id: "nail-accessories", slug: "nail-accessories", parentId: null, depth: 1, name: { en: "Nail Accessories", zh: "美甲配饰" }, shortDescription: { en: "Details that complete a nail collection.", zh: "为美甲系列增添表达的配饰。" }, visual: "accessories", seo: { title: { en: "Nail Accessories", zh: "美甲配饰" }, description: { en: "Explore nail accessory categories.", zh: "探索美甲配饰分类。" } } },
  { id: "press-on-shapes", slug: "shapes", parentId: "press-on-nails", depth: 2, name: { en: "Shapes", zh: "甲型" }, shortDescription: { en: "Explore silhouettes and lengths.", zh: "探索不同甲型与长度。" }, visual: "press-on", seo: { title: { en: "Press-On Nail Shapes", zh: "穿戴甲甲型" }, description: { en: "Explore press-on nail shapes.", zh: "探索穿戴甲甲型。" } } },
  { id: "press-on-finishes", slug: "finishes", parentId: "press-on-nails", depth: 2, name: { en: "Finishes", zh: "表面效果" }, shortDescription: { en: "From classic gloss to statement detail.", zh: "从经典亮面到个性化效果。" }, visual: "press-on", seo: { title: { en: "Press-On Nail Finishes", zh: "穿戴甲表面效果" }, description: { en: "Explore press-on nail finishes.", zh: "探索穿戴甲表面效果。" } } },
  { id: "gel-colors", slug: "colors", parentId: "gel-polish", depth: 2, name: { en: "Gel Colors", zh: "凝胶色彩" }, shortDescription: { en: "Color directions for a cohesive range.", zh: "构建完整色彩系列。" }, visual: "gel", seo: { title: { en: "Gel Colors", zh: "凝胶色彩" }, description: { en: "Explore gel color directions.", zh: "探索凝胶色彩方向。" } } },
  { id: "lamp-led", slug: "led-lamps", parentId: "nail-lamps", depth: 2, name: { en: "LED Lamps", zh: "LED 美甲灯" }, shortDescription: { en: "Lamp formats for nail programs.", zh: "适合美甲项目的灯具形态。" }, visual: "lamp", seo: { title: { en: "LED Nail Lamps", zh: "LED 美甲灯" }, description: { en: "Explore LED nail lamps.", zh: "探索 LED 美甲灯。" } } },
  { id: "machine-drills", slug: "nail-drills", parentId: "nail-machines", depth: 2, name: { en: "Nail Drills", zh: "美甲打磨机" }, shortDescription: { en: "Machine formats for nail professionals.", zh: "面向专业美甲人士的设备形态。" }, visual: "machine", seo: { title: { en: "Nail Drills", zh: "美甲打磨机" }, description: { en: "Explore nail drill categories.", zh: "探索美甲打磨机分类。" } } },
  { id: "tools-prep", slug: "prep-care", parentId: "nail-tools-care", depth: 2, name: { en: "Prep & Care", zh: "前处理与护理" }, shortDescription: { en: "Preparation and care product directions.", zh: "前处理与护理产品方向。" }, visual: "tools", seo: { title: { en: "Nail Prep & Care", zh: "美甲前处理与护理" }, description: { en: "Explore nail prep and care categories.", zh: "探索美甲前处理与护理分类。" } } },
  { id: "accessories-art", slug: "nail-art", parentId: "nail-accessories", depth: 2, name: { en: "Nail Art", zh: "美甲装饰" }, shortDescription: { en: "Decorative elements for creative collections.", zh: "适合创意系列的装饰元素。" }, visual: "accessories", seo: { title: { en: "Nail Art Accessories", zh: "美甲装饰配件" }, description: { en: "Explore nail art accessories.", zh: "探索美甲装饰配件。" } } },
  { id: "shape-almond", slug: "almond", parentId: "press-on-shapes", depth: 3, name: { en: "Almond", zh: "杏仁形" }, shortDescription: { en: "An almond silhouette for press-on collections.", zh: "适合穿戴甲系列的杏仁形甲型。" }, visual: "press-on", seo: { title: { en: "Almond Press-On Nails", zh: "杏仁形穿戴甲" }, description: { en: "Explore almond press-on nail directions.", zh: "探索杏仁形穿戴甲方向。" } } },
];

export const attributeDefinitions: AttributeDefinition[] = [
  { key: "shape", label: { en: "Shape", zh: "甲型" }, categoryIds: ["press-on-nails"], valueType: "text" },
  { key: "length", label: { en: "Length", zh: "长度" }, categoryIds: ["press-on-nails"], valueType: "text" },
  { key: "material", label: { en: "Material", zh: "材质" }, categoryIds: ["press-on-nails"], valueType: "text" },
  { key: "finish", label: { en: "Finish", zh: "表面效果" }, categoryIds: ["press-on-nails", "gel-polish"], valueType: "text" },
  { key: "color", label: { en: "Color", zh: "颜色" }, categoryIds: ["press-on-nails", "gel-polish"], valueType: "text" },
  { key: "style", label: { en: "Style", zh: "风格" }, categoryIds: ["press-on-nails"], valueType: "text" },
  { key: "volume", label: { en: "Volume", zh: "容量" }, categoryIds: ["gel-polish"], valueType: "text" },
  { key: "type", label: { en: "Type", zh: "类型" }, categoryIds: ["gel-polish"], valueType: "text" },
  { key: "power", label: { en: "Power", zh: "功率" }, categoryIds: ["nail-lamps", "nail-machines"], valueType: "text" },
  { key: "timer", label: { en: "Timer", zh: "定时" }, categoryIds: ["nail-lamps"], valueType: "text" },
  { key: "plug", label: { en: "Plug", zh: "插头" }, categoryIds: ["nail-lamps"], valueType: "text" },
  { key: "voltage", label: { en: "Voltage", zh: "电压" }, categoryIds: ["nail-lamps", "nail-machines"], valueType: "text" },
  { key: "rpm", label: { en: "RPM", zh: "转速" }, categoryIds: ["nail-machines"], valueType: "text" },
];

export function getTopCategories() { return categories.filter((item) => item.depth === 1); }
export function getCategoryChildren(parentId: string) { return categories.filter((item) => item.parentId === parentId); }
export function getCategoryById(id: string) { return categories.find((item) => item.id === id); }
export function getCategoryByPath(slugs: string[]) {
  if (slugs.length < 1 || slugs.length > 3) return undefined;
  let parentId: string | null = null;
  let match: Category | undefined;
  for (const slug of slugs) {
    match = categories.find((item) => item.slug === slug && item.parentId === parentId);
    if (!match) return undefined;
    parentId = match.id;
  }
  return match;
}
export function getCategorySlugPath(category: Category): string[] {
  const path = [category.slug];
  let current = category;
  while (current.parentId) {
    if (path.length >= 3) throw new Error(`Category exceeds three levels: ${category.id}`);
    const parent = getCategoryById(current.parentId);
    if (!parent) throw new Error(`Missing parent category: ${current.parentId}`);
    path.unshift(parent.slug);
    current = parent;
  }
  if (path.length !== category.depth) throw new Error(`Category depth mismatch: ${category.id}`);
  return path;
}
