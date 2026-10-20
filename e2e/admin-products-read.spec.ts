import { expect, test } from "@playwright/test";
import { fixtureCookies, fixtureOrigin, startAdminFixture, stopAdminFixture } from "./support/admin-site";

test.beforeAll(async () => { await startAdminFixture(); });
test.afterAll(async () => { await stopAdminFixture(); });
test.setTimeout(120_000);

test("isolated reader renders three statuses and a family-code detail link", async ({ page, context }) => {
  await fixtureCookies(context, "success");
  await page.goto(`${fixtureOrigin}/admin/products`);
  for (const heading of ["Product Code", "Product Name", "Product Type", "Status", "Primary Category", "Variants", "Updated At"])
    await expect(page.getByRole("columnheader", { name: heading })).toBeVisible();
  for (const status of ["draft", "published", "retired"])
    await expect(page.getByRole("cell").getByText(status, { exact: true })).toHaveCount(1);
  await expect(page.getByText("TEST DATA", { exact: true })).toBeVisible();
  const code = page.getByRole("link", { name: "FAMILY-1" });
  await expect(code).toHaveAttribute("href", "/admin/products/id/00000001-0000-4000-8000-000000000000");
  await expect(page.getByText("private/fixture.webp")).toHaveCount(0);
  await expect(page.getByText("SKU-101")).toHaveCount(0);
  await code.click();
  await expect(page).toHaveURL(/\/admin\/products\/id\/00000001-0000-4000-8000-000000000000$/);
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

test("English and Chinese names, each status and all four URL sorts reach the Repository", async ({ page, context }) => {
  await fixtureCookies(context, "query");
  for (const [query, code] of [["Family 12", "FAMILY-12"], ["家族 12", "FAMILY-12"]] as const) {
    await page.goto(`${fixtureOrigin}/admin/products?q=${encodeURIComponent(query)}`);
    await expect(page.getByRole("link", { name: code })).toBeVisible();
    await expect(page.getByRole("link", { name: "FAMILY-1", exact: true })).toHaveCount(0);
  }
  for (const [status, code] of [["draft", "FAMILY-1"], ["published", "FAMILY-2"],
    ["retired", "FAMILY-3"]] as const) {
    await page.goto(`${fixtureOrigin}/admin/products?status=${status}`);
    await expect(page.locator(".admin-table tbody tr").first()).toContainText(code);
    await expect(page.locator(".admin-table tbody tr").first()).toContainText(status);
  }
  for (const [sort, first] of [["updated_desc", "FAMILY-1"], ["updated_asc", "FAMILY-1"],
    ["product_code_asc", "FAMILY-1"], ["product_code_desc", "FAMILY-9"]] as const) {
    await page.goto(`${fixtureOrigin}/admin/products?sort=${sort}`);
    await expect(page.locator(".admin-table tbody tr").first()).toContainText(first);
  }
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
