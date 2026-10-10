import { expect, test, type Page } from "@playwright/test";

async function addProduct(page: Page, locale: "en" | "zh" = "en") {
  await page.goto(`${locale === "zh" ? "/zh" : ""}/products/press-on-nails`);
  await page.locator(".product-card-listing").first().getByRole("button", { name: locale === "zh" ? /加入询盘/ : /Add to Inquiry/ }).click();
  await page.goto(`${locale === "zh" ? "/zh" : ""}/inquiry`);
  await expect(page.locator(".inquiry-row")).toHaveCount(1);
  await page.locator(".inquiry-list-footer").getByRole("link", { name: locale === "zh" ? "获取报价" : "Request a Quote" }).click();
}

test("empty inquiry and required fields cannot reach review", async ({ page }) => {
  await page.goto("/inquiry/request-quote");
  await expect(page.getByRole("heading", { name: "Request a Quote" })).toBeVisible();
  await expect(page.getByText("Your inquiry list is empty.")).toBeVisible();
  await page.getByRole("button", { name: "Review Inquiry" }).click();
  await expect(page.locator("#rfq-full-name")).toBeFocused();
  await expect(page.locator("#rfq-full-name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#rfq-email-error")).toContainText("Required field");
  await expect(page.getByRole("heading", { name: "Review your inquiry" })).toHaveCount(0);
});

test("form validates, reviews and keeps values when editing", async ({ page }) => {
  await addProduct(page);
  await expect(page.getByRole("heading", { name: "Inquiry Summary" })).toBeVisible();
  await page.locator("#rfq-full-name").fill("Jane Buyer");
  await page.locator("#rfq-email").fill("bad-email");
  await page.locator("#rfq-email").blur();
  await expect(page.locator("#rfq-email-error")).toContainText("Invalid email");
  await page.locator("#rfq-email").fill("jane@example.com");
  await expect(page.locator("#rfq-email-error")).toBeEmpty();
  await expect(page.locator("#rfq-email-error")).toHaveAttribute("aria-hidden", "true");
  await page.locator("#rfq-company").fill("Nail Studio Ltd");
  await page.locator("#rfq-country").selectOption("US");
  await page.locator("#rfq-buyer-type").selectOption("wholesaler");
  await page.getByLabel("Private Label").check();
  await page.getByLabel("Custom Packaging").check();
  await page.locator("#rfq-timeline").selectOption("within_3_months");
  await page.locator("#rfq-requirements").fill("Too short");
  await page.locator("#rfq-requirements").blur();
  await expect(page.locator("#rfq-requirements-error")).toContainText("too short");
  await page.locator("#rfq-requirements").fill("Please quote this product for our next store launch.");
  await page.getByRole("button", { name: "Review Inquiry" }).click();
  await expect(page.getByRole("heading", { name: "Review your inquiry" })).toBeVisible();
  await expect(page.locator(".rfq-review-content")).toContainText("jane@example.com");
  await expect(page.locator(".rfq-review-content")).toContainText("Private Label, Custom Packaging");
  await expect(page.locator(".rfq-review .rfq-summary-item")).toHaveCount(1);
  await expect(page.locator(".rfq-review")).toContainText("No RFQ is submitted at this stage.");
  await page.getByRole("button", { name: "Edit Information" }).click();
  await expect(page.locator("#rfq-full-name")).toHaveValue("Jane Buyer");
  await expect(page.locator("#rfq-country")).toHaveValue("US");
  await expect(page.getByLabel("Private Label")).toBeChecked();
});

test("stale SKU is shown and cannot enter review until explicitly discarded", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("beauty-b2b-inquiry-v1", JSON.stringify([{ productId: "missing", sku: "STALE", quantity: 100, addedAt: new Date().toISOString() }])));
  await page.goto("/inquiry/request-quote");
  await expect(page.getByText("1 saved inquiry items are invalid or no longer available.")).toBeVisible();
  await page.getByRole("button", { name: "Review Inquiry" }).click();
  await expect(page.getByRole("heading", { name: "Review your inquiry" })).toHaveCount(0);
  await page.getByRole("button", { name: "Discard invalid items" }).click();
  await expect(page.getByText("1 saved inquiry items are invalid or no longer available.")).toHaveCount(0);
  await expect(page.getByText("Your inquiry list is empty.")).toBeVisible();
});

test("Chinese form and review labels are localized", async ({ page }) => {
  await addProduct(page, "zh");
  await expect(page.getByRole("group", { name: "联系人信息" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "商务邮箱" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "询盘商品汇总" })).toBeVisible();
  await page.locator("#rfq-full-name").fill("王采购");
  await page.locator("#rfq-email").fill("buyer@example.com");
  await page.locator("#rfq-company").fill("美甲工作室");
  await page.locator("#rfq-country").selectOption("CN");
  await page.locator("#rfq-requirements").fill("请提供该商品的批发规格和交期信息。");
  await page.getByRole("button", { name: "预览询盘" }).click();
  await expect(page.getByRole("heading", { name: "预览询盘信息" })).toBeVisible();
  await expect(page.locator(".rfq-review-content")).toContainText("王采购");
  await page.getByRole("button", { name: "编辑信息" }).click();
  await expect(page.locator("#rfq-full-name")).toHaveValue("王采购");
});

for (const locale of ["en", "zh"] as const) {
  test(`${locale} RFQ hydrates on first load and refresh, then validates and reviews`, async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    const prefix = locale === "zh" ? "/zh" : "";
    await page.goto(`${prefix}/inquiry/request-quote`);
    const hongKong = page.locator("#rfq-country option[value=HK]");
    const initialName = await hongKong.textContent();
    expect(initialName).toBeTruthy();
    await page.reload();
    await expect(hongKong).toHaveText(initialName!);
    await page.getByRole("button", { name: locale === "zh" ? "预览询盘" : "Review Inquiry" }).click();
    await expect(page.locator("#rfq-email")).toHaveAttribute("aria-invalid", "true");
    await addProduct(page, locale);
    await page.locator("#rfq-full-name").fill(locale === "zh" ? "王采购" : "Jane Buyer");
    await page.locator("#rfq-email").fill("buyer@example.com");
    await page.locator("#rfq-company").fill(locale === "zh" ? "美甲工作室" : "Nail Studio Ltd");
    await page.locator("#rfq-country").selectOption(locale === "zh" ? "CN" : "US");
    await page.locator("#rfq-requirements").fill(locale === "zh" ? "请提供该商品的批发规格和交期信息。" : "Please quote this product for our next store launch.");
    await page.getByRole("button", { name: locale === "zh" ? "预览询盘" : "Review Inquiry" }).click();
    await expect(page.getByRole("heading", { name: locale === "zh" ? "预览询盘信息" : "Review your inquiry" })).toBeVisible();
    await page.getByRole("button", { name: locale === "zh" ? "编辑信息" : "Edit Information" }).click();
    await expect(page.locator("#rfq-country")).toHaveValue(locale === "zh" ? "CN" : "US");
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

test("RFQ selects, error rows and requirements sizing remain aligned", async ({ page }, testInfo) => {
  await page.goto("/inquiry/request-quote");
  for (const id of ["#rfq-country", "#rfq-buyer-type", "#rfq-timeline"]) {
    const style = await page.locator(id).evaluate((element) => {
      const computed = getComputedStyle(element);
      return { appearance: computed.appearance, image: computed.backgroundImage, size: computed.backgroundSize, position: computed.backgroundPosition };
    });
    expect(style.appearance).toBe("none");
    expect(style.image).toContain("svg");
    expect(style.size).toBe("16px 16px");
    // Chrome may normalize the keyword offset to an equivalent calc() value.
    expect(style.position).toMatch(/^(?:right 18px center|calc\(100% - 18px\) 50%)$/);
  }
  const name = page.locator("#rfq-full-name");
  const email = page.locator("#rfq-email");
  const emailTopBefore = (await email.boundingBox())!.y;
  await name.fill("A");
  await name.blur();
  await expect(page.locator("#rfq-full-name-error")).toContainText("Input is too short");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAttribute("aria-describedby", "rfq-full-name-error");
  if (testInfo.project.name === "desktop-chrome") {
    const nameTop = (await name.boundingBox())!.y;
    const emailTop = (await email.boundingBox())!.y;
    expect(Math.abs(nameTop - emailTop)).toBeLessThan(2);
    expect(Math.abs(emailTop - emailTopBefore)).toBeLessThan(2);
  }
  const textareaStyle = await page.locator("#rfq-requirements").evaluate((element) => {
    const computed = getComputedStyle(element);
    return { height: computed.height, minHeight: computed.minHeight, maxHeight: computed.maxHeight, resize: computed.resize };
  });
  expect(textareaStyle).toEqual({ height: "160px", minHeight: "160px", maxHeight: "360px", resize: "vertical" });
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(noOverflow).toBe(true);
});
