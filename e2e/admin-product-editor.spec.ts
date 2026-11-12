import { expect, test } from "@playwright/test";
import { fixtureCookies, fixtureOrigin, startAdminFixture, stopAdminFixture } from "./support/admin-site";

test.beforeAll(async () => { await startAdminFixture(); });
test.afterAll(async () => { await stopAdminFixture(); });
test.setTimeout(120_000);

test("dirty product detail breadcrumb uses the shared guard", async ({ page, context }) => {
  await fixtureCookies(context, "success");
  await page.goto(`${fixtureOrigin}/admin/products/id/00000002-0000-4000-8000-000000000000`);
  await page.getByRole("button", { name: "Edit local draft" }).click();
  const editor = page.getByRole("region", { name: "Local product editor" });
  await editor.getByRole("group", { name: "English translation" })
    .getByLabel("Name").fill("Keep product draft");
  let nativeDialogs = 0;
  page.on("dialog", (dialog) => { nativeDialogs++; void dialog.dismiss(); });
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "Products" });
  await breadcrumb.focus();
  await breadcrumb.click();
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: /Stay and keep editing/ }).click();
  await expect(breadcrumb).toBeFocused();
  await expect(page).toHaveURL(/\/admin\/products\/id\/00000002-0000-4000-8000-000000000000$/);
  await expect(editor.getByRole("group", { name: "English translation" })
    .getByLabel("Name")).toHaveValue("Keep product draft");
  expect(nativeDialogs).toBe(0);
  await breadcrumb.click();
  await guard.getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin/products`);
  expect(nativeDialogs).toBe(0);
});

test("local draft edits and discard restore the original without a save action", async ({ page, context }) => {
  await fixtureCookies(context, "success");
  await page.goto(`${fixtureOrigin}/admin/products/id/00000002-0000-4000-8000-000000000000`);
  await expect(page.getByText("Catalog data is read only. This page offers a local draft editor; changes are never saved to the server.")).toBeVisible();
  await expect(page.getByText("Local draft only", { exact: true })).toBeVisible();
  await expect(page.getByText("LOCAL DEMO / NOT CONNECTED", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Edit local draft" }).click();
  const editor = page.getByRole("region", { name: "Local product editor" });
  await expect(editor.getByLabel("Product Code")).toHaveAttribute("readonly", "");
  await expect(editor.getByLabel("Slug")).toHaveAttribute("readonly", "");
  await expect(editor.getByLabel("SKU Code").first()).toHaveAttribute("readonly", "");
  await editor.getByRole("group", { name: "English translation" }).getByLabel("Name").fill("Changed locally");
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  await editor.getByRole("button", { name: "Check draft" }).click();
  await expect(editor.getByText(/Full catalog and publication checks: (INVALID|NOT_VERIFIED)/)).toBeVisible();
  await editor.getByRole("button", { name: "Discard changes" }).click();
  await editor.getByRole("button", { name: "Edit local draft" }).click();
  await expect(editor.getByRole("group", { name: "English translation" }).getByLabel("Name")).toHaveValue("Family 2");
  await expect(editor.getByText("No local changes")).toBeVisible();
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
  await expect(editor.getByRole("button", { name: /save/i })).toHaveCount(0);
});

test("confirmed navigation keeps the real draft protected until departure completes", async ({ page, context }) => {
  await fixtureCookies(context, "success");
  await page.goto(`${fixtureOrigin}/admin/products/id/00000002-0000-4000-8000-000000000000`);
  await page.getByRole("button", { name: "Edit local draft" }).click();
  const editor = page.getByRole("region", { name: "Local product editor" });
  await editor.getByRole("group", { name: "English translation" }).getByLabel("Name").fill("Pending navigation");
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();

  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
  let requestStarted!: () => void;
  const intercepted = new Promise<void>((resolve) => { requestStarted = resolve; });
  await page.route("**/admin/categories**", async (route) => {
    requestStarted();
    await requestGate;
    await route.abort();
  });
  let nativeConfirmations = 0;
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "confirm") nativeConfirmations++;
    await dialog.dismiss();
  });
  const mobileMenu = page.getByRole("button", { name: "Open admin menu" });
  const isMobile = await mobileMenu.isVisible();
  if (isMobile) await mobileMenu.click();
  const navigation = isMobile ? page.getByRole("dialog", { name: "Admin menu" }) :
    page.getByRole("complementary", { name: "Admin sidebar" });
  await navigation.getByRole("link", { name: "Categories", exact: true }).click();
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: /Continue navigation/ }).click();
  try {
    await intercepted;
    expect(nativeConfirmations).toBe(0);
    await expect(editor.getByText("Unsaved local changes")).toBeVisible();
    expect(await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(true);
  } finally {
    releaseRequest();
  }
});

test("completed navigation releases the guard without a second confirmation", async ({ page, context }) => {
  await fixtureCookies(context, "success");
  await page.goto(`${fixtureOrigin}/admin/products/id/00000002-0000-4000-8000-000000000000`);
  await page.getByRole("button", { name: "Edit local draft" }).click();
  await page.getByRole("group", { name: "English translation" }).getByLabel("Name").fill("Leaving");
  let confirmations = 0;
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "confirm") { confirmations += 1; await dialog.accept(); }
    else throw new Error(`Unexpected ${dialog.type()} dialog`);
  });
  await page.getByRole("link", { name: "Back to Products" }).click();
  await page.getByRole("dialog", { name: /Unsaved local changes/ })
    .getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin/products`);
  expect(confirmations).toBe(0);
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
});

test("local validation flags bad Slug and duplicate SKU specification, while global checks remain unverified", async ({ page, context }) => {
  await fixtureCookies(context, "success");
  await page.goto(`${fixtureOrigin}/admin/products/id/00000001-0000-4000-8000-000000000000`);
  await page.getByRole("button", { name: "Edit local draft" }).click();
  const editor = page.getByRole("region", { name: "Local product editor" });
  await editor.getByLabel("Slug").fill("Bad Slug");
  await editor.getByRole("button", { name: "Check draft" }).click();
  await expect(editor.locator('[data-field-path="slug"]')).toContainText("INVALID_SLUG");
  await expect(editor.getByText("Global Product Code, Slug and SKU uniqueness: NOT_VERIFIED")).toBeVisible();
  await editor.getByLabel("Slug").fill("family-one");
  await editor.getByRole("button", { name: "Check draft" }).click();
  await expect(editor.getByText("Local fields: VALID")).toBeVisible();
  await expect(editor.getByText("Full catalog and publication checks: NOT_VERIFIED")).toBeVisible();

  await page.goto(`${fixtureOrigin}/admin/products/id/00000002-0000-4000-8000-000000000000`);
  await page.getByRole("button", { name: "Edit local draft" }).click();
  const second = page.getByRole("region", { name: "Local product editor" });
  await second.getByLabel("SKU attributes JSON").nth(1).fill("{}");
  await second.getByRole("button", { name: "Check draft" }).click();
  await expect(second.locator('[data-field-path="variants[1].attributes"]')).toContainText("DUPLICATE_SPECIFICATION");
});

test("category and image interactions preserve associations and undo all changes", async ({ page, context }) => {
  await fixtureCookies(context, "success");
  await page.goto(`${fixtureOrigin}/admin/products/id/00000002-0000-4000-8000-000000000000`);
  await page.getByRole("button", { name: "Edit local draft" }).click();
  const editor = page.getByRole("region", { name: "Local product editor" });
  await editor.getByLabel("Primary category").selectOption("00000702-0000-4000-8000-000000000000");
  await expect(editor.getByText(/Only existing associations are available/)).toBeVisible();
  await expect(editor.getByText("Additional categories: Nails")).toBeVisible();
  const variantImage = editor.locator(".admin-editor-image").filter({ hasText: "Variant view" });
  await expect(variantImage.getByRole("radio", { name: "Primary image" })).toBeDisabled();
  const detailImage = editor.locator(".admin-editor-image").filter({ hasText: "Side view" });
  await detailImage.getByRole("radio", { name: "Primary image" }).check();
  await detailImage.getByRole("button", { name: "Move up" }).click();
  await editor.getByRole("button", { name: "Check draft" }).click();
  // This existing fixture is published with incomplete translations; the editor must keep those errors visible.
  await expect(editor.getByText("Local fields: INVALID")).toBeVisible();
  await expect(editor.locator('[data-field-path^="images"]')).toHaveCount(0);
  await editor.getByRole("button", { name: "Discard changes" }).click();
  await editor.getByRole("button", { name: "Edit local draft" }).click();
  await expect(editor.getByLabel("Primary category")).toHaveValue("00000701-0000-4000-8000-000000000000");
  await expect(editor.locator(".admin-editor-image").filter({ hasText: "Front view" }).getByRole("radio")).toBeChecked();
  await expect(editor.locator(".admin-editor-image").filter({ hasText: "Side view" })).toContainText("Order 2");
});

test("controlled links warn; refresh discards; anonymous and forbidden access expose no editor", async ({ page, context }) => {
  await fixtureCookies(context, "success");
  await page.goto(`${fixtureOrigin}/admin/products/id/00000002-0000-4000-8000-000000000000`);
  await page.getByRole("button", { name: "Edit local draft" }).click();
  const editor = page.getByRole("region", { name: "Local product editor" });
  await editor.getByRole("group", { name: "English translation" }).getByLabel("Name").fill("Unsaved");
  await page.getByRole("link", { name: "Back to Products" }).click();
  await page.getByRole("dialog", { name: /Unsaved local changes/ })
    .getByRole("button", { name: /Stay and keep editing/ }).click();
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  const mobileMenu = page.getByRole("button", { name: "Open admin menu" });
  const isMobile = await mobileMenu.isVisible();
  if (isMobile) await mobileMenu.click();
  const navigation = isMobile ? page.getByRole("dialog", { name: "Admin menu" }) :
    page.getByRole("complementary", { name: "Admin sidebar" });
  await navigation.getByRole("link", { name: "Categories", exact: true }).click();
  await page.getByRole("dialog", { name: /Unsaved local changes/ })
    .getByRole("button", { name: /Stay and keep editing/ }).click();
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("beforeunload"); await dialog.accept(); });
  await page.reload();
  await page.getByRole("button", { name: "Edit local draft" }).click();
  await expect(page.getByRole("group", { name: "English translation" }).getByLabel("Name")).toHaveValue("Family 2");
  const content = await page.content();
  for (const secret of ["storageKey", "publicUrl", "private/fixture.webp", "private/detail.webp", "https://example.invalid/detail.webp"])
    expect(content).not.toContain(secret);
  await context.clearCookies();
  await page.goto(`${fixtureOrigin}/admin/products/id/00000002-0000-4000-8000-000000000000`);
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByRole("region", { name: "Local product editor" })).toHaveCount(0);
  await fixtureCookies(context, "forbidden");
  await page.goto(`${fixtureOrigin}/admin/products/id/00000002-0000-4000-8000-000000000000`);
  await expect(page).toHaveURL(/\/admin\/login\?error=1/);
});

test("browser history and switching details preserve normal routing without retaining a draft", async ({ page, context }) => {
  await fixtureCookies(context, "success");
  await page.goto(`${fixtureOrigin}/admin/products`);
  await page.getByRole("link", { name: "FAMILY-1" }).click();
  await page.getByRole("button", { name: "Edit local draft" }).click();
  const editor = page.getByRole("region", { name: "Local product editor" });
  await editor.getByLabel("Slug").fill("temporary-slug");
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin/products`);
  await page.getByRole("link", { name: "FAMILY-2" }).click();
  await expect(page.getByRole("heading", { name: "Product detail" })).toBeVisible();
  await page.getByRole("button", { name: "Edit local draft" }).click();
  await expect(page.getByRole("region", { name: "Local product editor" }).getByLabel("Slug")).toHaveValue("family-2");
});
