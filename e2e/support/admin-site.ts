import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = process.cwd();
let fixtureRoot = "";
export let fixtureOrigin = "";
let fixtureServer: ChildProcess | undefined;

// These replacements exist only in a temporary copy. The repository's Auth and
// Catalog server entry points are never modified or switched by request input.
const accessFixture = `
import "server-only";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { CatalogPermission } from "../catalog-import/admin-auth.ts";
export async function requireAdminPage(permission?: CatalogPermission) {
  const role = (await cookies()).get("admin-ui-fixture")?.value;
  if (!role) redirect("/admin/login");
  const permissions = role === "editor" ? ["catalog.read", "catalog.import.receipt.read"] :
    role === "catalog-only" ? ["catalog.read"] : [];
  if (permission && !permissions.includes(permission)) redirect("/admin/login?error=1");
}
`;

const identityFixture = `
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { AdminIdentity } from "../catalog-import/admin-auth.ts";
export const getAdminUIIdentity = cache(async () => {
  const role = (await cookies()).get("admin-ui-fixture")?.value;
  if (!role) redirect("/admin/login");
  return { admin_id: "11111111-1111-4111-8111-111111111111",
    identity_provider: "fixture", provider_subject: "fixture-admin", status: "active",
    created_at: "2026-10-18T00:00:00Z", disabled_at: null,
    permissions: role === "editor" ? ["catalog.read", "catalog.import.receipt.read"] :
      role === "catalog-only" ? ["catalog.read"] : [] } as AdminIdentity;
});
`;

const catalogFixture = `
import "server-only";
import { cookies } from "next/headers";
import { createCatalogReadRepository } from "./repository-core.ts";
import { createAdminCursorCodec } from "./admin-cursor.ts";
import { createCollectionCursorCodec } from "./collections-cursor.ts";
import { createCollectionsFixtureSource } from "./collections-fixture-source.ts";
import { createOfflineCatalogSource, notConfiguredCatalogSource } from "./offline.ts";
import type { PrivateCatalogBundle } from "./types.ts";
const date = "2026-10-01T00:00:00.000Z";
const id = (n: number) => \`\${String(n).padStart(8, "0")}-0000-4000-8000-000000000000\`;
function row(n: number, status: "draft" | "published" | "retired"): PrivateCatalogBundle {
  const productId = id(n);
  return { product: { id: productId, product_code: \`FAMILY-\${n}\`, slug: \`family-\${n}\`,
    product_type: "press-on", status, attributes: {}, customization_options: [], oem: false,
    odm: false, lead_time_min_days: null, lead_time_max_days: null, seo_indexable: false,
    featured: false, new_arrival: false, published_at: status === "published" ? date : null,
    created_at: date, updated_at: date },
    translations: [{ product_id: productId, locale: "en", name: \`Family \${n}\`,
      short_description: "", description: "", seo_title: "", seo_description: "",
      created_at: date, updated_at: date },
      ...(n === 3 ? [] : [{ product_id: productId, locale: "zh" as const, name: \`家族 \${n}\`,
      short_description: "", description: "", seo_title: "", seo_description: "",
      created_at: date, updated_at: date }])],
    variants: [{ id: id(n + 100), product_id: productId, sku: \`SKU-\${n + 100}\`, status,
      attributes: {}, moq_quantity: "100", moq_unit: "pieces", order_multiple: null,
      package_quantity: null, package_unit: null, reference_price: null,
      reference_currency: null, sort_order: 0, created_at: date, updated_at: date },
      ...(n === 2 ? [{ id: id(n + 300), product_id: productId, sku: "SKU-SECONDARY-" + "X".repeat(120),
        status: "draft" as const, attributes: { color: "red" }, moq_quantity: "250",
        moq_unit: "pieces", order_multiple: null, package_quantity: null, package_unit: null,
        reference_price: null, reference_currency: null, sort_order: 1,
        created_at: date, updated_at: date }] : [])],
    categoryLinks: [{ product_id: productId, category_id: id(n <= 3 ? 701 : 702),
      is_primary: true, sort_order: 0, created_at: date, updated_at: date },
      ...(n === 1 || n === 2 ? [{ product_id: productId, category_id: id(702),
        is_primary: false, sort_order: 1, created_at: date, updated_at: date }] : [])],
    categories: [701, 702].map((number) => ({ id: id(number), parent_id: null,
      slug: number === 701 ? "nails" : "care", status: "published" as const,
      name_en: number === 701 ? "Nails" : "Care", name_zh: number === 701 ? "美甲" : "护理",
      description_en: "", description_zh: "", sort_order: number,
      created_at: date, updated_at: date })),
    images: [{ id: id(n + 200), product_id: productId,
      variant_id: null, storage_key: "private/fixture.webp", public_url: "https://example.invalid/image.webp",
      role: "primary", status, sort_order: 0, width: null, height: null, format: "webp",
      alt_en: "Front view", alt_zh: "正面", created_at: date, updated_at: date },
      ...(n === 2 ? [{ id: id(n + 400), product_id: productId, variant_id: id(n + 300),
        storage_key: "private/variant.webp", public_url: "https://example.invalid/variant.webp",
        role: "variant" as const, status: "draft" as const, sort_order: 1,
        width: null, height: null, format: "webp" as const, alt_en: "Variant view", alt_zh: "",
        created_at: date, updated_at: date },
        { id: id(n + 500), product_id: productId, variant_id: null,
          storage_key: "private/detail.webp", public_url: "https://example.invalid/detail.webp",
          role: "detail" as const, status: "published" as const, sort_order: 2,
          width: null, height: null, format: "webp" as const, alt_en: "Side view", alt_zh: "侧面",
          created_at: date, updated_at: date }] : [])] };
}
const sample = createOfflineCatalogSource([row(1, "draft"), row(2, "published"), row(3, "retired")]);
const categoryDate = { created_at: date, updated_at: date };
const category = (number: number, parent: number | null, slug: string, en: string, zh: string, order: number) => ({
  ...categoryDate, id: id(number), parent_id: parent === null ? null : id(parent), slug,
  status: "published" as const, name_en: en, name_zh: zh,
  description_en: "English description", description_zh: "中文描述", sort_order: order,
});
const categoryRows = [category(710, null, "nails", "Nails", "美甲", 2),
  category(711, 710, "press-on", "Press On", "穿戴甲", 0),
  category(712, 711, "almond", "Almond", "杏仁形", 0),
  category(713, null, "care", "Care", "护理", 1),
  category(714, 712, "deep", "Deep", "深层", 0)];
const categorySource = createOfflineCatalogSource([], categoryRows);
const categoryEmpty = createOfflineCatalogSource([], []);
const categoryIncomplete = createOfflineCatalogSource([], [category(720, 799, "orphan", "Orphan", "孤儿", 0)]);
const categoryCycle = createOfflineCatalogSource([], [category(720, 721, "cycle-a", "Cycle A", "循环甲", 0),
  category(721, 720, "cycle-b", "Cycle B", "循环乙", 0)]);
const categoryDuplicate = createOfflineCatalogSource([], [categoryRows[0], categoryRows[0]]);
const categoryTruncated = createOfflineCatalogSource([], Array.from({ length: 501 }, (_, index) =>
  category(1000 + index, null, \`cat-\${index}\`, \`Category \${index}\`, "分类", index)));
const categoryTruncatedParent = createOfflineCatalogSource([], [
  ...Array.from({ length: 499 }, (_, index) =>
    category(1000 + index, null, "cat-" + index, "Category " + index, "分类", index)),
  category(1499, 1600, "orphan-at-limit", "Orphan at limit", "边界孤儿", 499),
  category(1600, null, "parent-past-limit", "Parent past limit", "边界父级", 500),
]);
const categoryFailed = { ...categorySource, async listAdminCategories(): Promise<never> {
  throw Error("private://category-secret"); } };
const querySample = createOfflineCatalogSource(Array.from({ length: 45 }, (_, index) =>
  row(index + 1, index % 3 === 0 ? "draft" : index % 3 === 1 ? "published" : "retired")));
const specialSample = createOfflineCatalogSource(Array.from({ length: 22 }, (_, index) => {
  const bundle = row(index + 1, "published");
  return { ...bundle, product: { ...bundle.product,
    product_code: ["CN-甲", "A/B", "A B", "A!"][index] ?? bundle.product.product_code } };
}));
const lengths = [128, 256, 512, 1024, 2048, 4096, 8192, 32768];
const lengthSample = createOfflineCatalogSource(lengths.flatMap((length, index) =>
  ["A".repeat(length), "甲".repeat(length)].map((code, kind) => {
    const bundle = row(100 + index * 2 + kind, "draft");
    return { ...bundle, product: { ...bundle.product, product_code: code } };
  })));
const cursorSamples = new Map([128, 1024, 2048, 4096, 8192, 32768].map((length) => [
  \`cursor-\${length}\`, createOfflineCatalogSource(Array.from({ length: 21 }, (_, index) => {
    const bundle = row(index + 1, "draft");
    const code = index < 19 ? \`A\${String(index).padStart(2, "0")}\` :
      index === 19 ? "甲".repeat(length) : "龥";
    return { ...bundle, product: { ...bundle.product, product_code: code } };
  })),
]));
const legacyOptions = { mode: "offline" as const, listAdmin: sample.listAdmin,
  getAdminByCode: sample.getAdminByCode, getAdminById: sample.getAdminById,
  listPublished: sample.listPublished,
  getPublishedBySlug: sample.getPublishedBySlug };
const empty = createOfflineCatalogSource([]);
const failed = { mode: "offline" as const,
  async listAdmin(): Promise<never> { throw Error("postgres://secret.invalid"); },
  async getAdminByCode(): Promise<never> { throw Error("postgres://secret.invalid"); },
  async getAdminById(): Promise<never> { throw Error("postgres://secret.invalid"); },
  async listPublished() { return { rows: [], hasMore: false }; },
  async getPublishedBySlug() { return null; } };
export async function createServerCatalogReadRepository() {
  const cookieStore = await cookies();
  const role = cookieStore.get("admin-ui-fixture")?.value;
  const state = cookieStore.get("catalog-read-fixture")?.value;
  const source = state === "success" ? sample : state === "query" ? querySample :
    state?.startsWith("collections") ? createCollectionsFixtureSource(state) :
    state === "category" ? categorySource : state === "category-empty" ? categoryEmpty :
    state === "category-incomplete" ? categoryIncomplete : state === "category-cycle" ? categoryCycle :
    state === "category-duplicate" ? categoryDuplicate : state === "category-truncated" ? categoryTruncated :
    state === "category-truncated-parent" ? categoryTruncatedParent :
    state === "category-error" ? categoryFailed :
    state === "special" ? specialSample : state === "length" ? lengthSample :
    (cursorSamples.get(state ?? "") ??
      (state === "legacy-options" ? legacyOptions : state === "empty" ? empty :
        state === "error" ? failed : notConfiguredCatalogSource));
  return createCatalogReadRepository(source, {
    session: role,
    dependencies: {
      provider: { async verifySession(session) {
        return session === "editor" || session === "catalog-only"
          ? { identity_provider: "fixture", provider_subject: session } : null;
      } },
      directory: { async findByProviderIdentity(identity) {
        return { admin_id: id(999), identity_provider: "fixture", provider_subject: identity.provider_subject,
          status: "active", created_at: date, disabled_at: null,
          permissions: state === "forbidden" ? [] : role === "editor"
            ? ["catalog.read", "catalog.import.receipt.read"] : ["catalog.read"] };
      } },
    },
  }, createAdminCursorCodec(process.env.ADMIN_CATALOG_CURSOR_SIGNING_KEY ?? ""),
    createCollectionCursorCodec(process.env.ADMIN_CATALOG_CURSOR_SIGNING_KEY ?? ""));
}
`;

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Unable to allocate fixture port");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export async function startAdminFixture() {
  try {
    fixtureRoot = mkdtempSync(join(tmpdir(), "beauty-admin-products-"));
    for (const entry of ["src", "public", "package.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json"]) {
      cpSync(join(repositoryRoot, entry), join(fixtureRoot, entry), { recursive: true });
    }
    const dependencies = join(repositoryRoot, "node_modules");
    if (!existsSync(dependencies)) throw Error("Install project dependencies before running browser tests");
    symlinkSync(dependencies, join(fixtureRoot, "node_modules"), "dir");
    writeFileSync(join(fixtureRoot, "src/lib/admin/server-access.ts"), accessFixture);
    writeFileSync(join(fixtureRoot, "src/lib/admin/ui-identity.ts"), identityFixture);
    writeFileSync(join(fixtureRoot, "src/lib/catalog-read/server.ts"), catalogFixture);
    cpSync(join(repositoryRoot, "e2e/support/collections-fixture-source.ts"),
      join(fixtureRoot, "src/lib/catalog-read/collections-fixture-source.ts"));
    cpSync(join(repositoryRoot, "e2e/support/collection-membership-check-fixture-route.ts"),
      join(fixtureRoot, "src/app/api/admin/collections/[collectionId]/membership-check/route.ts"));
    const categoryRefreshRoute = join(fixtureRoot, "src/app/admin/(workspace)/category-refresh-fixture");
    mkdirSync(categoryRefreshRoute, { recursive: true });
    cpSync(join(repositoryRoot, "e2e/support/category-refresh-page.tsx"), join(categoryRefreshRoute, "page.tsx"));
    const collectionRefreshRoute = join(fixtureRoot, "src/app/admin/(workspace)/collection-basic-refresh-fixture");
    mkdirSync(collectionRefreshRoute, { recursive: true });
    cpSync(join(repositoryRoot, "e2e/support/collection-basic-refresh-page.tsx"), join(collectionRefreshRoute, "page.tsx"));
    const memberRefreshRoute = join(fixtureRoot, "src/app/admin/(workspace)/collection-membership-refresh-fixture");
    mkdirSync(memberRefreshRoute, { recursive: true });
    cpSync(join(repositoryRoot, "e2e/support/collection-membership-refresh-page.tsx"), join(memberRefreshRoute, "page.tsx"));
    const panelPath = join(fixtureRoot, "src/components/admin/product-list-panel.tsx");
    const panelSource = readFileSync(panelPath, "utf8");
    if (!panelSource.includes("testData = false")) throw Error("Admin products fixture no longer matches the list panel");
    writeFileSync(panelPath, panelSource.replace("testData = false", "testData = true"));
    const detailPath = join(fixtureRoot, "src/components/admin/product-detail-panel.tsx");
    const detailSource = readFileSync(detailPath, "utf8");
    if (!detailSource.includes("testData = false")) throw Error("Admin detail fixture no longer matches the detail panel");
    writeFileSync(detailPath, detailSource.replace("testData = false", "testData = true"));

    fixtureOrigin = `http://127.0.0.1:${await unusedPort()}`;
    fixtureServer = spawn(process.execPath, [join(dependencies, "next/dist/bin/next"), "dev", "--webpack",
      "--hostname", "127.0.0.1", "--port", new URL(fixtureOrigin).port], {
      cwd: fixtureRoot,
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        ADMIN_DIRECTORY_DATABASE_URL: "", DATABASE_URL: "", RFQ_DATABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
        ADMIN_CATALOG_CURSOR_SIGNING_KEY: randomBytes(32).toString("base64url") },
      stdio: "ignore",
    });
    const deadline = Date.now() + 110_000;
    while (Date.now() < deadline) {
      if (fixtureServer.exitCode !== null) throw Error("Isolated Admin fixture exited during startup");
      try {
        const response = await fetch(`${fixtureOrigin}/admin/login`);
        if (response.ok) return;
      } catch { /* Wait for the local fixture to start. */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw Error("Isolated Admin fixture did not start in time");
  } catch (error) {
    await stopAdminFixture();
    throw error;
  }
}

export async function stopAdminFixture() {
  if (fixtureServer && fixtureServer.exitCode === null) {
    fixtureServer.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => fixtureServer?.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (fixtureServer.exitCode === null) fixtureServer.kill("SIGKILL");
  }
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  fixtureServer = undefined;
  fixtureRoot = "";
  fixtureOrigin = "";
}

export async function fixtureCookies(context: { addCookies: (cookies: { name: string; value: string; url: string }[]) => Promise<void> }, state?: string, role = "editor") {
  const cookies = [{ name: "admin-ui-fixture", value: role, url: fixtureOrigin }];
  if (state) cookies.push({ name: "catalog-read-fixture", value: state, url: fixtureOrigin });
  await context.addCookies(cookies);
}
