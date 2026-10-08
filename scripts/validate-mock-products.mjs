import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

// Load the few local TypeScript data files with the compiler already in devDependencies.
function loadDataModule(filePath) {
  const resolved = path.resolve(filePath);
  if (moduleCache.has(resolved)) return moduleCache.get(resolved).exports;
  const moduleRecord = { exports: {} };
  moduleCache.set(resolved, moduleRecord);
  const source = fs.readFileSync(resolved, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: resolved,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) throw new Error(`Unexpected runtime dependency: ${specifier}`);
    const target = path.resolve(path.dirname(resolved), specifier);
    return loadDataModule(path.extname(target) ? target : `${target}.ts`);
  };
  new Function("require", "module", "exports", compiled)(localRequire, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

const { products } = loadDataModule(path.join(projectRoot, "src/lib/catalog/products.ts"));
const { categories } = loadDataModule(path.join(projectRoot, "src/lib/catalog/taxonomy.ts"));
const { collections } = loadDataModule(path.join(projectRoot, "src/lib/catalog/collections.ts"));
const expectedCounts = {
  "press-on-nails": 5, "gel-polish": 4, "nail-gel-extension": 3, "nail-lamps": 3,
  "nail-machines": 2, "nail-tools": 3, "nail-art": 2, "nail-care": 2,
};
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
const ids = new Set();
const slugs = new Set();
const productCodes = new Set();
const variantSkus = new Set();
const variantIds = new Set();
const imageIds = new Set();
const categoriesById = new Map(categories.map((category) => [category.id, category]));
const collectionsById = new Map(collections.map((collection) => [collection.id, collection]));
const productsById = new Map(products.map((product) => [product.id, product]));

function localized(value, label) {
  check(value && typeof value.en === "string" && value.en.trim().length > 0, `${label}: English text missing`);
  check(value && typeof value.zh === "string" && value.zh.trim().length > 0, `${label}: Chinese text missing`);
}

for (const product of products) {
  const label = product.id || "<missing product ID>";
  check(typeof product.id === "string" && product.id.length > 0 && !ids.has(product.id), `${label}: duplicate or missing product ID`);
  ids.add(product.id);
  check(typeof product.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug) && !slugs.has(product.slug), `${label}: duplicate or invalid slug`);
  slugs.add(product.slug);
  check(typeof product.productCode === "string" && product.productCode.length > 0 && !productCodes.has(product.productCode), `${label}: duplicate or missing product code`);
  check(!Object.hasOwn(product, "sku"), `${label}: Product must use productCode, not a purchasable SKU`);
  productCodes.add(product.productCode);
  localized(product.name, `${label}.name`);
  localized(product.shortDescription, `${label}.shortDescription`);
  localized(product.description, `${label}.description`);
  localized(product.seo?.title, `${label}.seo.title`);
  localized(product.seo?.description, `${label}.seo.description`);
  check(product.isMock === true && product.seo?.indexable === false, `${label}: mock product must be noindex`);

  const top = categoriesById.get(product.categoryId);
  const sub = categoriesById.get(product.subcategoryId);
  const child = product.childCategoryId ? categoriesById.get(product.childCategoryId) : undefined;
  check(top?.depth === 1, `${label}: invalid primary category`);
  check(sub?.depth === 2 && sub.parentId === product.categoryId, `${label}: invalid subcategory lineage`);
  if (product.childCategoryId) check(child?.depth === 3 && child.parentId === product.subcategoryId, `${label}: invalid child category lineage`);
  check(Array.isArray(product.collections) && new Set(product.collections).size === product.collections.length, `${label}: duplicate collection link`);
  for (const id of product.collections) check(collectionsById.has(id), `${label}: unknown collection ${id}`);
  check(typeof product.oemOdm?.oem === "boolean" && typeof product.oemOdm?.odm === "boolean", `${label}: OEM/ODM capabilities missing`);
  if (product.oemOdm?.note) localized(product.oemOdm.note, `${label}.oemOdm.note`);
  check(Array.isArray(product.customizationOptions), `${label}: customization options missing`);
  const customizationIds = new Set();
  for (const option of product.customizationOptions) {
    const optionLabel = `${label}.customizationOptions.${option?.id ?? "<missing ID>"}`;
    check(typeof option?.id === "string" && option.id.length > 0 && !customizationIds.has(option.id), `${optionLabel}: duplicate or missing option ID`);
    customizationIds.add(option.id);
    localized(option?.name, `${optionLabel}.name`);
    if (option?.moq !== undefined) {
      check(Number.isInteger(option.moq?.quantity) && option.moq.quantity > 0, `${optionLabel}: customization MOQ must be a positive integer`);
      check(typeof option.moq?.unit === "string" && option.moq.unit.trim().length > 0, `${optionLabel}: customization MOQ unit missing`);
      if (option.moq?.note) localized(option.moq.note, `${optionLabel}.moq.note`);
    }
  }

  check(Array.isArray(product.images) && product.images.length >= 2 && product.images[0]?.role === "primary", `${label}: primary/detail image structure invalid`);
  check(product.images.filter((image) => image.role === "primary").length === 1, `${label}: expected one primary image`);
  check(product.images.some((image) => image.role === "detail"), `${label}: detail image missing`);
  for (const image of product.images) {
    check(typeof image.id === "string" && image.id.length > 0 && !imageIds.has(image.id), `${label}: duplicate or missing image ID`);
    imageIds.add(image.id);
    localized(image.alt, `${label}.${image.id}.alt`);
    check(image.isPlaceholder === true || typeof image.src === "string", `${label}.${image.id}: image source or placeholder marker required`);
    if (image.src) {
      check(image.src.startsWith("/images/") && !image.src.includes(".."), `${label}.${image.id}: invalid image URL`);
      const file = path.join(projectRoot, "public", image.src.replace(/^\//, ""));
      check(fs.existsSync(file), `${label}.${image.id}: image file missing: ${image.src}`);
    }
  }

  check(Array.isArray(product.variants) && product.variants.length > 0, `${label}: variants missing`);
  for (const variant of product.variants) {
    const vLabel = `${label}.${variant.id}`;
    check(typeof variant.id === "string" && variant.id.length > 0 && !variantIds.has(variant.id), `${vLabel}: duplicate or missing variant ID`);
    variantIds.add(variant.id);
    check(typeof variant.sku === "string" && variant.sku.length > 0 && !variantSkus.has(variant.sku), `${vLabel}: duplicate or missing SKU`);
    variantSkus.add(variant.sku);
    check(variant.attributes && typeof variant.attributes === "object", `${vLabel}: variant attributes missing`);
    check(Object.keys(variant.attributes ?? {}).length > 0 || variant.packageContents !== undefined, `${vLabel}: purchasable specification missing`);
    for (const [key, value] of Object.entries(variant.attributes ?? {})) {
      if (Object.hasOwn(product.attributes, key)) {
        check(JSON.stringify(product.attributes[key]) === JSON.stringify(value), `${vLabel}: ${key} conflicts with shared Product attribute`);
      }
    }
    check(Number.isInteger(variant.moq?.quantity) && variant.moq.quantity > 0, `${vLabel}: MOQ must be a positive integer`);
    check(typeof variant.moq?.unit === "string" && variant.moq.unit.trim().length > 0, `${vLabel}: MOQ unit missing`);
    if (variant.moq?.note) localized(variant.moq.note, `${vLabel}.moq.note`);
    if (["packs", "sets", "boxes"].includes(variant.moq?.unit)) {
      check(variant.packageContents !== undefined, `${vLabel}: package contents required for ${variant.moq.unit}`);
    }
    if (variant.packageContents !== undefined) {
      check(Number.isInteger(variant.packageContents.quantity) && variant.packageContents.quantity > 0, `${vLabel}: package quantity must be a positive integer`);
      check(typeof variant.packageContents.unit === "string" && variant.packageContents.unit.trim().length > 0, `${vLabel}: package internal unit missing`);
    }
    check(variant.pricing?.currency === "USD" && variant.pricing.isTestData === true, `${vLabel}: USD test pricing marker missing`);
    const tiers = variant.pricing?.tiers;
    check(Array.isArray(tiers) && tiers.length >= 2, `${vLabel}: at least two price tiers required`);
    if (Array.isArray(tiers) && tiers.length) {
      check(tiers[0].minQuantity === variant.moq?.quantity, `${vLabel}: first tier must start at MOQ`);
      for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i];
        check(Number.isInteger(tier.minQuantity) && tier.minQuantity > 0, `${vLabel}: invalid tier quantity`);
        check(Number.isFinite(tier.unitPriceUsd) && tier.unitPriceUsd > 0, `${vLabel}: invalid USD unit price`);
        if (i > 0) {
          check(tier.minQuantity > tiers[i - 1].minQuantity, `${vLabel}: tier quantities must strictly increase`);
          check(tier.unitPriceUsd <= tiers[i - 1].unitPriceUsd, `${vLabel}: tier prices must not increase`);
        }
      }
    }
    if (variant.imageIndex !== undefined) {
      check(Number.isInteger(variant.imageIndex) && product.images[variant.imageIndex]?.role === "variant", `${vLabel}: invalid variant image reference`);
    }
  }
}

for (const collection of collections) {
  const expected = products.filter((product) => product.collections.includes(collection.id)).map((product) => product.id);
  check(collection.productIds.length === expected.length && expected.every((id) => collection.productIds.includes(id)), `${collection.id}: product links are out of sync`);
  for (const id of collection.productIds) check(productsById.has(id), `${collection.id}: unknown product ${id}`);
}

for (const code of productCodes) check(!variantSkus.has(code), `Product code duplicates purchasable SKU: ${code}`);

check(products.length === 24, `Expected 24 products; found ${products.length}`);
for (const [id, count] of Object.entries(expectedCounts)) {
  check(products.filter((product) => product.categoryId === id).length === count, `${id}: expected ${count} products`);
}

if (errors.length) {
  console.error(`Mock dataset validation failed (${errors.length} issues):\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Mock dataset valid: ${products.length} products, ${variantIds.size} variants, ${productCodes.size} product codes, ${variantSkus.size} purchasable SKUs, ${collections.length} collections.`);
  console.log(Object.entries(expectedCounts).map(([id, count]) => `${id}: ${count}`).join("\n"));
}
