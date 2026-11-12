import { test, expect } from "@playwright/test";
import { fixtureCookies, fixtureOrigin, startAdminFixture, stopAdminFixture } from "./support/admin-site";

test.beforeAll(async () => { await startAdminFixture(); });
test.afterAll(async () => { await stopAdminFixture(); });
test.setTimeout(120_000);

test("read-only hierarchy sorts, expands, selects and searches both languages", async ({ page, context }) => {
  await fixtureCookies(context, "category");
  await page.goto(`${fixtureOrigin}/admin/categories`);
  await expect(page.getByText("LOCAL DEMO / NOT CONNECTED", { exact: true })).toBeVisible();
  await expect(page.getByText("Isolated offline test data")).toBeVisible();
  const hierarchy = page.getByRole("region", { name: "Category hierarchy" });
  const roots = hierarchy.locator(":scope > ul.admin-category-branches > li > .admin-category-row .admin-category-select");
  await expect(roots).toHaveText(["Care", "Nails"]);
  await hierarchy.getByRole("button", { name: "Collapse Nails" }).click();
  await expect(hierarchy.getByRole("button", { name: "Press On", exact: true })).toHaveCount(0);
  await hierarchy.getByRole("button", { name: "Expand Nails" }).click();
  await hierarchy.getByRole("button", { name: "Press On", exact: true }).click();
  const detail = page.getByRole("region", { name: "Category detail" });
  await expect(detail.locator("dd").filter({ hasText: "English description" })).toBeVisible();
  await expect(detail.getByText("Nails / Press On")).toBeVisible();
  await hierarchy.getByRole("textbox", { name: "Search categories" }).fill("杏仁");
  await expect(hierarchy.getByRole("button", { name: "Nails / Press On / Almond" })).toBeVisible();
  await hierarchy.getByRole("textbox", { name: "Search categories" }).fill("almond");
  await expect(hierarchy.getByRole("button", { name: "Nails / Press On / Almond" })).toBeVisible();
  await hierarchy.getByRole("textbox", { name: "Search categories" }).fill("press-on");
  await expect(hierarchy.getByRole("button", { name: "Nails / Press On" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Category diagnostics" })).toBeVisible();
  await expect(page.getByText(/exceeds the three-level business target/)).toBeVisible();
  await expect(page.getByRole("button", { name: /save|delete|publish|upload/i })).toHaveCount(0);
});

test("empty, disconnected and source failure are distinct", async ({ page, context }) => {
  await fixtureCookies(context, "category-empty");
  await page.goto(`${fixtureOrigin}/admin/categories`);
  await expect(page.getByRole("heading", { name: "No categories" })).toBeVisible();
  await context.clearCookies();
  await fixtureCookies(context);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Category database not connected" })).toBeVisible();
  await fixtureCookies(context, "category-error");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Categories unavailable" })).toBeVisible();
  await expect(page.getByText("private://category-secret")).toHaveCount(0);
});

test("incomplete and malformed hierarchies show diagnostics", async ({ page, context }) => {
  for (const [state, message] of [
    ["category-incomplete", "Parent category is missing"],
    ["category-cycle", "Category ancestry contains a cycle"],
    ["category-duplicate", "Duplicate category UUID"],
    ["category-truncated", "Category set is truncated"],
  ]) {
    await fixtureCookies(context, state);
    await page.goto(`${fixtureOrigin}/admin/categories`);
    await expect(page.getByText(/Category data is incomplete/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Category diagnostics" }).getByText(message, { exact: false }).first()).toBeVisible();
  }
});

test("the 501st category is only a truncation probe, not a tree or search result", async ({ page, context }) => {
  await fixtureCookies(context, "category-truncated");
  await page.goto(`${fixtureOrigin}/admin/categories`);
  const hierarchy = page.getByRole("region", { name: "Category hierarchy" });
  await expect(hierarchy.locator(":scope > ul.admin-category-branches > li")).toHaveCount(500);
  await expect(page.getByText(/Category data is incomplete/)).toBeVisible();
  await expect(hierarchy.getByRole("button", { name: "Category 500", exact: true })).toHaveCount(0);
  await hierarchy.getByRole("textbox", { name: "Search categories" }).fill("cat-500");
  await expect(hierarchy.getByRole("button", { name: "Category 500", exact: true })).toHaveCount(0);
  await expect(hierarchy.getByText("No matching categories in the loaded set.")).toBeVisible();

  await fixtureCookies(context, "category-truncated-parent");
  await page.reload();
  await expect(hierarchy.locator(":scope > ul.admin-category-branches > li")).toHaveCount(499);
  await expect(page.getByRole("region", { name: "Category diagnostics" })
    .getByText(/Parent category is missing/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Category diagnostics" })
    .getByText(/Category set is truncated/)).toBeVisible();
});

test("anonymous and unauthorized users cannot access category data", async ({ page, context }) => {
  await page.goto(`${fixtureOrigin}/admin/categories`);
  await expect(page).toHaveURL(/\/admin\/login/);
  await fixtureCookies(context, "category", "dashboard");
  await page.goto(`${fixtureOrigin}/admin/categories`);
  await expect(page).toHaveURL(/\/admin\/login/);
  await fixtureCookies(context, "forbidden", "editor");
  await page.goto(`${fixtureOrigin}/admin/categories`);
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("local category draft survives search and cancelled selection, then discards without persistence", async ({ page, context }) => {
  await fixtureCookies(context, "category");
  await page.goto(`${fixtureOrigin}/admin/categories`);
  const hierarchy = page.getByRole("region", { name: "Category hierarchy" });
  await hierarchy.getByRole("button", { name: "Nails", exact: true }).click();
  const editor = page.getByRole("region", { name: "Local category editor" });
  await expect(editor.getByText("No local changes")).toBeVisible();
  await expect(page.getByRole("region", { name: "Category detail" })).toContainText("00000710-0000-4000-8000-000000000000");
  await editor.getByLabel("English name").fill("Unsaved name");
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  await expect(hierarchy.getByRole("button", { name: "Nails", exact: true })).toBeVisible();
  await hierarchy.getByRole("textbox", { name: "Search categories" }).fill("care");
  await expect(editor.getByLabel("English name")).toHaveValue("Unsaved name");
  page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.dismiss(); });
  await hierarchy.getByRole("button", { name: "Care", exact: true }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Unsaved name");
  page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.accept(); });
  await hierarchy.getByRole("button", { name: "Care", exact: true }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Care");
  await editor.getByLabel("Sort order").fill("2147483648");
  await editor.getByRole("button", { name: "Check draft" }).click();
  await expect(editor.locator('[data-field-path="sort_order"]')).toContainText("INVALID_SORT_ORDER");
  await editor.getByRole("button", { name: "Discard changes" }).click();
  await expect(editor.getByLabel("Sort order")).toHaveValue("1");
  await expect(editor.getByText("No local changes")).toBeVisible();
  await expect(editor.getByRole("button", { name: /save|delete|publish|upload/i })).toHaveCount(0);
  await page.reload();
  await hierarchy.getByRole("button", { name: "Care", exact: true }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Care");
});

test("category status impact, navigation warning and access remain isolated", async ({ page, context }) => {
  await fixtureCookies(context, "category");
  await page.goto(`${fixtureOrigin}/admin/categories`);
  const hierarchy = page.getByRole("region", { name: "Category hierarchy" });
  await hierarchy.getByRole("button", { name: "Nails", exact: true }).click();
  const editor = page.getByRole("region", { name: "Local category editor" });
  await editor.getByLabel("Category status").selectOption("retired");
  await editor.getByRole("button", { name: "Check draft" }).click();
  await expect(editor.locator('[data-field-path="status"]')).toContainText("PUBLISHED_CHILD_CATEGORY");
  await expect(editor.getByText(/Published product associations are unavailable/)).toBeVisible();
  const mobileMenu = page.getByRole("button", { name: "Open admin menu" });
  const isMobile = await mobileMenu.isVisible();
  if (isMobile) await mobileMenu.click();
  const navigation = isMobile ? page.getByRole("dialog", { name: "Admin menu" }) :
    page.getByRole("complementary", { name: "Admin sidebar" });
  await navigation.getByRole("link", { name: "Products", exact: true }).click();
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: /Stay and keep editing/ }).click();
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("beforeunload"); await dialog.accept(); });
  await page.reload();
  await hierarchy.getByRole("button", { name: "Nails", exact: true }).click();
  await expect(editor.getByLabel("Category status")).toHaveValue("published");
  const content = await page.content();
  expect(content).not.toContain("storage_key");
  expect(content).not.toContain("private://category-secret");
});
