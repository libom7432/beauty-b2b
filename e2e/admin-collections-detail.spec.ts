import { test, expect } from "@playwright/test";
import { fixtureCookies, fixtureOrigin, startAdminFixture, stopAdminFixture } from "./support/admin-site";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const detailUrl = (n: number) => `${fixtureOrigin}/admin/collections/${id(n)}`;

test.beforeAll(async () => { await startAdminFixture(); });
test.afterAll(async () => { await stopAdminFixture(); });
test.setTimeout(120_000);

test("detail requires catalog.read and invalid UUID never reveals collection data", async ({ page, context }) => {
  await page.goto(detailUrl(1));
  await expect(page).toHaveURL(/\/admin\/login/);
  await fixtureCookies(context, "collections", "dashboard");
  await page.goto(detailUrl(1));
  await expect(page).toHaveURL(/\/admin\/login/);
  await fixtureCookies(context, "collections");
  await page.goto(`${fixtureOrigin}/admin/collections/not-a-uuid`);
  await expect(page.getByText("This page could not be found")).toBeVisible();
  await expect(page.getByText("Collection 1")).toHaveCount(0);
  await expect(page.locator(".admin-topbar-title")).toHaveCount(0);
  await page.goto(`${detailUrl(1)}/extra`);
  await expect(page.getByText("This page could not be found")).toBeVisible();
  await expect(page.locator(".admin-topbar-title")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Collections" })).toHaveCount(0);
});

test("list link opens a read-only detail and fixed return link preserves safe fields", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${fixtureOrigin}/admin/collections`);
  await expect(page.locator(".admin-topbar-title")).toHaveText("Collections");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).locator('[aria-current="page"]')).toHaveText("Collections");
  const list = page.getByRole("region", { name: "Collection list" });
  const link = list.getByRole("link", { name: "Open full details for Collection 1", exact: true });
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/admin/collections/${id(1)}$`));
  await expect(page.locator(".admin-topbar-title")).toHaveText("Collection detail");
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.getByRole("link", { name: "Collections" })).toHaveAttribute("href", "/admin/collections");
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText("Detail");
  const detail = page.getByRole("region", { name: "Collection detail information" });
  for (const text of [id(1), "collection-1", "Collection 1", "集合 1", "2026-09-01T00:00:00.000Z",
    "2026-10-01T00:00:00.000Z", "Not provided", "Not published", "TEST DATA"])
    await expect(detail.getByText(text, { exact: true }).first()).toBeVisible();
  await expect(detail.getByRole("region", { name: "Associated products" })).toBeVisible();
  await expect(detail.getByText("FAMILY-101")).toBeVisible();
  await expect(detail.getByText("draft", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("private://collections-secret")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /save|create|delete|publish/i })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to Collections" }).click();
  await expect(page).toHaveURL(/\/admin\/collections$/);
  await expect(list.getByText("Collection 1", { exact: true })).toBeVisible();
});

test("filtered list, detail, browser history and refresh keep their own URL state", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${fixtureOrigin}/admin/collections?status=published`);
  const list = page.getByRole("region", { name: "Collection list" });
  await expect(list.getByText("Collection 2", { exact: true })).toBeVisible();
  await list.getByRole("link", { name: "Open full details for Collection 2", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/collections/${id(2)}$`));
  await expect(page.getByText("Draft Product", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/collections\?status=published$/);
  await expect(list.getByText("Collection 2", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/admin/collections/${id(2)}$`));
  await page.reload();
  await expect(page.getByText("Draft Product", { exact: true })).toBeVisible();
  const breadcrumbLink = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Collections" });
  await breadcrumbLink.focus();
  await expect(breadcrumbLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/collections$/);
});

test("published and retired details show their real status; empty member page is distinct", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(2));
  await expect(page.getByRole("region", { name: "Collection detail information" }).getByText("published", { exact: true })).toBeVisible();
  await expect(page.getByText("Draft Product", { exact: true })).toBeVisible();
  await page.goto(detailUrl(3));
  await expect(page.getByText("retired", { exact: true })).toBeVisible();
  await expect(page.getByText("No associated products on this page.")).toBeVisible();
});

test("not connected, not found, source error and incomplete detail never become an empty collection", async ({ page, context }) => {
  await fixtureCookies(context);
  await page.goto(detailUrl(1));
  await expect(page.getByText("Collections database not connected")).toBeVisible();
  await expect(page.getByText("Collection not found")).toHaveCount(0);
  for (const [fixture, title] of [["collections", "Collection not found"],
    ["collections-detail-error", "Collection unavailable"],
    ["collections-detail-incomplete", "Collection detail incomplete"],
    ["collections-detail-not-found", "Collection not found"]]) {
    await fixtureCookies(context, fixture);
    await page.goto(detailUrl(fixture === "collections" ? 999 : 1));
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("region", { name: "Associated products" })).toHaveCount(0);
    await expect(page.getByText("private://collections-secret")).toHaveCount(0);
  }
});

test("member errors and incomplete pages preserve successfully read collection information", async ({ page, context }) => {
  for (const [fixture, title] of [["collections-members-error", "Members unavailable"],
    ["collections-members-incomplete", "Member data incomplete"],
    ["collections-members-not-found", "Member collection unavailable"],
    ["collections-members-empty", "No associated products on this page."]]) {
    await fixtureCookies(context, fixture);
    await page.goto(detailUrl(1));
    await expect(page.getByText("Collection 1", { exact: true })).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByText("private://collections-secret")).toHaveCount(0);
  }
});

test("signed member cursors page forward and backward and reject another collection", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const products = page.getByRole("region", { name: "Associated products" });
  await expect(products.getByRole("row")).toHaveCount(26);
  await expect(products.getByText("FAMILY-101")).toBeVisible();
  const next = products.getByRole("navigation", { name: "Collection member pages" }).getByRole("link", { name: "Next" });
  const issuedHref = await next.getAttribute("href");
  expect(issuedHref).toMatch(/cursor=/);
  await next.click();
  await expect(products.getByText("FAMILY-126")).toBeVisible();
  await expect(products.getByText("FAMILY-101")).toHaveCount(0);
  await products.getByRole("link", { name: "Previous" }).click();
  await expect(products.getByText("FAMILY-101")).toBeVisible();
  await page.goto(`${fixtureOrigin}${issuedHref?.replace(id(1), id(2))}`);
  await expect(page.getByText("Invalid member cursor")).toBeVisible();
  await expect(page.getByText("Collection 2", { exact: true })).toBeVisible();
  await expect(page.getByText("FAMILY-202")).toHaveCount(0);
});

test("empty member page recovers and malformed cursor keeps detail but hides members", async ({ page, context }) => {
  await fixtureCookies(context, "collections-members-empty-page");
  await page.goto(detailUrl(1));
  const products = page.getByRole("region", { name: "Associated products" });
  await products.getByRole("link", { name: "Next" }).click();
  await expect(page.getByText("No members beyond this cursor")).toBeVisible();
  await products.getByRole("link", { name: "Previous" }).click();
  await expect(products.getByText("FAMILY-101")).toBeVisible();
  await page.goto(`${detailUrl(1)}?cursor=invalid`);
  await expect(page.getByText("Invalid member cursor")).toBeVisible();
  await expect(page.getByText("Collection 1", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "First member page" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/collections/${id(1)}$`));
});

test("long names, slug and product code wrap on a mobile viewport", async ({ page, context }) => {
  await fixtureCookies(context, "collections-long");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(detailUrl(1));
  await expect(page.locator(".admin-topbar-title")).toHaveText("Collection detail");
  await expect(page.getByText(/long-a{100}/)).toBeVisible();
  await expect(page.getByText(/CODE-X{100}/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const table = page.locator(".admin-table-scroll");
  expect(await table.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
});
