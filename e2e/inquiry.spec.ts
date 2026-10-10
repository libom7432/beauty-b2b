import { expect, test } from "@playwright/test";

async function openInquiry(page: import("@playwright/test").Page, mobile: boolean) {
  if (mobile) {
    const menu = page.locator(".mobile-navigation");
    await menu.locator("summary").click();
    await page.locator(".mobile-navigation-panel .inquiry-header-link").click();
    await expect(menu).toHaveJSProperty("open", false);
  } else await page.locator(".header-actions > .inquiry-header-link").click();
}

test("card add keeps catalog page, persists one SKU and supports quantity changes", async ({ page }, testInfo) => {
  await page.goto("/products/press-on-nails");
  const card = page.locator(".product-card-listing").first();
  await card.getByRole("button", { name: /Add to Inquiry/ }).click();
  await expect(page).toHaveURL(/\/products\/press-on-nails$/);
  await expect(card.getByRole("button", { name: /Added to Inquiry/ })).toBeDisabled();
  await expect(page.locator(".header-actions > .inquiry-header-link")).toContainText("(1)");
  await page.reload();
  await expect(page.locator(".header-actions > .inquiry-header-link")).toContainText("(1)");
  await openInquiry(page, testInfo.project.name === "mobile-chrome");
  await expect(page).toHaveURL(/\/inquiry$/);
  await expect(page.locator(".inquiry-row")).toHaveCount(1);
  const quantity = page.locator(".inquiry-row input[type=number]");
  await quantity.fill("275");
  await quantity.blur();
  await page.reload();
  await expect(page.locator(".inquiry-row input[type=number]")).toHaveValue("275");
  await page.locator(".inquiry-row input[type=number]").fill("0");
  await page.locator(".inquiry-row input[type=number]").blur();
  await expect(page.locator(".inquiry-row input[type=number]")).toHaveValue("275");
  await page.locator(".inquiry-row-actions button").click();
  await expect(page.getByText("Your inquiry list is empty")).toBeVisible();
  await expect(page.locator(".header-actions > .inquiry-header-link")).toContainText("(0)");
});

test("selected variant adds its own SKU and Chinese inquiry page is available", async ({ page }) => {
  await page.goto("/product/almond-press-on-concept");
  const options = page.locator(".product-variant-option");
  const secondSku = (await options.nth(1).locator("small").textContent())?.trim();
  await options.nth(1).click();
  await page.getByRole("button", { name: `Add to Inquiry: ${secondSku}` }).click();
  await expect(page.locator(".header-actions > .inquiry-header-link")).toContainText("(1)");
  await page.goto("/zh/inquiry");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("询盘清单");
  await expect(page.locator(".inquiry-row-details")).toContainText(secondSku ?? "");
  await expect(page.locator(".header-actions > .inquiry-header-link")).toContainText("(1)");
});

test("consecutive removals can be undone and Clear All requires confirmation", async ({ page }, testInfo) => {
  await page.goto("/products/press-on-nails");
  await page.locator(".product-card-listing").nth(0).getByRole("button", { name: /Add to Inquiry/ }).click();
  await page.locator(".product-card-listing").nth(1).getByRole("button", { name: /Add to Inquiry/ }).click();
  await openInquiry(page, testInfo.project.name === "mobile-chrome");
  await expect(page.locator(".inquiry-row")).toHaveCount(2);
  const firstSku = (await page.locator(".inquiry-row").first().locator(".inquiry-row-details span").first().textContent())?.trim();
  const firstQuantity = page.locator(".inquiry-row").first().locator("input[type=number]");
  await firstQuantity.fill("275");
  await firstQuantity.blur();
  await page.locator(".inquiry-row").first().getByRole("button", { name: /Remove/ }).click();
  await expect(page.getByRole("status")).toContainText("Product removed from inquiry.");
  await page.locator(".inquiry-row").first().getByRole("button", { name: /Remove/ }).click();
  await expect(page.locator(".inquiry-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".inquiry-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".inquiry-row")).toHaveCount(2);
  await expect(page.locator(".inquiry-row").first()).toContainText(firstSku ?? "");
  await expect(page.locator(".inquiry-row").first().locator("input[type=number]")).toHaveValue("275");

  await page.getByRole("button", { name: "Clear inquiry" }).click();
  const dialog = page.getByRole("dialog", { name: "Clear your inquiry list?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".inquiry-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Clear inquiry" }).click();
  await dialog.getByRole("button", { name: "Clear All" }).click();
  await expect(page.locator(".inquiry-row")).toHaveCount(0);
  await expect(page.getByText("Your inquiry list is empty")).toBeVisible();
});

test("remove toast closes after approximately five seconds", async ({ page }) => {
  await page.goto("/products/press-on-nails");
  await page.locator(".product-card-listing").first().getByRole("button", { name: /Add to Inquiry/ }).click();
  await page.goto("/inquiry");
  await page.locator(".inquiry-row").getByRole("button", { name: /Remove/ }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("status")).toBeHidden({ timeout: 6500 });
});

test("Chinese clear confirmation can be cancelled", async ({ page }) => {
  await page.goto("/zh/products/press-on-nails");
  await page.locator(".product-card-listing").first().getByRole("button", { name: /加入询盘/ }).click();
  await page.goto("/zh/inquiry");
  await page.getByRole("button", { name: "清空询盘" }).click();
  const dialog = page.getByRole("dialog", { name: "确定清空询盘清单？" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".inquiry-row")).toHaveCount(1);
});
