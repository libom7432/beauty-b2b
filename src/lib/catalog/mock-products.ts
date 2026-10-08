import type { AttributeValue, CustomizationOptionId, LocalizedText, Product, ProductImage, ProductVariant, VariantMoq, VisualKind } from "./types";

type MockSeed = Pick<Product,
  "id" | "slug" | "productCode" | "name" | "categoryId" | "attributes" | "variants" | "collections" | "oemOdm"
> & {
  short: LocalizedText;
  customizationOptions: CustomizationOptionId[];
  customizationMoq?: Partial<Record<CustomizationOptionId, VariantMoq>>;
  subcategoryId?: string;
  childCategoryId?: string;
  visual: VisualKind;
  primaryImageSrc?: string;
  variantImage?: boolean;
  featured?: boolean;
  newArrival?: boolean;
};

type TierInput = readonly [minQuantity: number, unitPriceUsd: number];
const customizationNames: Record<CustomizationOptionId, LocalizedText> = {
  product: { en: "Product", zh: "产品" }, color: { en: "Color", zh: "颜色" },
  material: { en: "Material", zh: "材质" }, finish: { en: "Finish", zh: "表面效果" },
  logo: { en: "Logo", zh: "标识" }, packaging: { en: "Packaging", zh: "包装" },
};

function variant(
  id: string, sku: string, attributes: Record<string, AttributeValue>,
  quantity: number, unit: string, tiers: readonly TierInput[],
  options: Pick<ProductVariant, "imageIndex" | "packageContents"> = {},
): ProductVariant {
  return {
    id, sku, attributes, moq: { quantity, unit },
    pricing: { currency: "USD", isTestData: true, tiers: tiers.map(([minQuantity, unitPriceUsd]) => ({ minQuantity, unitPriceUsd })) },
    ...options,
  };
}

function mockImages(seed: MockSeed): ProductImage[] {
  const images: ProductImage[] = [
    {
      id: `${seed.id}-primary`, role: "primary", src: seed.primaryImageSrc,
      alt: { en: `Illustrative image for ${seed.name.en}`, zh: `${seed.name.zh}示意图` },
      visual: seed.visual, isPlaceholder: true,
    },
    {
      id: `${seed.id}-detail`, role: "detail",
      alt: { en: `Detail image placeholder for ${seed.name.en}`, zh: `${seed.name.zh}详情图占位` },
      visual: seed.visual, isPlaceholder: true,
    },
  ];
  if (seed.variantImage) images.push({
    id: `${seed.id}-variant`, role: "variant",
    alt: { en: `Variant image placeholder for ${seed.name.en}`, zh: `${seed.name.zh}规格图占位` },
    visual: seed.visual, isPlaceholder: true,
  });
  return images;
}

function mockProduct(seed: MockSeed): Product {
  return {
    id: seed.id, slug: seed.slug, productCode: seed.productCode, name: seed.name,
    categoryId: seed.categoryId, subcategoryId: seed.subcategoryId, childCategoryId: seed.childCategoryId,
    attributes: seed.attributes, variants: seed.variants, collections: seed.collections,
    oemOdm: seed.oemOdm,
    customizationOptions: seed.customizationOptions.map((id) => ({
      id, name: customizationNames[id],
      ...(seed.customizationMoq?.[id] ? { moq: seed.customizationMoq[id] } : {}),
    })),
    shortDescription: seed.short,
    description: {
      en: `${seed.short.en} This is illustrative test catalog data; specifications and supply terms require verification.`,
      zh: `${seed.short.zh}本记录为示意测试数据，规格与供货条件有待核实。`,
    },
    images: mockImages(seed), featured: seed.featured ?? false, newArrival: seed.newArrival ?? false,
    seo: { title: seed.name, description: seed.short, indexable: false },
    rfq: { enabled: false, fields: ["quantity", "destination", "targetMarket", "branding", "packaging", "notes"] },
    isMock: true,
  };
}

// Mock-only catalog records. All prices are USD test data, not supplier quotations.
export const mockProducts: Product[] = [
  mockProduct({
    id: "concept-almond-nails", slug: "almond-press-on-concept", productCode: "DEMO-PO-001",
    name: { en: "Almond Press-On Concept", zh: "杏仁形穿戴甲概念款" },
    short: { en: "A soft neutral almond press-on direction for private label ranges.", zh: "适合自有品牌系列的柔和中性色杏仁形穿戴甲方向。" },
    categoryId: "press-on-nails", subcategoryId: "press-on-shapes", childCategoryId: "shape-almond",
    visual: "press-on", primaryImageSrc: "/images/categories/press-on-nails-v1.png", variantImage: true,
    attributes: { shape: "Almond", length: "Medium", finish: "Gloss" },
    variants: [
      variant("concept-almond-nails-neutral", "DEMO-PO-001-N", { color: "Neutral" }, 100, "sets", [[100, 1.45], [500, 1.30], [1000, 1.18]], { packageContents: { quantity: 10, unit: "nails" } }),
      variant("concept-almond-nails-rose", "DEMO-PO-001-R", { color: "Dusty Rose" }, 200, "sets", [[200, 1.55], [600, 1.38], [1200, 1.24]], { imageIndex: 2, packageContents: { quantity: 10, unit: "nails" } }),
    ],
    collections: ["minimal", "wedding", "inclusive-color-stories"],
    oemOdm: { oem: true, odm: true, note: { en: "Test capability only; confirm with the supplier.", zh: "仅供能力测试，需向供应商核实。" } },
    customizationOptions: ["product", "color", "finish", "logo", "packaging"],
    customizationMoq: { logo: { quantity: 500, unit: "sets" }, packaging: { quantity: 1000, unit: "sets" } },
    featured: true, newArrival: true,
  }),
  mockProduct({
    id: "mock-square-french-press-ons", slug: "square-french-press-ons-mock", productCode: "DEMO-PO-002",
    name: { en: "Square French Press-On Set", zh: "方形法式穿戴甲套装" },
    short: { en: "A classic French design in a square press-on format.", zh: "经典法式设计的方形穿戴甲套装。" },
    categoryId: "press-on-nails", subcategoryId: "press-on-shapes", childCategoryId: "shape-square",
    visual: "press-on", attributes: { shape: "Square", style: "French" },
    variants: [
      variant("mock-square-french-short", "DEMO-PO-002-S", { length: "Short" }, 120, "sets", [[120, 1.38], [600, 1.22], [1200, 1.10]], { packageContents: { quantity: 10, unit: "nails" } }),
      variant("mock-square-french-medium", "DEMO-PO-002-M", { length: "Medium" }, 240, "sets", [[240, 1.52], [720, 1.36], [1440, 1.21]], { packageContents: { quantity: 10, unit: "nails" } }),
    ],
    collections: ["french", "wedding", "us-market-edit"],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["product", "color", "logo", "packaging"],
  }),
  mockProduct({
    id: "mock-coffin-chrome-press-ons", slug: "coffin-chrome-press-ons-mock", productCode: "DEMO-PO-003",
    name: { en: "Coffin Chrome Press-On Set", zh: "棺材形镜面穿戴甲套装" },
    short: { en: "A reflective coffin-shape concept for trend-led assortments.", zh: "适合趋势型选品的镜面棺材形穿戴甲概念。" },
    categoryId: "press-on-nails", subcategoryId: "press-on-shapes", childCategoryId: "shape-coffin",
    visual: "press-on", attributes: { shape: "Coffin", finish: "Chrome", length: "Long" },
    variants: [
      variant("mock-coffin-chrome-silver", "DEMO-PO-003-SI", { color: "Silver" }, 150, "sets", [[150, 1.82], [600, 1.65], [1200, 1.49]], { packageContents: { quantity: 10, unit: "nails" } }),
      variant("mock-coffin-chrome-rose", "DEMO-PO-003-RG", { color: "Rose Gold" }, 300, "sets", [[300, 1.96], [900, 1.77], [1800, 1.59]], { packageContents: { quantity: 10, unit: "nails" } }),
    ],
    collections: ["chrome", "us-market-edit"],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["color", "finish", "logo", "packaging"],
  }),
  mockProduct({
    id: "mock-matte-neutral-press-ons", slug: "matte-neutral-press-ons-mock", productCode: "DEMO-PO-004",
    name: { en: "Matte Neutral Press-On Set", zh: "哑光中性色穿戴甲套装" },
    short: { en: "A muted matte finish for understated press-on ranges.", zh: "适合简约系列的柔和哑光穿戴甲。" },
    categoryId: "press-on-nails", subcategoryId: "press-on-finishes", childCategoryId: "press-on-matte",
    visual: "press-on", attributes: { finish: "Matte", style: "Minimal" },
    variants: [
      variant("mock-matte-neutral-warm", "DEMO-PO-004-W", { color: "Warm Nude" }, 100, "sets", [[100, 1.42], [500, 1.28], [1000, 1.15]], { packageContents: { quantity: 10, unit: "nails" } }),
      variant("mock-matte-neutral-cool", "DEMO-PO-004-C", { color: "Cool Nude" }, 200, "sets", [[200, 1.50], [600, 1.34], [1200, 1.20]], { packageContents: { quantity: 10, unit: "nails" } }),
    ],
    collections: ["minimal", "europe-market-edit"],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["color", "finish", "logo", "packaging"],
  }),
  mockProduct({
    id: "mock-glossy-pink-press-ons", slug: "glossy-pink-press-ons-mock", productCode: "DEMO-PO-005",
    name: { en: "Glossy Pink Press-On Set", zh: "亮面粉色穿戴甲套装" },
    short: { en: "A versatile glossy pink direction for broad retail ranges.", zh: "适合大众零售系列的亮面粉色穿戴甲方向。" },
    categoryId: "press-on-nails", subcategoryId: "press-on-finishes", childCategoryId: "press-on-glossy",
    visual: "press-on", attributes: { finish: "Gloss", length: "Medium" },
    variants: [
      variant("mock-glossy-pink-blush", "DEMO-PO-005-B", { color: "Blush" }, 120, "sets", [[120, 1.39], [600, 1.25], [1200, 1.12]], { packageContents: { quantity: 10, unit: "nails" } }),
      variant("mock-glossy-pink-rose", "DEMO-PO-005-R", { color: "Rose" }, 240, "sets", [[240, 1.48], [720, 1.32], [1440, 1.18]], { packageContents: { quantity: 10, unit: "nails" } }),
    ],
    collections: ["inclusive-color-stories", "us-market-edit"],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["color", "logo", "packaging"],
  }),
  mockProduct({
    id: "concept-gel-color", slug: "soft-rose-gel-concept", productCode: "DEMO-GE-001",
    name: { en: "Soft Rose Gel Concept", zh: "柔雾玫瑰凝胶概念款" },
    short: { en: "A muted rose color gel direction for modern nail lines.", zh: "适合现代美甲系列的柔和玫瑰色凝胶甲油方向。" },
    categoryId: "gel-polish", subcategoryId: "gel-colors", childCategoryId: "gel-pink",
    visual: "gel", primaryImageSrc: "/images/categories/gel-polish-v1.png", variantImage: true,
    attributes: { finish: "Gloss", type: "Color Gel Polish" },
    variants: [
      variant("concept-gel-color-rose", "DEMO-GE-001-R", { color: "Soft Rose", volume: "10 ml" }, 200, "bottles", [[200, 1.72], [1000, 1.51], [2000, 1.34]]),
      variant("concept-gel-color-blush", "DEMO-GE-001-B", { color: "Blush Rose", volume: "15 ml" }, 300, "bottles", [[300, 1.94], [1200, 1.72], [2400, 1.54]], { imageIndex: 2 }),
    ],
    collections: ["minimal", "french", "inclusive-color-stories"],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["color", "finish", "logo", "packaging"],
    customizationMoq: { color: { quantity: 600, unit: "bottles" }, logo: { quantity: 1000, unit: "bottles" } },
    featured: true, newArrival: true,
  }),
  mockProduct({
    id: "mock-magnetic-cat-eye-gel", slug: "magnetic-cat-eye-gel-mock", productCode: "DEMO-GE-002",
    name: { en: "Magnetic Cat-Eye Gel Polish", zh: "磁性猫眼凝胶甲油" },
    short: { en: "A magnetic finish concept for dimensional gel color ranges.", zh: "适合立体色彩系列的磁性猫眼凝胶甲油概念。" },
    categoryId: "gel-polish", subcategoryId: "gel-finishes", childCategoryId: "gel-magnetic",
    visual: "gel", attributes: { finish: "Magnetic", type: "Color Gel Polish", volume: "10 ml" },
    variants: [
      variant("mock-cat-eye-plum", "DEMO-GE-002-P", { color: "Plum" }, 200, "bottles", [[200, 2.05], [1000, 1.83], [2000, 1.64]]),
      variant("mock-cat-eye-teal", "DEMO-GE-002-T", { color: "Teal" }, 400, "bottles", [[400, 2.16], [1200, 1.91], [2400, 1.72]]),
    ],
    collections: ["cat-eye", "us-market-edit"],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["color", "finish", "logo", "packaging"],
  }),
  mockProduct({
    id: "mock-rubber-base-coat", slug: "rubber-base-coat-mock", productCode: "DEMO-GE-003",
    name: { en: "Rubber Base Coat", zh: "橡胶底胶" },
    short: { en: "A base coat format for professional gel polish programs.", zh: "面向专业凝胶甲油系列的底胶产品形态。" },
    categoryId: "gel-polish", subcategoryId: "gel-base-coat", childCategoryId: "gel-rubber-base",
    visual: "gel", attributes: { type: "Base Coat", finish: "Clear" },
    variants: [
      variant("mock-rubber-base-10ml", "DEMO-GE-003-10", { volume: "10 ml" }, 200, "bottles", [[200, 1.78], [1000, 1.58], [2000, 1.42]]),
      variant("mock-rubber-base-15ml", "DEMO-GE-003-15", { volume: "15 ml" }, 300, "bottles", [[300, 2.06], [1200, 1.85], [2400, 1.67]]),
    ],
    collections: ["us-market-edit"],
    oemOdm: { oem: true, odm: false }, customizationOptions: ["logo", "packaging"],
  }),
  mockProduct({
    id: "mock-matte-top-coat", slug: "matte-top-coat-mock", productCode: "DEMO-GE-004",
    name: { en: "Matte Gel Top Coat", zh: "哑光凝胶封层" },
    short: { en: "A matte top coat concept for finishing gel polish ranges.", zh: "适合凝胶甲油系列的哑光封层概念。" },
    categoryId: "gel-polish", subcategoryId: "gel-top-coat", childCategoryId: "gel-matte-top",
    visual: "gel", attributes: { type: "Top Coat", finish: "Matte" },
    variants: [
      variant("mock-matte-top-10ml", "DEMO-GE-004-10", { volume: "10 ml" }, 200, "bottles", [[200, 1.69], [1000, 1.49], [2000, 1.32]]),
      variant("mock-matte-top-15ml", "DEMO-GE-004-15", { volume: "15 ml" }, 400, "bottles", [[400, 1.98], [1200, 1.76], [2400, 1.58]]),
    ],
    collections: ["minimal", "europe-market-edit"],
    oemOdm: { oem: true, odm: false }, customizationOptions: ["logo", "packaging"],
  }),
  mockProduct({
    id: "mock-bottle-builder-gel", slug: "bottle-builder-gel-mock", productCode: "DEMO-EX-001",
    name: { en: "Bottle Builder Gel", zh: "瓶装建构胶" },
    short: { en: "A bottled builder gel concept for extension service ranges.", zh: "适合延长服务系列的瓶装建构胶概念。" },
    categoryId: "nail-gel-extension", subcategoryId: "extension-builder-gels", childCategoryId: "extension-bottle-builder",
    visual: "gel", attributes: { type: "Builder Gel" },
    variants: [
      variant("mock-builder-clear", "DEMO-EX-001-C", { color: "Clear", volume: "15 ml" }, 150, "bottles", [[150, 2.28], [750, 2.03], [1500, 1.82]]),
      variant("mock-builder-milky", "DEMO-EX-001-M", { color: "Milky", volume: "15 ml" }, 300, "bottles", [[300, 2.42], [900, 2.15], [1800, 1.92]]),
    ],
    collections: ["us-market-edit"],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["product", "color", "logo", "packaging"],
  }),
  mockProduct({
    id: "mock-polygel-extension", slug: "polygel-extension-mock", productCode: "DEMO-EX-002",
    name: { en: "Polygel Extension Tube", zh: "多效延长胶软管装" },
    short: { en: "A tube-format polygel concept for extension assortments.", zh: "适合延长产品组合的软管装多效延长胶概念。" },
    categoryId: "nail-gel-extension", subcategoryId: "extension-systems", childCategoryId: "extension-polygel",
    visual: "gel", attributes: { type: "Polygel" },
    variants: [
      variant("mock-polygel-clear", "DEMO-EX-002-C", { color: "Clear", weight: "30 g" }, 120, "tubes", [[120, 3.18], [600, 2.85], [1200, 2.56]]),
      variant("mock-polygel-nude", "DEMO-EX-002-N", { color: "Nude", weight: "30 g" }, 240, "tubes", [[240, 3.36], [720, 3.02], [1440, 2.72]]),
    ],
    collections: ["europe-market-edit"],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["product", "color", "logo", "packaging"],
  }),
  mockProduct({
    id: "mock-soft-gel-tips", slug: "soft-gel-tips-mock", productCode: "DEMO-EX-003",
    name: { en: "Soft Gel Extension Tips", zh: "软凝胶延长甲片" },
    short: { en: "Full-cover soft gel tips for extension kit planning.", zh: "用于延长套装规划的全贴软凝胶甲片。" },
    categoryId: "nail-gel-extension", subcategoryId: "extension-systems", childCategoryId: "extension-soft-gel-tips",
    visual: "gel", variantImage: true, attributes: { type: "Soft Gel Tips", material: "Soft Gel" },
    variants: [
      variant("mock-soft-tips-almond", "DEMO-EX-003-A", { shape: "Almond", size: "Mixed" }, 100, "packs", [[100, 4.10], [500, 3.69], [1000, 3.32]], { packageContents: { quantity: 240, unit: "tips" } }),
      variant("mock-soft-tips-square", "DEMO-EX-003-S", { shape: "Square", size: "Mixed" }, 200, "packs", [[200, 4.32], [600, 3.88], [1200, 3.49]], { imageIndex: 2, packageContents: { quantity: 240, unit: "tips" } }),
    ],
    collections: ["wedding", "us-market-edit"],
    oemOdm: { oem: true, odm: false }, customizationOptions: ["logo", "packaging"],
  }),
  mockProduct({
    id: "concept-nail-lamp", slug: "studio-lamp-concept", productCode: "DEMO-LA-001",
    name: { en: "Studio Nail Lamp Concept", zh: "工作室美甲灯概念款" },
    short: { en: "A full-size LED lamp direction for nail professionals.", zh: "面向专业美甲人士的全尺寸 LED 美甲灯方向。" },
    categoryId: "nail-lamps", subcategoryId: "lamp-led", childCategoryId: "lamp-led-full-size",
    visual: "lamp", primaryImageSrc: "/images/categories/nail-lamps-tools-v1.png",
    attributes: { type: "LED Lamp", power: "48 W" },
    variants: [
      variant("concept-nail-lamp-us", "DEMO-LA-001-US", { plug: "US" }, 24, "units", [[24, 18.50], [120, 16.80], [240, 15.20]]),
      variant("concept-nail-lamp-eu", "DEMO-LA-001-EU", { plug: "EU" }, 48, "units", [[48, 19.10], [144, 17.30], [288, 15.65]]),
    ],
    collections: [],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["product", "logo", "packaging"],
    customizationMoq: { product: { quantity: 240, unit: "units" }, logo: { quantity: 120, unit: "units" } },
    featured: true,
  }),
  mockProduct({
    id: "mock-mini-led-lamp", slug: "mini-led-lamp-mock", productCode: "DEMO-LA-002",
    name: { en: "Mini LED Nail Lamp", zh: "迷你 LED 美甲灯" },
    short: { en: "A compact lamp format for portable nail kits.", zh: "适合便携美甲套装的迷你灯具形态。" },
    categoryId: "nail-lamps", subcategoryId: "lamp-led", childCategoryId: "lamp-led-mini",
    visual: "lamp", attributes: { type: "LED Lamp", power: "12 W" },
    variants: [
      variant("mock-mini-lamp-white", "DEMO-LA-002-W", { color: "White", plug: "USB" }, 50, "units", [[50, 5.80], [250, 5.15], [500, 4.62]]),
      variant("mock-mini-lamp-pink", "DEMO-LA-002-P", { color: "Pink", plug: "USB" }, 100, "units", [[100, 6.05], [300, 5.38], [600, 4.84]]),
    ],
    collections: ["us-market-edit"],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["color", "logo", "packaging"],
  }),
  mockProduct({
    id: "mock-lamp-power-adapter", slug: "nail-lamp-power-adapter-mock", productCode: "DEMO-LA-003",
    name: { en: "Nail Lamp Power Adapter", zh: "美甲灯电源适配器" },
    short: { en: "A replacement power adapter concept for lamp assortments.", zh: "适合美甲灯配套销售的替换电源适配器概念。" },
    categoryId: "nail-lamps", subcategoryId: "lamp-accessories", childCategoryId: "lamp-power-adapters",
    visual: "lamp", attributes: { type: "Power Adapter" },
    variants: [
      variant("mock-adapter-us", "DEMO-LA-003-US", { plug: "US", voltage: "110 V" }, 100, "units", [[100, 3.25], [500, 2.91], [1000, 2.62]]),
      variant("mock-adapter-eu", "DEMO-LA-003-EU", { plug: "EU", voltage: "220 V" }, 200, "units", [[200, 3.42], [600, 3.06], [1200, 2.75]]),
    ],
    collections: ["europe-market-edit"],
    oemOdm: { oem: true, odm: false }, customizationOptions: ["packaging"],
  }),
  mockProduct({
    id: "mock-portable-nail-drill", slug: "portable-nail-drill-mock", productCode: "DEMO-MA-001",
    name: { en: "Portable Nail Drill", zh: "便携式美甲打磨机" },
    short: { en: "A portable nail drill concept for professional workstations.", zh: "适合专业工作台的便携式美甲打磨机概念。" },
    categoryId: "nail-machines", subcategoryId: "machine-drills", childCategoryId: "machine-drills-portable",
    visual: "machine", primaryImageSrc: "/images/categories/nail-machines-v1.png",
    attributes: { type: "Nail Drill", rpm: "30000" },
    variants: [
      variant("mock-portable-drill-us", "DEMO-MA-001-US", { plug: "US", color: "White" }, 20, "units", [[20, 29.80], [100, 27.10], [200, 24.60]]),
      variant("mock-portable-drill-eu", "DEMO-MA-001-EU", { plug: "EU", color: "White" }, 40, "units", [[40, 31.20], [120, 28.35], [240, 25.80]]),
    ],
    collections: ["us-market-edit"],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["product", "color", "logo", "packaging"],
  }),
  mockProduct({
    id: "mock-desktop-dust-collector", slug: "desktop-dust-collector-mock", productCode: "DEMO-MA-002",
    name: { en: "Desktop Nail Dust Collector", zh: "台式美甲吸尘器" },
    short: { en: "A desktop dust collector concept for salon equipment ranges.", zh: "适合沙龙设备系列的台式美甲吸尘器概念。" },
    categoryId: "nail-machines", subcategoryId: "machine-dust-collectors", childCategoryId: "machine-dust-desktop",
    visual: "machine", attributes: { type: "Dust Collector", power: "40 W" },
    variants: [
      variant("mock-dust-collector-white", "DEMO-MA-002-W", { color: "White" }, 20, "units", [[20, 32.50], [100, 29.40], [200, 26.70]]),
      variant("mock-dust-collector-grey", "DEMO-MA-002-G", { color: "Grey" }, 40, "units", [[40, 34.10], [120, 30.80], [240, 27.90]]),
    ],
    collections: ["europe-market-edit"],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["color", "logo", "packaging"],
  }),
  mockProduct({
    id: "mock-nail-file-pack", slug: "professional-nail-file-pack-mock", productCode: "DEMO-TO-001",
    name: { en: "Professional Nail File Pack", zh: "专业美甲锉套装" },
    short: { en: "A salon file pack concept for wholesale tool ranges.", zh: "适合批发工具系列的沙龙美甲锉套装概念。" },
    categoryId: "nail-tools", subcategoryId: "tools-files-buffers", childCategoryId: "tools-files",
    visual: "tools", primaryImageSrc: "/images/categories/nail-tools-care-v1.png",
    attributes: { type: "Nail File", material: "Abrasive Board" },
    variants: [
      variant("mock-file-pack-100-180", "DEMO-TO-001-A", { grit: "100/180" }, 100, "packs", [[100, 1.05], [500, 0.91], [1000, 0.81]], { packageContents: { quantity: 50, unit: "nail files" } }),
      variant("mock-file-pack-180-240", "DEMO-TO-001-B", { grit: "180/240" }, 200, "packs", [[200, 1.12], [600, 0.97], [1200, 0.86]], { packageContents: { quantity: 50, unit: "nail files" } }),
    ],
    collections: ["us-market-edit"],
    oemOdm: { oem: true, odm: false }, customizationOptions: ["logo", "packaging"],
  }),
  mockProduct({
    id: "mock-gel-brush-set", slug: "gel-brush-set-mock", productCode: "DEMO-TO-002",
    name: { en: "Gel Brush Set", zh: "凝胶刷套装" },
    short: { en: "A multi-size brush set concept for gel application.", zh: "适合凝胶涂布的多尺寸刷具套装概念。" },
    categoryId: "nail-tools", subcategoryId: "tools-brushes", childCategoryId: "tools-gel-brushes",
    visual: "tools", attributes: { type: "Gel Brush", material: "Synthetic Bristle" },
    variants: [
      variant("mock-gel-brush-three", "DEMO-TO-002-3", {}, 80, "sets", [[80, 2.45], [400, 2.20], [800, 1.98]], { packageContents: { quantity: 3, unit: "brushes" } }),
      variant("mock-gel-brush-five", "DEMO-TO-002-5", {}, 160, "sets", [[160, 3.72], [480, 3.34], [960, 3.01]], { packageContents: { quantity: 5, unit: "brushes" } }),
    ],
    collections: ["minimal"],
    oemOdm: { oem: true, odm: false }, customizationOptions: ["logo", "packaging"],
  }),
  mockProduct({
    id: "mock-cuticle-nippers", slug: "cuticle-nippers-mock", productCode: "DEMO-TO-003",
    name: { en: "Cuticle Nippers", zh: "死皮剪" },
    short: { en: "A stainless steel cuticle tool concept for salon assortments.", zh: "适合沙龙工具组合的不锈钢死皮剪概念。" },
    categoryId: "nail-tools", subcategoryId: "tools-cuticle", childCategoryId: "tools-nippers",
    visual: "tools", attributes: { type: "Cuticle Nippers", material: "Stainless Steel" },
    variants: [
      variant("mock-nippers-small", "DEMO-TO-003-S", { size: "Small" }, 100, "units", [[100, 2.85], [500, 2.56], [1000, 2.30]]),
      variant("mock-nippers-standard", "DEMO-TO-003-M", { size: "Standard" }, 200, "units", [[200, 3.04], [600, 2.72], [1200, 2.45]]),
    ],
    collections: ["europe-market-edit"],
    oemOdm: { oem: true, odm: false }, customizationOptions: ["logo", "packaging"],
  }),
  mockProduct({
    id: "mock-rhinestone-mix", slug: "nail-rhinestone-mix-mock", productCode: "DEMO-AR-001",
    name: { en: "Nail Rhinestone Mix", zh: "美甲水钻混合装" },
    short: { en: "A mixed rhinestone assortment for nail art kits.", zh: "适合美甲装饰套装的混合水钻组合。" },
    categoryId: "nail-art", subcategoryId: "art-charms-rhinestones", childCategoryId: "art-rhinestones",
    visual: "accessories", primaryImageSrc: "/images/categories/nail-accessories-v1.png",
    attributes: { type: "Rhinestones", material: "Decorative Crystal" },
    variants: [
      variant("mock-rhinestones-clear", "DEMO-AR-001-C", { color: "Clear" }, 100, "packs", [[100, 0.92], [500, 0.81], [1000, 0.72]], { packageContents: { quantity: 100, unit: "rhinestones" } }),
      variant("mock-rhinestones-mixed", "DEMO-AR-001-M", { color: "Mixed" }, 200, "packs", [[200, 1.05], [600, 0.92], [1200, 0.82]], { packageContents: { quantity: 100, unit: "rhinestones" } }),
    ],
    collections: ["chrome", "wedding"],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["color", "packaging"],
  }),
  mockProduct({
    id: "mock-transfer-foil-set", slug: "nail-transfer-foil-set-mock", productCode: "DEMO-AR-002",
    name: { en: "Nail Transfer Foil Set", zh: "美甲转印箔套装" },
    short: { en: "A decorative foil set concept for nail art ranges.", zh: "适合美甲装饰系列的转印箔套装概念。" },
    categoryId: "nail-art", subcategoryId: "art-foils-stickers", childCategoryId: "art-foils",
    visual: "accessories", attributes: { type: "Transfer Foil", finish: "Metallic" },
    variants: [
      variant("mock-foil-silver", "DEMO-AR-002-S", { color: "Silver" }, 100, "sets", [[100, 1.28], [500, 1.13], [1000, 1.01]], { packageContents: { quantity: 10, unit: "foils" } }),
      variant("mock-foil-gold", "DEMO-AR-002-G", { color: "Gold" }, 200, "sets", [[200, 1.39], [600, 1.22], [1200, 1.09]], { packageContents: { quantity: 10, unit: "foils" } }),
    ],
    collections: ["chrome", "us-market-edit"],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["color", "packaging"],
  }),
  mockProduct({
    id: "mock-cuticle-oil", slug: "cuticle-oil-mock", productCode: "DEMO-CA-001",
    name: { en: "Cuticle Oil", zh: "指缘护理油" },
    short: { en: "A cuticle oil concept for aftercare and private label ranges.", zh: "适合护理及自有品牌系列的指缘油概念。" },
    categoryId: "nail-care", subcategoryId: "tools-prep", childCategoryId: "care-cuticle-oils",
    visual: "tools", primaryImageSrc: "/images/categories/nail-tools-care-v1.png",
    attributes: { type: "Cuticle Oil" },
    variants: [
      variant("mock-cuticle-oil-10ml", "DEMO-CA-001-10", { volume: "10 ml" }, 200, "bottles", [[200, 1.35], [1000, 1.19], [2000, 1.06]]),
      variant("mock-cuticle-oil-15ml", "DEMO-CA-001-15", { volume: "15 ml" }, 400, "bottles", [[400, 1.62], [1200, 1.44], [2400, 1.28]]),
    ],
    collections: ["minimal", "wedding"],
    oemOdm: { oem: true, odm: true }, customizationOptions: ["product", "logo", "packaging"],
  }),
  mockProduct({
    id: "mock-gel-remover", slug: "gel-remover-mock", productCode: "DEMO-CA-002",
    name: { en: "Gel Remover", zh: "凝胶卸甲液" },
    short: { en: "A remover format concept for professional nail care lines.", zh: "适合专业美甲护理系列的卸甲产品形态。" },
    categoryId: "nail-care", subcategoryId: "care-removers", childCategoryId: "care-gel-removers",
    visual: "tools", attributes: { type: "Gel Remover" },
    variants: [
      variant("mock-gel-remover-100ml", "DEMO-CA-002-100", { volume: "100 ml" }, 120, "bottles", [[120, 2.12], [600, 1.89], [1200, 1.69]]),
      variant("mock-gel-remover-250ml", "DEMO-CA-002-250", { volume: "250 ml" }, 240, "bottles", [[240, 3.47], [720, 3.10], [1440, 2.78]]),
    ],
    collections: ["europe-market-edit"],
    oemOdm: { oem: true, odm: false }, customizationOptions: ["logo", "packaging"],
  }),
];
