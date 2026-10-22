import { expect, test } from "@playwright/test";
import { fixtureCookies, fixtureOrigin, startAdminFixture, stopAdminFixture } from "./support/admin-site";

test.beforeAll(async () => { await startAdminFixture(); });
test.afterAll(async () => { await stopAdminFixture(); });
test.setTimeout(120_000);

test("Product Code opens a read-only detail with distinct Variant SKUs and DTO fields", async ({ page, context }) => {
  await fixtureCookies(context, "success");
  await page.goto(`${fixtureOrigin}/admin/products`);
  await page.getByRole("link", { name: "FAMILY-2" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/id\/00000002-0000-4000-8000-000000000000$/);
  await expect(page.getByRole("heading", { name: "Basic Information" })).toBeVisible();
  await expect(page.getByText("FAMILY-2", { exact: true })).toBeVisible();
  await expect(page.getByText("Family 2", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("家族 2", { exact: true })).toBeVisible();
  await expect(page.getByText("SKU-102", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("SKU-SECONDARY-" + "X".repeat(120), { exact: true }).first()).toBeVisible();
  await expect(page.getByText("color: red")).toBeVisible();
  await expect(page.getByText("Nails · nails")).toBeVisible();
  await expect(page.getByText("Care · care")).toBeVisible();
  await expect(page.getByText("Front view")).toBeVisible();
  await expect(page.getByText("Variant view")).toBeVisible();
  await expect(page.getByText("TEST DATA", { exact: true })).toBeVisible();
  for (const heading of ["Translations", "Categories", "Variants", "MOQ", "Reference Pricing", "Product Images", "SEO", "Publishing Status"])
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.getByText("private/fixture.webp")).toHaveCount(0);
  await expect(page.getByText("private/variant.webp")).toHaveCount(0);
  await expect(page.locator('img[src="https://example.invalid/image.webp"]')).toHaveCount(0);
  const rendered = await page.content();
  for (const privateValue of ["storageKey", "publicUrl", "private/fixture.webp", "private/variant.webp",
    "https://example.invalid/image.webp", "https://example.invalid/variant.webp"])
    expect(rendered).not.toContain(privateValue);
  await expect(page.getByRole("button", { name: "Edit local draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: /save|delete|publish|upload/i })).toHaveCount(0);
});

test("Unicode and slash Product Codes round-trip through the isolated detail route", async ({ page, context }) => {
  await fixtureCookies(context, "special");
  await page.goto(`${fixtureOrigin}/admin/products?status=published&sort=product_code_asc`);
  for (const code of ["CN-甲", "A/B", "A B", "A!"]) {
    await page.getByRole("link", { name: code, exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/products\/id\/[0-9a-f-]+/);
    await expect(page.getByText(code, { exact: true }).first()).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain("private/fixture.webp");
    expect(html).not.toContain("storageKey");
    await page.getByRole("link", { name: "Back to Products" }).click();
    await expect(page.getByLabel("Status", { exact: true })).toHaveValue("published");
    await expect(page.getByLabel("Sort by", { exact: true })).toHaveValue("product_code_asc");
  }
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await context.clearCookies();
  await page.goto(`${fixtureOrigin}/admin/products/by-code/${Buffer.from("A/B").toString("base64url")}`);
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
});

test("missing translation, absent price and missing product remain distinct", async ({ page, context }) => {
  await fixtureCookies(context, "success");
  await page.goto(`${fixtureOrigin}/admin/products/FAMILY-3`);
  await expect(page.getByText("Translation not available.")).toBeVisible();
  await expect(page.getByText("Tiered pricing: Not Available")).toBeVisible();
  await page.goto(`${fixtureOrigin}/admin/products/FAMILY-999`);
  await expect(page.getByText("Product not found")).toBeVisible();
  await expect(page.getByText("Product database not connected")).toHaveCount(0);
  await expect(page.getByText("TEST DATA", { exact: true })).toHaveCount(0);
});

test("disconnected, failed and forbidden detail reads reveal no product data", async ({ page, context }) => {
  await fixtureCookies(context);
  await page.goto(`${fixtureOrigin}/admin/products/FAMILY-2?source=success`);
  await expect(page.getByText("Product database not connected")).toBeVisible();
  await context.addCookies([{ name: "catalog-read-fixture", value: "error", url: fixtureOrigin }]);
  await page.goto(`${fixtureOrigin}/admin/products/FAMILY-2`);
  await expect(page.getByText("Products unavailable")).toBeVisible();
  await expect(page.getByText("postgres://secret.invalid")).toHaveCount(0);
  await context.addCookies([{ name: "catalog-read-fixture", value: "forbidden", url: fixtureOrigin }]);
  await page.goto(`${fixtureOrigin}/admin/products/FAMILY-2`);
  await expect(page).toHaveURL(/\/admin\/login\?error=1$/);
  await context.clearCookies();
  await page.goto(`${fixtureOrigin}/admin/products/FAMILY-2`);
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
});

test("Back to Products restores validated filters and cannot become an external redirect", async ({ page, context }) => {
  await fixtureCookies(context, "success");
  await page.goto(`${fixtureOrigin}/admin/products?status=published`);
  await page.getByRole("link", { name: "FAMILY-2" }).click();
  const back = page.getByRole("link", { name: "Back to Products" });
  await expect(back).toHaveAttribute("href", "/admin/products?status=published");
  await back.click();
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue("published");
  await page.goto(`${fixtureOrigin}/admin/products/FAMILY-2?returnTo=${encodeURIComponent("https://evil.invalid/path")}`);
  await expect(page.getByRole("link", { name: "Back to Products" })).toHaveAttribute("href", "/admin/products");
});

test("Back to Products restores a signed cursor page after detail navigation", async ({ page, context }) => {
  await fixtureCookies(context, "query");
  await page.goto(`${fixtureOrigin}/admin/products`);
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  const listUrl = page.url();
  await page.getByRole("link", { name: "FAMILY-21" }).click();
  await expect(page.getByRole("heading", { name: "Product detail" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Products" }).click();
  await expect(page).toHaveURL(listUrl);
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
});

test("detail layout stays within desktop, tablet and mobile viewports", async ({ page, context }) => {
  await fixtureCookies(context, "success");
  const response = await page.goto(`${fixtureOrigin}/admin/products/FAMILY-2`);
  const responseBody = await response!.text();
  for (const privateValue of ["storageKey", "publicUrl", "private/fixture.webp", "private/variant.webp",
    "https://example.invalid/image.webp", "https://example.invalid/variant.webp"])
    expect(responseBody).not.toContain(privateValue);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("heading", { name: "Product detail" })).toBeVisible();
    await expect(page.getByText("SKU-SECONDARY-" + "X".repeat(120), { exact: true }).first()).toBeVisible();
  }
  const back = page.getByRole("link", { name: "Back to Products" });
  await back.focus();
  await expect(back).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${fixtureOrigin}/admin/products`);
  await page.goto(`${fixtureOrigin}/admin/products/FAMILY-2`);
  await page.getByRole("button", { name: "Open admin menu" }).click();
  await expect(page.getByRole("dialog", { name: "Admin menu" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Admin menu" })).toBeHidden();
});
