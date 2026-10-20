import { expect, test } from "@playwright/test";
import { fixtureCookies, fixtureOrigin, startAdminFixture, stopAdminFixture } from "./support/admin-site";

test.beforeAll(async () => { await startAdminFixture(); });
test.afterAll(async () => { await stopAdminFixture(); });
test.setTimeout(180_000);

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

test("UUID detail links work for 128 through 32768 code units without long URLs", async ({ page, context }) => {
  await fixtureCookies(context, "length");
  for (const length of [128, 1024, 4096, 8192, 32768]) {
    const index = [128, 256, 512, 1024, 2048, 4096, 8192, 32768].indexOf(length);
    for (const kind of [0, 1]) {
      const productId = id(100 + index * 2 + kind);
      const path = `/admin/products/id/${productId}`;
      expect(path.length).toBeLessThan(64);
      const response = await page.goto(`${fixtureOrigin}${path}`, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Product detail" })).toBeVisible();
      const html = await page.content();
      expect(html).not.toContain("private/fixture.webp");
      expect(html).not.toContain("storageKey");
      const code = (kind === 0 ? "A" : "甲").repeat(length);
      expect(html).toContain(code.slice(0, 32));
      await expect(page.getByRole("link", { name: "Back to Products" })).toHaveAttribute("href", "/admin/products");
    }
  }
});

test("V2 Next, Previous, refresh and browser history keep URLs bounded", async ({ page, context }) => {
  for (const length of [128, 1024, 4096, 8192, 32768]) {
    await fixtureCookies(context, `cursor-${length}`);
    await page.goto(`${fixtureOrigin}/admin/products?sort=product_code_asc`);
    const firstUrl = page.url();
    const next = await page.getByRole("link", { name: "Next" }).getAttribute("href");
    expect(next).toBeTruthy();
    expect(next!.length).toBeLessThan(1024);
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
    const secondUrl = page.url();
    await page.reload();
    await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
    const previous = await page.getByRole("link", { name: "Previous" }).getAttribute("href");
    expect(previous).toBeTruthy();
    expect(previous!.length).toBeLessThan(1024);
    await Promise.all([page.waitForURL(firstUrl), page.getByRole("link", { name: "Previous" }).click()]);
    await expect(page).toHaveURL(firstUrl);
    await page.goBack();
    await expect(page).toHaveURL(secondUrl);
    await page.goForward();
    await expect(page).toHaveURL(firstUrl);
  }
});
