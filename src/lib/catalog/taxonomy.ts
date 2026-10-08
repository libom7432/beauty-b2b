import type { Category, AttributeDefinition, VisualKind } from "./types";

// New taxonomy nodes stay non-indexable until verified catalog content is available.
function newCategory(
  id: string, slug: string, parentId: string | null, depth: Category["depth"],
  en: string, zh: string, visual: VisualKind,
): Category {
  const name = { en, zh };
  return {
    id, slug, parentId, depth, name, visual,
    shortDescription: { en: `Explore ${en.toLowerCase()} for professional nail programs.`, zh: `探索${zh}产品方向。` },
    seo: {
      title: name,
      description: { en: `Explore ${en.toLowerCase()} for B2B nail product planning.`, zh: `探索面向 B2B 选品的${zh}分类。` },
      indexable: false,
    },
  };
}

export const categories: Category[] = [
  { id: "press-on-nails", slug: "press-on-nails", parentId: null, depth: 1, name: { en: "Press-On Nails", zh: "穿戴甲" }, shortDescription: { en: "Ready-to-wear nail collections for brand programs.", zh: "适合品牌项目的即戴美甲系列。" }, visual: "press-on", seo: { title: { en: "Press-On Nails", zh: "穿戴甲" }, description: { en: "Explore press-on nail categories for B2B and private label programs.", zh: "探索面向 B2B 与自有品牌项目的穿戴甲品类。" } } },
  { id: "gel-polish", slug: "gel-polish", parentId: null, depth: 1, name: { en: "Gel Polish", zh: "凝胶甲油" }, shortDescription: { en: "Color and finish directions for nail brands.", zh: "面向美甲品牌的色彩与质感方向。" }, visual: "gel", seo: { title: { en: "Gel Polish", zh: "凝胶甲油" }, description: { en: "Explore gel polish product categories.", zh: "探索凝胶甲油产品分类。" }, indexable: false } },
  newCategory("nail-gel-extension", "nail-gel-extension", null, 1, "Nail Gel & Extension", "美甲凝胶与延长", "gel"),
  { id: "nail-lamps", slug: "nail-lamps", parentId: null, depth: 1, name: { en: "Nail Lamps", zh: "美甲灯" }, shortDescription: { en: "Professional lamp product directions.", zh: "专业美甲灯产品方向。" }, visual: "lamp", seo: { title: { en: "Nail Lamps", zh: "美甲灯" }, description: { en: "Explore nail lamp product categories.", zh: "探索美甲灯产品分类。" } } },
  { id: "nail-machines", slug: "nail-machines", parentId: null, depth: 1, name: { en: "Nail Drills & Machines", zh: "美甲打磨机与设备" }, shortDescription: { en: "Equipment concepts for professional nail work.", zh: "面向专业美甲场景的设备方向。" }, visual: "machine", seo: { title: { en: "Nail Drills & Machines", zh: "美甲打磨机与设备" }, description: { en: "Explore nail drills and machines for professional nail work.", zh: "探索专业美甲打磨机与设备分类。" }, indexable: false } },
  newCategory("nail-tools", "nail-tools", null, 1, "Nail Tools", "美甲工具", "tools"),
  newCategory("nail-art", "nail-art", null, 1, "Nail Art", "美甲装饰", "accessories"),
  newCategory("nail-care", "nail-care", null, 1, "Nail Care", "美甲护理", "tools"),
  { id: "press-on-shapes", slug: "shapes", parentId: "press-on-nails", depth: 2, name: { en: "Shapes", zh: "甲型" }, shortDescription: { en: "Explore silhouettes and lengths.", zh: "探索不同甲型与长度。" }, visual: "press-on", seo: { title: { en: "Press-On Nail Shapes", zh: "穿戴甲甲型" }, description: { en: "Explore press-on nail shapes.", zh: "探索穿戴甲甲型。" } } },
  { id: "press-on-finishes", slug: "finishes", parentId: "press-on-nails", depth: 2, name: { en: "Finishes", zh: "表面效果" }, shortDescription: { en: "From classic gloss to statement detail.", zh: "从经典亮面到个性化效果。" }, visual: "press-on", seo: { title: { en: "Press-On Nail Finishes", zh: "穿戴甲表面效果" }, description: { en: "Explore press-on nail finishes.", zh: "探索穿戴甲表面效果。" } } },
  { id: "gel-colors", slug: "colors", parentId: "gel-polish", depth: 2, name: { en: "Color Gel Polish", zh: "彩色凝胶甲油" }, shortDescription: { en: "Color directions for a cohesive range.", zh: "构建完整色彩系列。" }, visual: "gel", seo: { title: { en: "Color Gel Polish", zh: "彩色凝胶甲油" }, description: { en: "Explore color gel polish directions.", zh: "探索彩色凝胶甲油方向。" }, indexable: false } },
  { id: "lamp-led", slug: "led-lamps", parentId: "nail-lamps", depth: 2, name: { en: "LED Lamps", zh: "LED 美甲灯" }, shortDescription: { en: "Lamp formats for nail programs.", zh: "适合美甲项目的灯具形态。" }, visual: "lamp", seo: { title: { en: "LED Nail Lamps", zh: "LED 美甲灯" }, description: { en: "Explore LED nail lamps.", zh: "探索 LED 美甲灯。" } } },
  { id: "machine-drills", slug: "nail-drills", parentId: "nail-machines", depth: 2, name: { en: "Nail Drills", zh: "美甲打磨机" }, shortDescription: { en: "Machine formats for nail professionals.", zh: "面向专业美甲人士的设备形态。" }, visual: "machine", seo: { title: { en: "Nail Drills", zh: "美甲打磨机" }, description: { en: "Explore nail drill categories.", zh: "探索美甲打磨机分类。" } } },
  { id: "tools-prep", slug: "prep-care", parentId: "nail-care", depth: 2, name: { en: "Prep & Care", zh: "前处理与护理" }, shortDescription: { en: "Preparation and care product directions.", zh: "前处理与护理产品方向。" }, visual: "tools", seo: { title: { en: "Nail Prep & Care", zh: "美甲前处理与护理" }, description: { en: "Explore nail prep and care categories.", zh: "探索美甲前处理与护理分类。" }, indexable: false } },
  newCategory("gel-finishes", "finishes", "gel-polish", 2, "Gel Finishes", "凝胶甲油效果", "gel"),
  newCategory("gel-base-coat", "base-coat", "gel-polish", 2, "Base Coat", "底胶", "gel"),
  newCategory("gel-top-coat", "top-coat", "gel-polish", 2, "Top Coat", "封层", "gel"),
  newCategory("extension-builder-gels", "builder-gels", "nail-gel-extension", 2, "Builder Gel", "建构胶", "gel"),
  newCategory("extension-systems", "extension-systems", "nail-gel-extension", 2, "Extension Systems", "延长系统", "gel"),
  newCategory("extension-tips-forms", "tips-forms", "nail-gel-extension", 2, "Nail Tips & Forms", "甲片与纸托", "gel"),
  newCategory("lamp-accessories", "lamp-accessories", "nail-lamps", 2, "Lamp Accessories", "美甲灯配件", "lamp"),
  newCategory("machine-dust-collectors", "dust-collectors", "nail-machines", 2, "Dust Collectors", "美甲吸尘器", "machine"),
  newCategory("tools-files-buffers", "files-buffers", "nail-tools", 2, "Files & Buffers", "甲锉与打磨块", "tools"),
  newCategory("tools-brushes", "brushes", "nail-tools", 2, "Brushes", "美甲刷", "tools"),
  newCategory("tools-cuticle", "cuticle-tools", "nail-tools", 2, "Cuticle Tools", "死皮工具", "tools"),
  newCategory("art-charms-rhinestones", "charms-rhinestones", "nail-art", 2, "Charms & Rhinestones", "饰品与水钻", "accessories"),
  newCategory("art-foils-stickers", "foils-stickers", "nail-art", 2, "Foils & Stickers", "转印箔与贴纸", "accessories"),
  newCategory("care-removers", "removers", "nail-care", 2, "Removers", "卸甲产品", "tools"),
  newCategory("care-treatments", "treatments", "nail-care", 2, "Treatments", "护理产品", "tools"),
  { id: "shape-almond", slug: "almond", parentId: "press-on-shapes", depth: 3, name: { en: "Almond", zh: "杏仁形" }, shortDescription: { en: "An almond silhouette for press-on collections.", zh: "适合穿戴甲系列的杏仁形甲型。" }, visual: "press-on", seo: { title: { en: "Almond Press-On Nails", zh: "杏仁形穿戴甲" }, description: { en: "Explore almond press-on nail directions.", zh: "探索杏仁形穿戴甲方向。" } } },
  newCategory("shape-coffin", "coffin", "press-on-shapes", 3, "Coffin", "棺材形", "press-on"),
  newCategory("shape-square", "square", "press-on-shapes", 3, "Square", "方形", "press-on"),
  newCategory("press-on-glossy", "glossy", "press-on-finishes", 3, "Glossy", "亮面", "press-on"),
  newCategory("press-on-matte", "matte", "press-on-finishes", 3, "Matte", "哑光", "press-on"),
  newCategory("gel-nude", "nude", "gel-colors", 3, "Nude Gel Polish", "裸色凝胶甲油", "gel"),
  newCategory("gel-pink", "pink", "gel-colors", 3, "Pink Gel Polish", "粉色凝胶甲油", "gel"),
  newCategory("gel-magnetic", "magnetic", "gel-finishes", 3, "Magnetic Gel Polish", "磁性凝胶甲油", "gel"),
  newCategory("gel-glitter", "glitter", "gel-finishes", 3, "Glitter Gel Polish", "闪粉凝胶甲油", "gel"),
  newCategory("gel-rubber-base", "rubber-base", "gel-base-coat", 3, "Rubber Base Coat", "橡胶底胶", "gel"),
  newCategory("gel-standard-base", "standard-base", "gel-base-coat", 3, "Standard Base Coat", "常规底胶", "gel"),
  newCategory("gel-glossy-top", "glossy-top", "gel-top-coat", 3, "Glossy Top Coat", "亮面封层", "gel"),
  newCategory("gel-matte-top", "matte-top", "gel-top-coat", 3, "Matte Top Coat", "哑光封层", "gel"),
  newCategory("extension-bottle-builder", "bottle-builder-gel", "extension-builder-gels", 3, "Bottle Builder Gel", "瓶装建构胶", "gel"),
  newCategory("extension-hard-gel", "hard-gel", "extension-builder-gels", 3, "Hard Gel", "硬胶", "gel"),
  newCategory("extension-polygel", "polygel", "extension-systems", 3, "Polygel", "多效延长胶", "gel"),
  newCategory("extension-soft-gel-tips", "soft-gel-tips", "extension-systems", 3, "Soft Gel Tips", "软凝胶甲片", "gel"),
  newCategory("extension-full-cover-tips", "full-cover-tips", "extension-tips-forms", 3, "Full-Cover Tips", "全贴甲片", "gel"),
  newCategory("extension-nail-forms", "nail-forms", "extension-tips-forms", 3, "Nail Forms", "延长纸托", "gel"),
  newCategory("lamp-led-full-size", "full-size", "lamp-led", 3, "Full-Size LED Lamps", "全尺寸 LED 美甲灯", "lamp"),
  newCategory("lamp-led-mini", "mini", "lamp-led", 3, "Mini LED Lamps", "迷你 LED 美甲灯", "lamp"),
  newCategory("lamp-power-adapters", "power-adapters", "lamp-accessories", 3, "Power Adapters", "美甲灯电源适配器", "lamp"),
  newCategory("lamp-replacement-parts", "replacement-parts", "lamp-accessories", 3, "Replacement Parts", "美甲灯替换配件", "lamp"),
  newCategory("machine-drills-desktop", "desktop", "machine-drills", 3, "Desktop Nail Drills", "台式美甲打磨机", "machine"),
  newCategory("machine-drills-portable", "portable", "machine-drills", 3, "Portable Nail Drills", "便携式美甲打磨机", "machine"),
  newCategory("machine-dust-desktop", "desktop", "machine-dust-collectors", 3, "Desktop Dust Collectors", "台式美甲吸尘器", "machine"),
  newCategory("machine-dust-portable", "portable", "machine-dust-collectors", 3, "Portable Dust Collectors", "便携式美甲吸尘器", "machine"),
  newCategory("tools-files", "nail-files", "tools-files-buffers", 3, "Nail Files", "美甲锉", "tools"),
  newCategory("tools-buffers", "buffers", "tools-files-buffers", 3, "Buffers", "打磨块", "tools"),
  newCategory("tools-gel-brushes", "gel-brushes", "tools-brushes", 3, "Gel Brushes", "凝胶刷", "tools"),
  newCategory("tools-art-brushes", "art-brushes", "tools-brushes", 3, "Art Brushes", "美甲彩绘刷", "tools"),
  newCategory("tools-pushers", "pushers", "tools-cuticle", 3, "Cuticle Pushers", "死皮推", "tools"),
  newCategory("tools-nippers", "nippers", "tools-cuticle", 3, "Cuticle Nippers", "死皮剪", "tools"),
  newCategory("art-charms", "charms", "art-charms-rhinestones", 3, "Nail Charms", "美甲饰品", "accessories"),
  newCategory("art-rhinestones", "rhinestones", "art-charms-rhinestones", 3, "Rhinestones", "美甲水钻", "accessories"),
  newCategory("art-foils", "foils", "art-foils-stickers", 3, "Nail Foils", "美甲转印箔", "accessories"),
  newCategory("art-stickers", "stickers", "art-foils-stickers", 3, "Nail Stickers", "美甲贴纸", "accessories"),
  newCategory("care-prep", "nail-prep", "tools-prep", 3, "Nail Prep", "美甲前处理", "tools"),
  newCategory("care-cuticle-oils", "cuticle-oils", "tools-prep", 3, "Cuticle Oils", "指缘油", "tools"),
  newCategory("care-gel-removers", "gel-removers", "care-removers", 3, "Gel Removers", "凝胶卸甲产品", "tools"),
  newCategory("care-polish-removers", "polish-removers", "care-removers", 3, "Polish Removers", "甲油卸除产品", "tools"),
  newCategory("care-strengtheners", "strengtheners", "care-treatments", 3, "Strengtheners", "指甲强化护理", "tools"),
  newCategory("care-moisturizers", "moisturizers", "care-treatments", 3, "Moisturizers", "保湿护理", "tools"),
];

export const attributeDefinitions: AttributeDefinition[] = [
  { key: "shape", label: { en: "Shape", zh: "甲型" }, categoryIds: ["press-on-nails"], valueType: "text" },
  { key: "length", label: { en: "Length", zh: "长度" }, categoryIds: ["press-on-nails"], valueType: "text" },
  { key: "material", label: { en: "Material", zh: "材质" }, categoryIds: ["press-on-nails", "nail-gel-extension", "nail-tools", "nail-art"], valueType: "text" },
  { key: "finish", label: { en: "Finish", zh: "表面效果" }, categoryIds: ["press-on-nails", "gel-polish", "nail-art"], valueType: "text" },
  { key: "color", label: { en: "Color", zh: "颜色" }, categoryIds: ["press-on-nails", "gel-polish", "nail-art"], valueType: "text" },
  { key: "style", label: { en: "Style", zh: "风格" }, categoryIds: ["press-on-nails"], valueType: "text" },
  { key: "volume", label: { en: "Volume", zh: "容量" }, categoryIds: ["gel-polish", "nail-gel-extension", "nail-care"], valueType: "text" },
  { key: "type", label: { en: "Type", zh: "类型" }, categoryIds: ["gel-polish", "nail-gel-extension", "nail-tools", "nail-art", "nail-care"], valueType: "text" },
  { key: "power", label: { en: "Power", zh: "功率" }, categoryIds: ["nail-lamps", "nail-machines"], valueType: "text" },
  { key: "timer", label: { en: "Timer", zh: "定时" }, categoryIds: ["nail-lamps"], valueType: "text" },
  { key: "plug", label: { en: "Plug", zh: "插头" }, categoryIds: ["nail-lamps"], valueType: "text" },
  { key: "voltage", label: { en: "Voltage", zh: "电压" }, categoryIds: ["nail-lamps", "nail-machines"], valueType: "text" },
  { key: "rpm", label: { en: "RPM", zh: "转速" }, categoryIds: ["nail-machines"], valueType: "text" },
  { key: "size", label: { en: "Size", zh: "尺寸" }, categoryIds: ["nail-gel-extension", "nail-lamps", "nail-tools", "nail-art"], valueType: "text" },
  { key: "quantityPerPack", label: { en: "Quantity per Pack", zh: "每包装数量" }, categoryIds: ["press-on-nails", "nail-gel-extension", "nail-tools", "nail-art"], valueType: "number" },
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
