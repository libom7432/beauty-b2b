import { expect, test } from "@playwright/test";
import { fixtureCookies, fixtureOrigin, startAdminFixture, stopAdminFixture } from "./support/admin-site";

test.beforeAll(async () => { await startAdminFixture(); });
test.afterAll(async () => { await stopAdminFixture(); });
test.setTimeout(120_000);

const target = () => `${fixtureOrigin}/admin/category-refresh-fixture`;

test("mounted refresh removing A retains its dirty draft and both navigation guards", async ({ page, context }) => {
  await fixtureCookies(context, "category");
  await page.goto(target());
  const controls = page.getByRole("group", { name: "Fixture source updates" });
  const hierarchy = page.getByRole("region", { name: "Category hierarchy" });
  await hierarchy.getByRole("button", { name: "Category A", exact: true }).click();
  const editor = page.getByRole("region", { name: "Local category editor" });
  await editor.getByLabel("English name").fill("Unsaved A");
  await controls.getByRole("button", { name: "Remove A from source" }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Unsaved A");
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  await expect(editor.getByRole("alert")).toContainText("Source data has changed or is unavailable");
  await expect(editor.getByLabel("English name")).toBeDisabled();
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);

  const mobileMenu = page.getByRole("button", { name: "Open admin menu" });
  const isMobile = await mobileMenu.isVisible();
  if (isMobile) await mobileMenu.click();
  page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.dismiss(); });
  const navigation = isMobile ? page.getByRole("dialog", { name: "Admin menu" }) :
    page.getByRole("complementary", { name: "Admin sidebar" });
  await navigation.getByRole("link", { name: "Products", exact: true }).click();
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  if (isMobile) await page.keyboard.press("Escape");

  page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.dismiss(); });
  await hierarchy.getByRole("button", { name: "Category B", exact: true }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Unsaved A");
  page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.accept(); });
  await hierarchy.getByRole("button", { name: "Category B", exact: true }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Category B");
  await expect(editor.getByText("No local changes")).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
});

test("mounted refresh updating A preserves its original snapshot until explicit discard", async ({ page, context }) => {
  await fixtureCookies(context, "category");
  await page.goto(target());
  const controls = page.getByRole("group", { name: "Fixture source updates" });
  const hierarchy = page.getByRole("region", { name: "Category hierarchy" });
  await hierarchy.getByRole("button", { name: "Category A", exact: true }).click();
  const editor = page.getByRole("region", { name: "Local category editor" });
  await editor.getByLabel("English name").fill("Server changed A");
  await controls.getByRole("button", { name: "Update A in source" }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Server changed A");
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  await expect(page.getByRole("region", { name: "Category detail" })).toContainText("Category A");
  await expect(editor.getByRole("alert")).toBeVisible();
  await editor.getByRole("button", { name: "Discard changes" }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Server changed A");
  await expect(editor.getByText("No local changes")).toBeVisible();
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
});

test("reorder, incomplete, disconnect and error never silently discard a mounted draft", async ({ page, context }) => {
  await fixtureCookies(context, "category");
  await page.goto(target());
  const controls = page.getByRole("group", { name: "Fixture source updates" });
  const hierarchy = page.getByRole("region", { name: "Category hierarchy" });
  await hierarchy.getByRole("button", { name: "Category A", exact: true }).click();
  const editor = page.getByRole("region", { name: "Local category editor" });
  await editor.getByLabel("English name").fill("Local A");
  await controls.getByRole("button", { name: "Reorder source" }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Local A");
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await hierarchy.getByRole("textbox", { name: "Search categories" }).fill("Category B");
  await expect(editor.getByLabel("English name")).toHaveValue("Local A");
  await hierarchy.getByRole("textbox", { name: "Search categories" }).fill("");
  await hierarchy.getByRole("button", { name: "Collapse Category B" }).click();
  await expect(editor.getByLabel("English name")).toHaveValue("Local A");
  await controls.getByRole("button", { name: "Incomplete source" }).click();
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  await expect(editor.getByText(/Category data is incomplete/)).toBeVisible();
  await controls.getByRole("button", { name: "Disconnect source" }).click();
  await expect(page.getByRole("heading", { name: "Category database not connected" })).toBeVisible();
  await expect(editor.getByLabel("English name")).toHaveValue("Local A");
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  await controls.getByRole("button", { name: "Fail source" }).click();
  await expect(page.getByRole("heading", { name: "Categories unavailable" })).toBeVisible();
  await expect(editor.getByText("Unsaved local changes")).toBeVisible();
  await editor.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByRole("region", { name: "Local category editor" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
});
