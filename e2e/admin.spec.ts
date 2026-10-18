import { test, expect } from "@playwright/test";

test("anonymous visitors cannot enter Admin pages", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
  await page.goto("/admin/products");
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: "Admin login" })).toBeVisible();
});

test("anonymous visitors cannot enter detail or read-only module pages", async ({ page }) => {
  for (const path of ["/admin/products/TEST-001", "/admin/categories", "/admin/collections", "/admin/media", "/admin/imports"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
    await expect(page.getByText("TEST-001")).toHaveCount(0);
  }
});

test("Admin login has no workspace sidebar", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "Admin login" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin navigation" })).toHaveCount(0);
});

test("English and Chinese storefronts remain public", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/zh");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
