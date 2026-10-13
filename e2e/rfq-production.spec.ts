import { expect, test } from "@playwright/test";

test("production RFQ page stays in review-only mode", async ({ page }) => {
  await page.goto("/products/press-on-nails");
  await page.locator(".product-card-listing").first().getByRole("button", { name: /Add to Inquiry/ }).click();
  await page.goto("/inquiry/request-quote");
  await page.locator("#rfq-full-name").fill("Synthetic Buyer");
  await page.locator("#rfq-email").fill("buyer@example.invalid");
  await page.locator("#rfq-company").fill("Synthetic Company");
  await page.locator("#rfq-country").selectOption("US");
  await page.locator("#rfq-requirements").fill("Synthetic request for a local UI test only.");
  await page.getByRole("button", { name: "Review Inquiry" }).click();
  await expect(page.getByRole("heading", { name: "Review your inquiry" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit RFQ" })).toHaveCount(0);
});

test("production API still forces 503", async ({ request }) => {
  const response = await request.post("/api/rfq", { data: {} });
  expect(response.status()).toBe(503);
  expect(await response.json()).toEqual({ error: "RFQ_UNAVAILABLE" });
});
