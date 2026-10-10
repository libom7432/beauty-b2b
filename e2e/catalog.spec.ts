import { expect, test } from "@playwright/test";

const categoryPath = "/products/press-on-nails";

test("home and catalog category load", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Professional Nail Products");
  await expect(page.locator(".category-card-v3")).toHaveCount(6);

  await page.goto(categoryPath);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Press-On Nails");
  await expect(page.locator(".product-card-listing")).toHaveCount(5);
});

test("autocomplete previews products and opens a detail page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Search products" }).click();
  const search = page.getByRole("combobox", { name: "Search products" });
  await search.fill("al");
  await expect(page.getByRole("listbox", { name: "Product suggestions" })).toBeVisible();
  await expect(page.locator('.search-suggestion-all[href="/search?q=al"]')).toBeVisible();
  expect(await page.locator(".search-suggestion-item").count()).toBeLessThanOrEqual(5);

  await search.fill("DEMO-PO-001-N");
  const suggestion = page.locator('.search-suggestion-item[href="/product/almond-press-on-concept"]');
  await expect(suggestion).toContainText("DEMO-PO-001-N");
  await suggestion.click();
  await expect(page).toHaveURL(/\/product\/almond-press-on-concept$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Almond Press-On Concept");
});

test("desktop filter updates URL without resetting scroll", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop sidebar test");
  await page.goto(categoryPath);
  const almond = page.locator('.catalog-filters-desktop .filter-option[href*="shape=almond"]');
  await almond.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(100);

  await almond.click();
  await expect(page).toHaveURL(/\/products\/press-on-nails\?shape=almond$/);
  await expect(page.locator(".product-listing-toolbar h2")).toContainText("1 product");
  const position = await page.evaluate(() => ({ y: window.scrollY, max: document.documentElement.scrollHeight - window.innerHeight }));
  expect(Math.abs(position.y - Math.min(before, position.max))).toBeLessThan(120);
});

test("sorting changes product order and browser history restores URL state", async ({ page }) => {
  await page.goto(categoryPath);
  await page.locator(".product-sort-select select").selectOption("name-asc");
  await expect(page).toHaveURL(/\/products\/press-on-nails\?sort=name-asc$/);
  const names = await page.locator(".product-card-listing h3").allTextContents();
  const collator = new Intl.Collator("en", { sensitivity: "base" });
  expect(names).toEqual([...names].sort(collator.compare));

  await page.goBack();
  await expect(page).toHaveURL(/\/products\/press-on-nails$/);
  await expect(page.locator(".product-sort-select select")).toHaveValue("featured");
  await page.goForward();
  await expect(page).toHaveURL(/\/products\/press-on-nails\?sort=name-asc$/);
  await expect(page.locator(".product-sort-select select")).toHaveValue("name-asc");
});

test("filter and sort preserve one another in the URL", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop sidebar test");
  await page.goto(categoryPath);
  await page.locator('.catalog-filters-desktop .filter-option[href*="shape=almond"]').click();
  await expect(page).toHaveURL(/\?shape=almond$/);
  await page.locator(".product-sort-select select").selectOption("name-asc");
  await expect(page).toHaveURL(/\?shape=almond&sort=name-asc$/);
});

test("mobile filter drawer opens, closes, and applies a filter", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile drawer test");
  await page.goto(categoryPath);
  const dialog = page.getByRole("dialog", { name: /Filter products/ });
  await page.getByRole("button", { name: "Filter products" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close filters" }).click();
  await expect(dialog).not.toBeVisible();

  await page.getByRole("button", { name: "Filter products" }).click();
  const before = await page.evaluate(() => window.scrollY);
  await dialog.locator('.filter-option[href*="shape=almond"]').click();
  await expect(page).toHaveURL(/\?shape=almond$/);
  await expect(dialog).not.toBeVisible();
  const position = await page.evaluate(() => ({ y: window.scrollY, max: document.documentElement.scrollHeight - window.innerHeight }));
  expect(Math.abs(position.y - Math.min(before, position.max))).toBeLessThan(120);

  await page.locator(".product-sort-select select").selectOption("name-asc");
  await expect(page).toHaveURL(/\?shape=almond&sort=name-asc$/);
  await page.locator(".catalog-filter-trigger").click();
  await dialog.locator(".filter-panel-head a").click();
  await expect(page).toHaveURL(/\?sort=name-asc$/);
  await expect(dialog).not.toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\?shape=almond&sort=name-asc$/);
  await page.goForward();
  await expect(page).toHaveURL(/\?sort=name-asc$/);

  await page.locator(".catalog-filter-trigger").click();
  await dialog.locator('.filter-category-depth-2[href="/products/press-on-nails/shapes"]').click();
  await expect(page).toHaveURL(/\/products\/press-on-nails\/shapes$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Shapes");
});

test("English and Chinese catalog routes load", async ({ page }) => {
  await page.goto("/zh");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("专业美甲产品");
  await page.goto("/zh/products/press-on-nails");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("穿戴甲");
  await expect(page.locator(".product-card-listing")).toHaveCount(5);
});
