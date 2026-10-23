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

test("browser-only basic draft validates fields, reverts cleanly and never writes", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(detailUrl(1));
  const editor = page.getByRole("region", { name: "Local collection basic editor" });
  await expect(editor).toContainText("LOCAL DEMO / NOT CONNECTED");
  await expect(editor.getByText("No local changes")).toBeVisible();
  await editor.getByRole("button", { name: "Edit local draft" }).click();
  await expect(editor.getByLabel("Slug")).toHaveValue("collection-1");
  await expect(editor.getByLabel("Collection UUID")).toHaveCount(0);
  await editor.getByLabel("English name").fill("");
  await editor.getByLabel("Status").selectOption("published");
  await editor.getByRole("button", { name: "Check draft" }).click();
  await expect(editor.getByText("Local fields: INVALID")).toBeVisible();
  await expect(editor.getByText("Full database and publication checks: INVALID")).toBeVisible();
  await expect(editor.getByText(/name_en: REQUIRED_FOR_PUBLICATION/)).toBeVisible();
  await editor.getByLabel("English name").fill("Local only");
  await editor.getByRole("button", { name: "Check draft" }).click();
  await expect(editor.getByText("Local fields: VALID")).toBeVisible();
  await expect(editor.getByText("Full database and publication checks: NOT_VERIFIED")).toBeVisible();
  await expect(editor.getByText(/Slug global uniqueness: NOT_VERIFIED/)).toBeVisible();
  await editor.getByRole("button", { name: "Discard changes" }).click();
  await expect(editor.getByText("No local changes")).toBeVisible();
  await expect(editor.getByRole("button", { name: "Edit local draft" })).toBeVisible();
  expect(writes).toEqual([]);
  await page.reload();
  await editor.getByRole("button", { name: "Edit local draft" }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Collection 1");
});

test("published slug remains locked after local Draft and retired is read only", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(2));
  const editor = page.getByRole("region", { name: "Local collection basic editor" });
  await editor.getByRole("button", { name: "Edit local draft" }).click();
  await expect(editor.getByLabel("Slug")).toHaveAttribute("readonly", "");
  await editor.getByLabel("Status").selectOption("draft");
  await expect(editor.getByLabel("Slug")).toHaveAttribute("readonly", "");
  await editor.getByRole("button", { name: "Discard changes" }).click();
  await page.goto(detailUrl(3));
  const retired = page.getByRole("region", { name: "Local collection basic editor" });
  await expect(retired.getByText("Retired is terminal. All fields are read only.")).toBeVisible();
  await expect(retired.getByRole("button", { name: "Edit local draft" })).toHaveCount(0);
});

test("dirty draft guards list and member navigation; refresh restores source", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const editor = page.getByRole("region", { name: "Local collection basic editor" });
  await editor.getByRole("button", { name: "Edit local draft" }).click();
  await editor.getByLabel("English name").fill("Unsaved name");
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.dismiss(); });
  await page.getByRole("link", { name: "Back to Collections" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/collections/${id(1)}$`));
  await expect(editor.getByLabel("English name")).toHaveValue("Unsaved name");
  page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.dismiss(); });
  await page.getByRole("region", { name: "Associated products" }).getByRole("link", { name: "Next" }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Unsaved name");
  page.once("dialog", async (dialog) => { await dialog.accept(); });
  await page.reload();
  const refreshed = page.getByRole("region", { name: "Local collection basic editor" });
  await refreshed.getByRole("button", { name: "Edit local draft" }).click();
  await expect(refreshed.getByLabel("English name")).toHaveValue("Collection 1");
});

test("mounted source replacement preserves dirty draft and blocks checking until discard", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${fixtureOrigin}/admin/collection-basic-refresh-fixture`);
  const controls = page.getByRole("group", { name: "Fixture collection source updates" });
  const editor = page.getByRole("region", { name: "Local collection basic editor" });
  await editor.getByRole("button", { name: "Edit local draft" }).click();
  await controls.getByRole("button", { name: "Same values, new object" }).click();
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await editor.getByLabel("English name").fill("Unsaved local value");
  await controls.getByRole("button", { name: "Update source" }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Unsaved local value");
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  await expect(editor.getByRole("alert")).toContainText("Source data has changed");
  await expect(editor.getByRole("button", { name: "Check draft" })).toBeDisabled();
  await editor.getByRole("button", { name: "Discard changes" }).click();
  await expect(editor.getByText("No local changes")).toBeVisible();
  await editor.getByRole("button", { name: "Edit local draft" }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Server changed collection");
  await editor.getByLabel("English name").fill("Second unsaved value");
  await controls.getByRole("button", { name: "Disconnect source" }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Second unsaved value");
  await expect(editor.getByRole("alert")).toBeVisible();
  await editor.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByRole("region", { name: "Local collection basic editor" })).toHaveCount(0);
});

test("clean mounted source update loads new values; keyboard and dirty-to-clean release guard", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${fixtureOrigin}/admin/collection-basic-refresh-fixture`);
  const controls = page.getByRole("group", { name: "Fixture collection source updates" });
  const editor = page.getByRole("region", { name: "Local collection basic editor" });
  await controls.getByRole("button", { name: "Update source" }).click();
  await editor.getByRole("button", { name: "Edit local draft" }).focus();
  await expect(editor.getByRole("button", { name: "Edit local draft" })).toBeFocused();
  await page.keyboard.press("Enter");
  const name = editor.getByLabel("English name");
  await expect(name).toHaveValue("Server changed collection");
  await name.focus();
  await expect(name).toBeFocused();
  await name.fill("Other local value");
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  await name.fill("Server changed collection");
  await expect(editor.getByText("No local changes")).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
});
