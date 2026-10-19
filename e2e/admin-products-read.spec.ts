import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = process.cwd();
let fixtureRoot = "";
let fixtureOrigin = "";
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
  if (permission && (role !== "editor" || permission !== "catalog.read"))
    redirect("/admin/login?error=1");
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
    permissions: role === "editor" ? ["catalog.read"] : [] } as AdminIdentity;
});
`;

const catalogFixture = `
import "server-only";
import { cookies } from "next/headers";
import { createCatalogReadRepository } from "./repository-core.ts";
import { createAdminCursorCodec } from "./admin-cursor.ts";
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
      { product_id: productId, locale: "zh", name: \`家族 \${n}\`,
      short_description: "", description: "", seo_title: "", seo_description: "",
      created_at: date, updated_at: date }],
    variants: [{ id: id(n + 100), product_id: productId, sku: \`SKU-\${n + 100}\`, status,
      attributes: {}, moq_quantity: "100", moq_unit: "pieces", order_multiple: null,
      package_quantity: null, package_unit: null, reference_price: null,
      reference_currency: null, sort_order: 0, created_at: date, updated_at: date }],
    categoryLinks: [{ product_id: productId, category_id: id(n <= 3 ? 701 : 702),
      is_primary: true, sort_order: 0, created_at: date, updated_at: date },
      ...(n === 1 ? [{ product_id: productId, category_id: id(702),
        is_primary: false, sort_order: 1, created_at: date, updated_at: date }] : [])],
    categories: [701, 702].map((number) => ({ id: id(number), parent_id: null,
      slug: number === 701 ? "nails" : "care", status: "published" as const,
      name_en: number === 701 ? "Nails" : "Care", name_zh: number === 701 ? "美甲" : "护理",
      description_en: "", description_zh: "", sort_order: number,
      created_at: date, updated_at: date })),
    images: [{ id: id(n + 200), product_id: productId,
      variant_id: null, storage_key: "private/fixture.webp", public_url: "https://example.invalid/image.webp",
      role: "primary", status, sort_order: 0, width: null, height: null, format: "webp",
      alt_en: "", alt_zh: "", created_at: date, updated_at: date }] };
}
const sample = createOfflineCatalogSource([row(1, "draft"), row(2, "published"), row(3, "retired")]);
const querySample = createOfflineCatalogSource(Array.from({ length: 45 }, (_, index) =>
  row(index + 1, index % 3 === 0 ? "draft" : index % 3 === 1 ? "published" : "retired")));
const legacyOptions = { mode: "offline" as const, listAdmin: sample.listAdmin,
  getAdminByCode: sample.getAdminByCode, listPublished: sample.listPublished,
  getPublishedBySlug: sample.getPublishedBySlug };
const empty = createOfflineCatalogSource([]);
const failed = { mode: "offline" as const,
  async listAdmin(): Promise<never> { throw Error("postgres://secret.invalid"); },
  async getAdminByCode() { return null; },
  async listPublished() { return { rows: [], hasMore: false }; },
  async getPublishedBySlug() { return null; } };
export async function createServerCatalogReadRepository() {
  const cookieStore = await cookies();
  const role = cookieStore.get("admin-ui-fixture")?.value;
  const state = cookieStore.get("catalog-read-fixture")?.value;
  const source = state === "success" ? sample : state === "query" ? querySample :
    state === "legacy-options" ? legacyOptions : state === "empty" ? empty :
    state === "error" ? failed : notConfiguredCatalogSource;
  return createCatalogReadRepository(source, {
    session: role,
    dependencies: {
      provider: { async verifySession(session) {
        return session === "editor"
          ? { identity_provider: "fixture", provider_subject: session } : null;
      } },
      directory: { async findByProviderIdentity(identity) {
        return { admin_id: id(999), identity_provider: "fixture", provider_subject: identity.provider_subject,
          status: "active", created_at: date, disabled_at: null,
          permissions: state === "forbidden" ? [] : ["catalog.read"] };
      } },
    },
  }, createAdminCursorCodec(process.env.ADMIN_CATALOG_CURSOR_SIGNING_KEY ?? ""));
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

async function startFixture() {
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
  const panelPath = join(fixtureRoot, "src/components/admin/product-list-panel.tsx");
  const panelSource = readFileSync(panelPath, "utf8");
  if (!panelSource.includes("testData = false")) throw Error("Admin products fixture no longer matches the list panel");
  writeFileSync(panelPath, panelSource.replace("testData = false", "testData = true"));

  fixtureOrigin = `http://127.0.0.1:${await unusedPort()}`;
  fixtureServer = spawn(process.execPath, [join(dependencies, "next/dist/bin/next"), "dev", "--webpack",
    "--hostname", "127.0.0.1", "--port", new URL(fixtureOrigin).port], {
    cwd: fixtureRoot,
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      ADMIN_DIRECTORY_DATABASE_URL: "", DATABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
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
}

async function stopFixture() {
  if (fixtureServer && fixtureServer.exitCode === null) {
    fixtureServer.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => fixtureServer?.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (fixtureServer.exitCode === null) fixtureServer.kill("SIGKILL");
  }
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
}

test.beforeAll(async () => { await startFixture(); });
test.afterAll(async () => { await stopFixture(); });
test.setTimeout(120_000);

async function fixtureCookies(context: { addCookies: (cookies: { name: string; value: string; url: string }[]) => Promise<void> }, state?: string) {
  const cookies = [{ name: "admin-ui-fixture", value: "editor", url: fixtureOrigin }];
  if (state) cookies.push({ name: "catalog-read-fixture", value: state, url: fixtureOrigin });
  await context.addCookies(cookies);
}

test("isolated reader renders three statuses and a family-code detail link", async ({ page, context }) => {
  await fixtureCookies(context, "success");
  await page.goto(`${fixtureOrigin}/admin/products`);
  for (const heading of ["Product Code", "Product Name", "Product Type", "Status", "Primary Category", "Variants", "Updated At"])
    await expect(page.getByRole("columnheader", { name: heading })).toBeVisible();
  for (const status of ["draft", "published", "retired"])
    await expect(page.getByRole("cell").getByText(status, { exact: true })).toHaveCount(1);
  await expect(page.getByText("TEST DATA", { exact: true })).toBeVisible();
  const code = page.getByRole("link", { name: "FAMILY-1" });
  await expect(code).toHaveAttribute("href", "/admin/products/FAMILY-1");
  await expect(page.getByText("private/fixture.webp")).toHaveCount(0);
  await expect(page.getByText("SKU-101")).toHaveCount(0);
  await code.click();
  await expect(page).toHaveURL(/\/admin\/products\/FAMILY-1$/);
});

test("empty, source error and default disconnected states stay distinct", async ({ page, context }) => {
  await fixtureCookies(context, "empty");
  await page.goto(`${fixtureOrigin}/admin/products`);
  await expect(page.getByText("No Products", { exact: true })).toBeVisible();
  await context.addCookies([{ name: "catalog-read-fixture", value: "error", url: fixtureOrigin }]);
  await page.goto(`${fixtureOrigin}/admin/products`);
  await expect(page.getByText("Products unavailable")).toBeVisible();
  await expect(page.getByText("postgres://secret.invalid")).toHaveCount(0);
  await context.clearCookies();
  await fixtureCookies(context);
  await page.goto(`${fixtureOrigin}/admin/products?source=success&demo=1`);
  await expect(page.getByText("Product database not connected")).toBeVisible();
  await expect(page.getByText("TEST DATA", { exact: true })).toHaveCount(0);
});

test("a grant revoked after page entry follows the existing login denial", async ({ page, context }) => {
  await fixtureCookies(context, "forbidden");
  await page.goto(`${fixtureOrigin}/admin/products`);
  await expect(page).toHaveURL(/\/admin\/login\?error=1$/);
  await expect(page.getByText("FAMILY-1")).toHaveCount(0);
});

test("mobile table scrolls inside panel without document overflow", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile viewport only");
  await fixtureCookies(context, "success");
  await page.goto(`${fixtureOrigin}/admin/products`);
  await expect(page.getByRole("link", { name: "FAMILY-1" })).toBeVisible();
  expect(await page.evaluate(() => {
    const scroll = document.querySelector(".admin-table-scroll");
    return Boolean(scroll && scroll.scrollWidth > scroll.clientWidth && document.documentElement.scrollWidth <= window.innerWidth);
  })).toBe(true);
  await page.getByRole("button", { name: "Open admin menu" }).click();
  await expect(page.getByRole("dialog", { name: "Admin menu" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Admin menu" })).toBeHidden();
});

test("server query controls search, status, primary category and sorting", async ({ page, context }) => {
  await fixtureCookies(context, "query");
  await page.goto(`${fixtureOrigin}/admin/products`);
  await page.getByRole("searchbox", { name: "Search products" }).fill("  family-45  ");
  await page.getByRole("button", { name: "Apply Filters" }).click();
  await expect(page.getByRole("link", { name: "FAMILY-45" })).toBeVisible();
  await expect(page.getByRole("link", { name: "FAMILY-1", exact: true })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("q")?.trim()).toBe("family-45");

  await page.getByRole("link", { name: "Clear Filters" }).click();
  await page.getByLabel("Status", { exact: true }).selectOption("draft");
  await page.getByLabel("Primary category").selectOption("00000701-0000-4000-8000-000000000000");
  await page.getByRole("button", { name: "Apply Filters" }).click();
  await expect(page.getByRole("link", { name: "FAMILY-1", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "FAMILY-2", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "FAMILY-4", exact: true })).toHaveCount(0);

  await page.getByLabel("Primary category").selectOption("00000702-0000-4000-8000-000000000000");
  await page.getByRole("searchbox", { name: "Search products" }).fill("family-1");
  await page.getByRole("button", { name: "Apply Filters" }).click();
  await expect(page.getByRole("link", { name: "FAMILY-1", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "FAMILY-10", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Clear Filters" }).click();
  await page.getByLabel("Sort by").selectOption("product_code_desc");
  await page.getByRole("button", { name: "Apply Filters" }).click();
  await expect(page.locator(".admin-table tbody tr").first()).toContainText("FAMILY-9");
  await expect(page.getByText("TEST DATA", { exact: true })).toBeVisible();
});

test("cursor URLs survive refresh, back and forward; filters reset the page", async ({ page, context }) => {
  await fixtureCookies(context, "query");
  await page.goto(`${fixtureOrigin}/admin/products`);
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  const secondUrl = page.url();
  await expect(page.getByRole("link", { name: "FAMILY-21" })).toBeVisible();
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page.getByText("Page 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "FAMILY-41" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Next" })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(secondUrl);
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByText("Page 3", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Previous" }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("direction")).toBe("before");
  await page.reload();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await page.getByLabel("Status", { exact: true }).selectOption("published");
  await page.getByRole("button", { name: "Apply Filters" }).click();
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("cursor")).toBe(false);
});

test("tampered signed cursor shows a safe query error without product data", async ({ page, context }) => {
  await fixtureCookies(context, "query");
  await page.goto(`${fixtureOrigin}/admin/products`);
  const next = await page.getByRole("link", { name: "Next" }).getAttribute("href");
  expect(next).toBeTruthy();
  const url = new URL(next!, fixtureOrigin);
  const token = url.searchParams.get("cursor")!;
  const [payload, signature] = token.split(".");
  const fields = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  fields[5] = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  url.searchParams.set("cursor", `${Buffer.from(JSON.stringify(fields)).toString("base64url")}.${signature}`);
  await page.goto(url.toString());
  await expect(page.getByText("Invalid product query")).toBeVisible();
  await expect(page.getByRole("link", { name: "FAMILY-21" })).toHaveCount(0);
  url.searchParams.set("cursor", token);
  url.searchParams.set("direction", "before");
  url.searchParams.set("ADMIN_CATALOG_CURSOR_SIGNING_KEY", "attacker-value");
  await page.goto(url.toString());
  await expect(page.getByText("Invalid product query")).toBeVisible();
});

test("invalid query and unmatched filters show safe, distinct states", async ({ page, context }) => {
  await fixtureCookies(context, "query");
  await page.goto(`${fixtureOrigin}/admin/products?status=admin`);
  await expect(page.getByText("Invalid product query")).toBeVisible();
  await expect(page.getByRole("link", { name: "FAMILY-1" })).toHaveCount(0);
  await page.goto(`${fixtureOrigin}/admin/products?q=does-not-exist`);
  await expect(page.getByText("No Matching Products")).toBeVisible();
  await expect(page.getByText("No Products", { exact: true })).toHaveCount(0);
});

test("a legacy source without category options keeps the bounded list available", async ({ page, context }) => {
  await fixtureCookies(context, "legacy-options");
  await page.goto(`${fixtureOrigin}/admin/products`);
  await expect(page.getByRole("link", { name: "FAMILY-1" })).toBeVisible();
  await expect(page.getByText("Primary category options are not connected.")).toBeVisible();
  await expect(page.getByText("TEST DATA", { exact: true })).toBeVisible();
});

test("responsive filters preserve document width and mobile dialog focus", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile viewport only");
  await fixtureCookies(context, "query");
  await page.goto(`${fixtureOrigin}/admin/products`);
  await expect(page.getByRole("searchbox", { name: "Search products" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Open admin menu" }).click();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Admin menu" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Open admin menu" })).toBeFocused();
  await page.setViewportSize({ width: 768, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
