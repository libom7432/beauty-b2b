import { test, expect } from "@playwright/test";
import { fixtureCookies, fixtureOrigin, startAdminFixture, stopAdminFixture } from "./support/admin-site";

test.beforeAll(async () => { await startAdminFixture(); });
test.afterAll(async () => { await stopAdminFixture(); });
test.setTimeout(120_000);

async function asFixture(context: { addCookies: (cookies: { name: string; value: string; url: string }[]) => Promise<void> }, role: string) {
  await fixtureCookies(context, undefined, role);
}

test("verified fixture sees navigation, active route and read-only Dashboard", async ({ page, context }, testInfo) => {
  await asFixture(context, "editor");
  await page.goto(`${fixtureOrigin}/admin`);
  if (testInfo.project.name === "mobile-chrome") await page.getByRole("button", { name: "Open admin menu" }).click();
  const nav = page.locator('nav[aria-label="Admin navigation"]:visible');
  await expect(nav.locator('a[href="/admin"]')).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Good to see you." })).toBeVisible();
  await expect(page.getByText("Verified")).toBeVisible();
  await expect(page.getByText("Not Connected").first()).toBeVisible();
  await nav.locator('a[href="/admin/products"]').click();
  await expect(page).toHaveURL(/\/admin\/products$/);
  if (testInfo.project.name === "mobile-chrome") await page.getByRole("button", { name: "Open admin menu" }).click();
  await expect(nav.locator('a[href="/admin/products"]')).toHaveAttribute("aria-current", "page");
});

test("Products default to an empty table and detail reveals no database record", async ({ page, context }) => {
  await asFixture(context, "editor");
  await page.goto(`${fixtureOrigin}/admin/products`);
  await expect(page.getByRole("columnheader", { name: "Product Code" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Variants" })).toBeVisible();
  await expect(page.getByText("Product database not connected")).toBeVisible();
  await expect(page.getByRole("button", { name: /add|edit|delete|publish/i })).toHaveCount(0);
  await page.goto(`${fixtureOrigin}/admin/products/TEST-001`);
  await expect(page.getByText("TEST-001")).toBeVisible();
  await expect(page.getByText("The requested code has not been looked up in a database.")).toBeVisible();
  for (const title of ["Basic Information", "Translations", "Categories", "Variants", "MOQ", "Tiered Pricing", "Product Images", "SEO", "Publishing Status"]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  await expect(page.getByText("No verified product record is connected.")).toBeVisible();
});

test("fixture with no catalog grant cannot view products or see catalog navigation", async ({ page, context }, testInfo) => {
  await asFixture(context, "dashboard");
  await page.goto(`${fixtureOrigin}/admin`);
  if (testInfo.project.name === "mobile-chrome") await page.getByRole("button", { name: "Open admin menu" }).click();
  await expect(page.locator('nav[aria-label="Admin navigation"]:visible a[href="/admin/products"]')).toHaveCount(0);
  await page.goto(`${fixtureOrigin}/admin/products`);
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
});

test("placeholder navigation stays read only", async ({ page, context }, testInfo) => {
  await asFixture(context, "editor");
  for (const [path, title] of [["/admin/categories", "Categories"], ["/admin/collections", "Collections"],
    ["/admin/media", "Media"], ["/admin/imports", "Imports"]] as const) {
    await page.goto(`${fixtureOrigin}${path}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText("NO WRITE ACTIONS")).toBeVisible();
    if (testInfo.project.name === "mobile-chrome") await page.getByRole("button", { name: "Open admin menu" }).click();
    await expect(page.locator(`nav[aria-label="Admin navigation"]:visible a[href="${path}"]`)).toHaveAttribute("aria-current", "page");
  }
});

test("catalog reader without receipt permission cannot open Imports", async ({ page, context }, testInfo) => {
  await asFixture(context, "catalog-only");
  await page.goto(`${fixtureOrigin}/admin`);
  if (testInfo.project.name === "mobile-chrome") await page.getByRole("button", { name: "Open admin menu" }).click();
  const nav = page.locator('nav[aria-label="Admin navigation"]:visible');
  await expect(nav.locator('a[href="/admin/products"]')).toHaveCount(1);
  await expect(nav.locator('a[href="/admin/imports"]')).toHaveCount(0);
  await page.goto(`${fixtureOrigin}/admin/imports`);
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
});

test("mobile dialog traps forward and reverse keyboard focus and isolates the background", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile viewport only");
  await asFixture(context, "editor");
  await page.goto(`${fixtureOrigin}/admin/products`);
  const trigger = page.getByRole("button", { name: "Open admin menu" });
  const dialog = page.getByRole("dialog", { name: "Admin menu" });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Close menu" })).toBeFocused();
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("#admin-mobile-dialog") !== null)).toBe(true);
  }
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("#admin-mobile-dialog") !== null)).toBe(true);
  }
  expect(await page.evaluate(() => {
    const content = document.querySelector("#admin-content");
    const point = { x: window.innerWidth - 15, y: Math.floor(window.innerHeight / 2) };
    return content?.contains(document.elementFromPoint(point.x, point.y));
  })).toBe(false);
  await expect(page).toHaveURL(/\/admin\/products$/);
});

test("Escape, backdrop and close button restore focus and page operation", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile viewport only");
  await asFixture(context, "editor");
  await page.goto(`${fixtureOrigin}/admin/products`);
  const trigger = page.getByRole("button", { name: "Open admin menu" });
  const dialog = page.getByRole("dialog", { name: "Admin menu" });
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  // The click lands above the background Sign out control, on the modal backdrop.
  await page.mouse.click(370, 35);
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/admin\/products$/);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "Close menu" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

test("navigation, browser history and viewport changes close the mobile dialog", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile viewport only");
  await asFixture(context, "editor");
  await page.goto(`${fixtureOrigin}/admin`);
  const trigger = page.getByRole("button", { name: "Open admin menu" });
  const dialog = page.getByRole("dialog", { name: "Admin menu" });
  await trigger.click();
  await dialog.getByRole("navigation", { name: "Admin navigation" }).getByRole("link", { name: /Products/ }).click();
  await expect(page).toHaveURL(/\/admin\/products$/);
  await expect(dialog).toBeHidden();
  await trigger.click();
  await page.goBack();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(dialog).toBeHidden();
  await trigger.click();
  await page.goForward();
  await expect(page).toHaveURL(/\/admin\/products$/);
  await expect(dialog).toBeHidden();
  await trigger.click();
  await page.setViewportSize({ width: 851, height: 768 });
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("complementary", { name: "Admin sidebar" })).toBeVisible();
  await page.setViewportSize({ width: 850, height: 768 });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(dialog).toBeHidden();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 600, height: 768 });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole("complementary", { name: "Admin sidebar" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("desktop sidebar remains usable without a modal dialog", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop viewport only");
  await asFixture(context, "editor");
  await page.goto(`${fixtureOrigin}/admin`);
  const sidebar = page.getByRole("complementary", { name: "Admin sidebar" });
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Admin menu" })).toBeHidden();
  await sidebar.getByRole("link", { name: /Products/ }).click();
  await expect(page).toHaveURL(/\/admin\/products$/);
  await expect(sidebar).toBeVisible();
});
