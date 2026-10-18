import { test, expect } from "@playwright/test";

test("anonymous visitors cannot enter Admin pages", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
  await page.goto("/admin/products");
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: "Admin login" })).toBeVisible();
});
