import type { Locale } from "@/i18n/config";

export type LocalizedText = Record<Locale, string>;
export type CategoryDepth = 1 | 2 | 3;
export type VisualKind = "press-on" | "gel" | "lamp" | "machine" | "tools" | "accessories";

export type SeoContent = {
  title: LocalizedText;
  description: LocalizedText;
  indexable?: boolean;
};

export type Category = {
  id: string;
  slug: string;
  parentId: string | null;
  depth: CategoryDepth;
  name: LocalizedText;
  shortDescription: LocalizedText;
  visual: VisualKind;
  seo: SeoContent;
};

export type AttributeValue = string | number | boolean | readonly string[];
export type AttributeDefinition = {
  key: string;
  label: LocalizedText;
  categoryIds: readonly string[];
  valueType: "text" | "number" | "boolean" | "list";
};

export type ProductImage = {
  src?: string;
  alt: LocalizedText;
  visual: VisualKind;
};

export type ProductVariant = {
  id: string;
  sku: string;
  attributes: Record<string, AttributeValue>;
  imageIndex?: number;
};

export type CustomizationOption =
  | "product" | "color" | "material" | "finish" | "logo" | "packaging";

export type RfqField =
  | "quantity" | "destination" | "targetMarket" | "branding" | "packaging" | "notes";

export type Product = {
  id: string;
  slug: string;
  sku: string;
  name: LocalizedText;
  shortDescription: LocalizedText;
  description: LocalizedText;
  categoryId: string;
  subcategoryId?: string;
  childCategoryId?: string;
  images: ProductImage[];
  attributes: Record<string, AttributeValue>;
  variants: ProductVariant[];
  collections: string[];
  customizationOptions: CustomizationOption[];
  moq?: { quantity: number; unit: string; note?: LocalizedText };
  leadTime?: { minDays?: number; maxDays?: number; note?: LocalizedText };
  featured: boolean;
  newArrival: boolean;
  seo: SeoContent;
  rfq: { enabled: boolean; fields: RfqField[] };
  isMock: boolean;
};

export type CollectionKind = "style" | "occasion" | "market" | "audience";
export type Collection = {
  id: string;
  slug: string;
  kind: CollectionKind;
  name: LocalizedText;
  shortDescription: LocalizedText;
  productIds: string[];
  visual: VisualKind;
  featured: boolean;
  seo: SeoContent;
  isMock: boolean;
};

export type Insight = {
  id: string;
  slug: string;
  topic: LocalizedText;
  title: LocalizedText;
  excerpt: LocalizedText;
  seo: SeoContent;
  isMock: boolean;
};
