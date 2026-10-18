import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
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
      created_at: date, updated_at: date }],
    variants: [{ id: id(n + 100), product_id: productId, sku: \`SKU-\${n + 100}\`, status,
      attributes: {}, moq_quantity: "100", moq_unit: "pieces", order_multiple: null,
      package_quantity: null, package_unit: null, reference_price: null,
      reference_currency: null, sort_order: 0, created_at: date, updated_at: date }],
    categoryLinks: [], categories: [], images: [{ id: id(n + 200), product_id: productId,
      variant_id: null, storage_key: "private/fixture.webp", public_url: "https://example.invalid/image.webp",
      role: "primary", status, sort_order: 0, width: null, height: null, format: "webp",
      alt_en: "", alt_zh: "", created_at: date, updated_at: date }] };
}
const sample = createOfflineCatalogSource([row(1, "draft"), row(2, "published"), row(3, "retired")]);
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
  const source = state === "success" ? sample : state === "empty" ? empty :
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
  });
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
  const pagePath = join(fixtureRoot, "src/app/admin/(workspace)/products/page.tsx");
  const pageSource = readFileSync(pagePath, "utf8");
  const original = "hasNextPage={result.kind === \"success\" && result.hasNextPage} />";
  if (!pageSource.includes(original)) throw Error("Admin products fixture no longer matches the production page");
  writeFileSync(pagePath, pageSource.replace(original, 'hasNextPage={result.kind === "success" && result.hasNextPage} testData={result.kind === "success"} />'));

  fixtureOrigin = `http://127.0.0.1:${await unusedPort()}`;
  fixtureServer = spawn(process.execPath, [join(dependencies, "next/dist/bin/next"), "dev", "--webpack",
    "--hostname", "127.0.0.1", "--port", new URL(fixtureOrigin).port], {
    cwd: fixtureRoot,
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      ADMIN_DIRECTORY_DATABASE_URL: "", DATABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
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
