import { test, expect } from "@playwright/test";
import { fixtureCookies, fixtureOrigin, startAdminFixture, stopAdminFixture } from "./support/admin-site";

test.beforeAll(async () => { await startAdminFixture(); });
test.afterAll(async () => { await stopAdminFixture(); });
test.setTimeout(120_000);

test("default source is disconnected and unauthorized visitors see no collections", async ({ page, context }) => {
  await page.goto(`${fixtureOrigin}/admin/collections`);
  await expect(page).toHaveURL(/\/admin\/login/);
  await fixtureCookies(context);
  await page.goto(`${fixtureOrigin}/admin/collections`);
  await expect(page.getByRole("heading", { name: "Collections database not connected" })).toBeVisible();
  await expect(page.getByText("Collections 数据源尚未连接，当前无法读取真实集合数据。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No collections" })).toHaveCount(0);
  await expect(page.getByText("Collection 1")).toHaveCount(0);
  await fixtureCookies(context, "collections", "dashboard");
  await page.goto(`${fixtureOrigin}/admin/collections`);
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("isolated list shows safe rows, statuses and keyboard-accessible inline details", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${fixtureOrigin}/admin/collections`);
  await expect(page.getByRole("heading", { name: "Collections", exact: true })).toBeVisible();
  await expect(page.getByText("TEST DATA")).toBeVisible();
  const list = page.getByRole("region", { name: "Collection list" });
  await expect(list.getByRole("row")).toHaveCount(26);
  await expect(list.getByText("Collection 1", { exact: true })).toBeVisible();
  await expect(list.locator("tbody tr").first().locator("td").first()).toContainText("集合 1");
  await expect(list.getByText("collection-1", { exact: true })).toBeVisible();
  await expect(list.getByText(/Name and Slug search is unavailable/)).toBeVisible();
  await expect(list.getByRole("searchbox")).toHaveCount(0);
  const details = list.getByText("View details for Collection 1", { exact: true });
  await details.focus();
  await expect(details).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(list.getByText("00000001-0000-4000-8000-000000000000")).toBeVisible();
  await expect(list.getByText("private://collections-secret")).toHaveCount(0);
  await expect(list.getByRole("button", { name: /save|create|delete|publish/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("status filter resets pagination and signed Next/Previous work", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${fixtureOrigin}/admin/collections`);
  const pages = page.getByRole("navigation", { name: "Collection pages" });
  await pages.getByRole("link", { name: "Next" }).click();
  await expect(page.getByText("Collection 26", { exact: true })).toBeVisible();
  await expect(page.getByText("Collection 1", { exact: true })).toHaveCount(0);
  await pages.getByRole("link", { name: "Previous" }).click();
  await expect(page.getByText("Collection 1", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Collection status" }).selectOption("published");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page).toHaveURL(/status=published/);
  await expect(page).not.toHaveURL(/cursor=/);
  await expect(page.getByText("Collection 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Collection 1", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/admin\/collections$/);
  await expect(page.getByText("Collection 1", { exact: true })).toBeVisible();
  await page.goto(`${fixtureOrigin}/admin/collections?status=retired`);
  await expect(page.getByText("Collection 3", { exact: true })).toBeVisible();
});

test("tablet keeps controls usable while the wide table scrolls within its panel", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto(`${fixtureOrigin}/admin/collections`);
  await expect(page.getByRole("combobox", { name: "Collection status" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Collection pages" }).getByRole("link", { name: "Next" })).toBeVisible();
  const sizes = await page.locator(".admin-table-scroll").evaluate((node) => ({
    scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
  }));
  expect(sizes.scrollWidth).toBeGreaterThan(sizes.clientWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("error, incomplete, empty, invalid cursor and empty-page recovery stay distinct", async ({ page, context }) => {
  for (const [fixture, heading] of [
    ["collections-error", "Collections unavailable"],
    ["collections-incomplete", "Collection data incomplete"],
    ["collections-empty", "No collections"],
  ]) {
    await fixtureCookies(context, fixture);
    await page.goto(`${fixtureOrigin}/admin/collections`);
    if (fixture === "collections-empty") await expect(page.getByText(heading, { exact: true })).toBeVisible();
    else await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(page.getByText("private://collections-secret")).toHaveCount(0);
  await fixtureCookies(context, "collections");
  await page.goto(`${fixtureOrigin}/admin/collections?cursor=invalid`);
  await expect(page.getByRole("heading", { name: "Invalid collection query" })).toBeVisible();
  await expect(page.getByText("Collection 1", { exact: true })).toHaveCount(0);
  await page.goto(`${fixtureOrigin}/admin/collections`);
  const next = await page.getByRole("navigation", { name: "Collection pages" }).getByRole("link", { name: "Next" }).getAttribute("href");
  expect(next).toBeTruthy();
  await fixtureCookies(context, "collections-empty-page");
  await page.goto(`${fixtureOrigin}${next}`);
  await expect(page.getByRole("heading", { name: "No records beyond this cursor" })).toBeVisible();
  await page.getByRole("navigation", { name: "Collection pages" }).getByRole("link", { name: "Previous" }).click();
  await expect(page.getByText("Collection 25", { exact: true })).toBeVisible();
});
