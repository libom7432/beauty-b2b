import { test, expect, type Page } from "@playwright/test";
import { fixtureCookies, fixtureOrigin, startAdminFixture, stopAdminFixture } from "./support/admin-site";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const detailUrl = (n: number) => `${fixtureOrigin}/admin/collections/${id(n)}`;

test.beforeAll(async () => { await startAdminFixture(); });
test.afterAll(async () => { await stopAdminFixture(); });
test.setTimeout(120_000);

// Diagnostics are attached only to a failed isolated timing test. They contain
// state names and request counts, never cookies, tokens or response bodies.
type VerificationRequests = { identity: number; memberSource: number; exactGet: number;
  beforeFocusPhase?: string | null };
const verificationRequests = new WeakMap<Page, VerificationRequests>();
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus ||
    !/focus verification/i.test(testInfo.title)) return;
  const requests = verificationRequests.get(page) ?? null;
  const state = await page.evaluate(() => {
    const fixture = window as Window & { verificationFixtureSnapshot?: () => object;
      verificationShellSnapshot?: () => object };
    const source = document.querySelector(".admin-membership-editor [role=alert]")?.textContent ?? "";
    return { route: location.pathname, queryPresent: location.search.length > 0,
      identity: document.querySelector(".admin-identity-status")?.textContent?.trim() ?? "VERIFIED_VIEW",
      owner: fixture.verificationShellSnapshot?.() ?? fixture.verificationFixtureSnapshot?.() ?? null,
      memberSource: source.match(/Current member source: ([A-Z_]+)/)?.[1] ?? "NO_ALERT",
      verification: [...document.querySelectorAll("[data-verification-status]")]
        .map((item) => item.getAttribute("data-verification-status")),
      addEnabled: [...document.querySelectorAll<HTMLButtonElement>(".admin-candidate-panel button")]
        .some((button) => button.textContent?.includes("Add to Draft") && !button.disabled) };
  }).catch(() => ({ route: "UNAVAILABLE" }));
  await testInfo.attach("fixture-verification-lifecycle", {
    body: Buffer.from(JSON.stringify({ ...state, requests })), contentType: "application/json" });
});

test("candidate search uses isolated read-only pages, mixed names and signed cursors", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(detailUrl(1));
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  await expect(candidates).toContainText("TEST DATA / LOCAL DEMO");
  await expect(candidates).toContainText("cannot prove that a product is not already associated");
  await expect(candidates.locator("tbody tr")).toHaveCount(20);
  await expect(candidates.getByRole("button", { name: "Add Candidate" })).toHaveCount(0);
  await expect(candidates.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
  const editors = page.getByTestId("collection-editors");
  await expect(editors).toHaveAttribute("data-collection-id", id(1));
  await expect(editors.getByRole("region", { name: "Candidate product search" })).toHaveCount(1);
  await expect(editors.getByRole("region", { name: "Local collection membership editor" })).toHaveCount(1);
  await candidates.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/candidate_cursor=/);
  await expect(candidates.locator("tbody tr")).toHaveCount(20);
  await candidates.getByRole("button", { name: "Previous" }).click();
  await expect(candidates.getByText("FAMILY-101", { exact: true })).toBeVisible();
  for (const term of ["FAMILY-101", "Candidate 101", "候选商品 101"]) {
    const input = candidates.getByRole("searchbox", { name: "Search code or English / Chinese name" });
    await input.fill(term);
    await candidates.getByRole("button", { name: "Search candidates" }).click();
    await expect(candidates.locator("tbody tr")).toHaveCount(1);
    await expect(candidates.getByText("Candidate 101", { exact: true })).toBeVisible();
  }
  await candidates.getByLabel("Product status").selectOption("published");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(candidates).toContainText("No products matched this query");
  await candidates.getByRole("button", { name: "Clear candidate filters" }).click();
  await expect(candidates.locator("tbody tr")).toHaveCount(20);
  await expect(candidates.getByLabel("Product status")).toHaveValue("all");
  await expect(candidates.getByRole("searchbox")).toHaveValue("");
  await expect(candidates).not.toContainText("private/");
  expect(writes).toEqual([]);
});

test("exact GET verification stays separate from local member facts and never writes", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.method());
  });
  await page.goto(detailUrl(1));
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const row101 = candidates.locator(`tr[data-product-id="${id(101)}"]`);
  await expect(row101).toContainText("Already in Collection");
  await expect(row101.getByRole("button", { name: "Verify Membership" })).toHaveCount(0);
  await member.locator(`[data-product-id="${id(101)}"]`).getByRole("button", { name: "Remove locally" }).click();
  await expect(row101).toContainText("Pending Removal");
  await expect(row101.getByRole("button", { name: "Verify Membership" })).toHaveCount(0);
  page.once("dialog", async (dialog) => { await dialog.accept(); });
  await page.goto(detailUrl(2));
  const candidate = candidates.locator(`tr[data-product-id="${id(101)}"]`);
  await expect(candidate).toContainText("Membership Not Verified");
  await candidate.getByRole("button", { name: "Verify Membership" }).click();
  await expect(candidate).toContainText("Not a Member — Verified for this view only");
  await expect(candidate).toContainText("Membership Not Verified");
  await expect(candidate.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  await candidates.getByRole("searchbox").fill("FAMILY-102");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(page).toHaveURL(/candidate_q=FAMILY-102/);
  await expect(candidates).not.toContainText("Not a Member — Verified for this view only");
  expect(writes).toEqual([]);
});

test("verified candidate Add, sort and Cancel share the local membership draft", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(detailUrl(2));
  const editors = page.getByTestId("collection-editors");
  const candidates = editors.getByRole("region", { name: "Candidate product search" });
  const member = editors.getByRole("region", { name: "Local collection membership editor" });
  const basic = editors.getByRole("region", { name: "Local collection basic editor" });
  const row = candidates.locator(`tr[data-product-id="${id(101)}"]`);
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Keep basic draft");
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  await row.getByRole("button", { name: "Add to Draft" })
    .evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(row).toContainText("Draft Added");
  await expect(member.locator("[data-proposed-product-id]")).toHaveCount(1);
  await expect(row.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  const proposed = member.locator(`[data-proposed-product-id="${id(101)}"]`);
  await expect(proposed).toContainText("Proposed addition only");
  await proposed.getByLabel("Local sort order for proposed FAMILY-101").fill("-5");
  await expect(proposed.getByLabel("Local sort order for proposed FAMILY-101")).toHaveValue("-5");
  await proposed.getByLabel("Local sort order for proposed FAMILY-101").fill("2147483648");
  await expect(proposed).toContainText("Use a PostgreSQL int32 integer");
  await proposed.getByLabel("Local sort order for proposed FAMILY-101").fill("0");
  await expect(proposed).not.toContainText("Use a PostgreSQL int32 integer");
  await candidates.getByRole("searchbox").fill("FAMILY-101");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(page).toHaveURL(/candidate_q=FAMILY-101/);
  await expect(row).toContainText("Draft Added");
  await proposed.getByRole("button", { name: "Cancel proposed add" }).click();
  await expect(proposed).toHaveCount(0);
  await expect(row).toContainText("Membership Not Verified");
  await expect(row.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
  await expect(member.getByText("No membership changes")).toBeVisible();
  await expect(basic.getByLabel("English name")).toHaveValue("Keep basic draft");
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  await row.getByRole("button", { name: "Add to Draft" }).click();
  page.once("dialog", async (dialog) => { await dialog.accept(); });
  await page.goto(detailUrl(1));
  await expect(page.getByTestId("collection-editors")).toHaveAttribute("data-collection-id", id(1));
  await expect(member.locator("[data-proposed-product-id]")).toHaveCount(0);
  await expect(row).toContainText("Already in Collection");
  expect(writes).toEqual([]);
});

test("same-task Remove then Add keeps both edits and rapid Remove/Restore uses the latest draft", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(2));
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const row = page.locator(`.admin-candidate-panel tr[data-product-id="${id(101)}"]`);
  const original = member.locator(`[data-product-id="${id(202)}"]`);
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  await page.evaluate(([memberId, candidateId]) => {
    const remove = document.querySelector<HTMLButtonElement>(
      `.admin-membership-editor [data-product-id="${memberId}"] button`);
    const add = document.querySelector<HTMLButtonElement>(
      `.admin-candidate-panel tr[data-product-id="${candidateId}"] button:last-of-type`);
    if (!remove || !add) throw Error("Missing local draft controls");
    remove.click(); add.click();
  }, [id(202), id(101)]);
  await expect(original.getByRole("button", { name: "Restore locally" })).toBeVisible();
  await expect(member.locator(`[data-proposed-product-id="${id(101)}"]`)).toBeVisible();
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  await original.getByRole("button", { name: "Restore locally" }).click();
  await original.getByRole("button", { name: "Remove locally" })
    .evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(original.getByRole("button", { name: "Remove locally" })).toBeVisible();
  await expect(member.locator(`[data-proposed-product-id="${id(101)}"]`)).toBeVisible();
});

test("same-task original Sort then Add retains the sort text and proposed member", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(2));
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const row = page.locator(`.admin-candidate-panel tr[data-product-id="${id(101)}"]`);
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  await page.evaluate(([memberId, candidateId]) => {
    const input = document.getElementById(`membership-sort-${memberId}`) as HTMLInputElement | null;
    const add = document.querySelector<HTMLButtonElement>(
      `.admin-candidate-panel tr[data-product-id="${candidateId}"] button:last-of-type`);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!input || !add || !setter) throw Error("Missing local sort or Add control");
    setter.call(input, "-7");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    add.click();
  }, [id(202), id(101)]);
  await expect(member.getByLabel(`Local sort order for FAMILY-202`)).toHaveValue("-7");
  await expect(member.locator(`[data-proposed-product-id="${id(101)}"]`)).toBeVisible();
});

test("same-task Discard invalidates an old check before Add and Add then Discard stays clean", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(2));
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const row = page.locator(`.admin-candidate-panel tr[data-product-id="${id(101)}"]`);
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  await page.evaluate((candidateId) => {
    const discard = [...document.querySelectorAll<HTMLButtonElement>(".admin-membership-editor button")]
      .find((button) => button.textContent?.includes("Discard membership changes"));
    const add = document.querySelector<HTMLButtonElement>(
      `.admin-candidate-panel tr[data-product-id="${candidateId}"] button:last-of-type`);
    if (!discard || !add) throw Error("Missing Discard or Add control");
    discard.click(); add.click();
  }, id(101));
  await expect(member.locator("[data-proposed-product-id]")).toHaveCount(0);
  await expect(member.getByText("No membership changes")).toBeVisible();
  await expect(row.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  await page.evaluate((candidateId) => {
    const add = document.querySelector<HTMLButtonElement>(
      `.admin-candidate-panel tr[data-product-id="${candidateId}"] button:last-of-type`);
    const discard = [...document.querySelectorAll<HTMLButtonElement>(".admin-membership-editor button")]
      .find((button) => button.textContent?.includes("Discard membership changes"));
    if (!add || !discard) throw Error("Missing Add or Discard control");
    add.click(); discard.click();
  }, id(101));
  await expect(member.locator("[data-proposed-product-id]")).toHaveCount(0);
  await expect(member.getByText("No membership changes")).toBeVisible();
});

test("same-task Add then original Remove and Sort preserves every local edit", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(2));
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const row = page.locator(`.admin-candidate-panel tr[data-product-id="${id(101)}"]`);
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  await page.evaluate(([memberId, candidateId]) => {
    const add = document.querySelector<HTMLButtonElement>(
      `.admin-candidate-panel tr[data-product-id="${candidateId}"] button:last-of-type`);
    if (!add) throw Error("Missing Add control");
    add.click();
    const remove = document.querySelector<HTMLButtonElement>(
      `.admin-membership-editor [data-product-id="${memberId}"] button`);
    const input = document.getElementById(`membership-sort-${memberId}`) as HTMLInputElement | null;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!remove || !input || !setter) throw Error("Missing member controls");
    setter.call(input, "-9");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    remove.click();
  }, [id(202), id(101)]);
  await expect(member.locator(`[data-proposed-product-id="${id(101)}"]`)).toBeVisible();
  await expect(member.locator(`[data-product-id="${id(202)}"]`)
    .getByRole("button", { name: "Restore locally" })).toBeVisible();
  await expect(member.getByLabel("Local sort order for FAMILY-202")).toHaveValue("-9");
});

test("same-task Remove then Add then proposed Sort keeps all three changes", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(2));
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const row = page.locator(`.admin-candidate-panel tr[data-product-id="${id(101)}"]`);
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  await page.evaluate(async ([memberId, candidateId]) => {
    const remove = document.querySelector<HTMLButtonElement>(
      `.admin-membership-editor [data-product-id="${memberId}"] button`);
    const add = document.querySelector<HTMLButtonElement>(
      `.admin-candidate-panel tr[data-product-id="${candidateId}"] button:last-of-type`);
    if (!remove || !add) throw Error("Missing Remove or Add control");
    remove.click(); add.click();
    // React publishes the proposed row in a microtask of this same browser task.
    await Promise.resolve();
    const input = document.getElementById(`proposed-sort-${candidateId}`) as HTMLInputElement | null;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!input || !setter) throw Error("Missing proposed sort control");
    setter.call(input, "-3");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, [id(202), id(101)]);
  await expect(member.locator(`[data-product-id="${id(202)}"]`)
    .getByRole("button", { name: "Restore locally" })).toBeVisible();
  await expect(member.locator(`[data-proposed-product-id="${id(101)}"]`)).toBeVisible();
  await expect(member.getByLabel("Local sort order for proposed FAMILY-101")).toHaveValue("-3");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
});

test("same-task Cancel cannot reuse an old check; Add then Cancel and a new product keep ordered state", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(2));
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const row101 = page.locator(`.admin-candidate-panel tr[data-product-id="${id(101)}"]`);
  const row102 = page.locator(`.admin-candidate-panel tr[data-product-id="${id(102)}"]`);
  await row102.getByRole("button", { name: "Verify Membership" }).click();
  await row102.getByRole("button", { name: "Add to Draft" }).click();
  await expect(member.locator(`[data-proposed-product-id="${id(102)}"]`)).toBeVisible();
  await row101.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row101.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  await page.evaluate(([firstId, secondId]) => {
    const cancel = document.querySelector<HTMLButtonElement>(
      `.admin-membership-proposed [data-proposed-product-id="${secondId}"] button`);
    const add = document.querySelector<HTMLButtonElement>(
      `.admin-candidate-panel tr[data-product-id="${firstId}"] button:last-of-type`);
    if (!cancel || !add) throw Error("Missing Cancel or Add control");
    cancel.click(); add.click();
  }, [id(101), id(102)]);
  await expect(member.locator("[data-proposed-product-id]")).toHaveCount(0);
  await expect(member.getByText("No membership changes")).toBeVisible();
  await row102.getByRole("button", { name: "Verify Membership" }).click();
  await row102.getByRole("button", { name: "Add to Draft" }).click();
  await row101.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row101.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  await page.evaluate(([firstId, secondId]) => {
    const add = document.querySelector<HTMLButtonElement>(
      `.admin-candidate-panel tr[data-product-id="${firstId}"] button:last-of-type`);
    const cancel = document.querySelector<HTMLButtonElement>(
      `.admin-membership-proposed [data-proposed-product-id="${secondId}"] button`);
    if (!add || !cancel) throw Error("Missing Add or Cancel control");
    add.click(); cancel.click();
  }, [id(101), id(102)]);
  await expect(member.locator(`[data-proposed-product-id="${id(101)}"]`)).toBeVisible();
  await expect(member.locator(`[data-proposed-product-id="${id(102)}"]`)).toHaveCount(0);
  await row102.getByRole("button", { name: "Verify Membership" }).click();
  await row102.getByRole("button", { name: "Add to Draft" }).click();
  await expect(member.locator("[data-proposed-product-id]")).toHaveCount(2);
});

test("candidate Add remains unavailable for MEMBER and failed exact checks", async ({ page, context }) => {
  for (const [source, expected] of [
    ["collections", "Member (exact GET check)"],
    ["collections-check-not-connected", "Verification Not Connected"],
    ["collections-check-error", "Verification Error"],
    ["collections-check-incomplete", "Verification Incomplete"],
  ] as const) {
    await fixtureCookies(context, source);
    await page.goto(detailUrl(source === "collections" ? 1 : 2));
    const candidates = page.getByRole("region", { name: "Candidate product search" });
    if (source === "collections") {
      await candidates.getByRole("searchbox").fill("FAMILY-130");
      await candidates.getByRole("button", { name: "Search candidates" }).click();
      await expect(page).toHaveURL(/candidate_q=FAMILY-130/);
    }
    const row = candidates.locator(`tr[data-product-id="${id(source === "collections" ? 130 : 101)}"]`);
    await row.getByRole("button", { name: "Verify Membership" }).click();
    await expect(row).toContainText(expected);
    await expect(row.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
  }
});

test("Add rechecks monotonic expiry when the browser delays the display timer", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.clock.install();
  await page.goto(detailUrl(2));
  await page.evaluate(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      typeof handler === "function" && timeout !== undefined && timeout > 29_000 && timeout <= 30_000
        ? original(() => {}, 120_000) : original(handler, timeout, ...args)) as typeof window.setTimeout;
  });
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const row = candidates.locator(`tr[data-product-id="${id(101)}"]`);
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  await page.clock.fastForward(30_001);
  await row.getByRole("button", { name: "Add to Draft" }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(candidates).toContainText("Verification expired or changed");
  await expect(member.getByText("No membership changes")).toBeVisible();
  await expect(member.locator("[data-proposed-product-id]")).toHaveCount(0);
});

test("proposed add persists through candidate navigation and Discard preserves basic draft", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(2));
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  const row = candidates.locator(`tr[data-product-id="${id(101)}"]`);
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Basic is independent");
  await member.locator(`[data-product-id="${id(202)}"]`).getByRole("button", { name: "Remove locally" }).click();
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await row.getByRole("button", { name: "Add to Draft" }).click();
  await expect(row).toContainText("Draft Added");
  await candidates.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/candidate_cursor=/);
  await expect(member.locator(`[data-proposed-product-id="${id(101)}"]`)).toBeVisible();
  await candidates.getByRole("button", { name: "Previous" }).click();
  await expect(page).toHaveURL(/candidate_direction=before/);
  await expect(row).toContainText("Draft Added");
  await candidates.getByLabel("Product status").selectOption("draft");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(page).toHaveURL(/candidate_status=draft/);
  await expect(member.locator(`[data-proposed-product-id="${id(101)}"]`)).toBeVisible();
  await member.getByRole("button", { name: "Discard membership changes" }).click();
  await expect(member.locator("[data-proposed-product-id]")).toHaveCount(0);
  await expect(member.getByText("No membership changes")).toBeVisible();
  await expect(member.locator(`[data-product-id="${id(202)}"]`).getByRole("button", { name: "Remove locally" })).toBeVisible();
  await expect(basic.getByLabel("English name")).toHaveValue("Basic is independent");
  await candidates.getByRole("button", { name: "Clear candidate filters" }).click();
  await expect(row).toContainText("Membership Not Verified");
  await expect(row.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
});

test("an unobserved existing member is verified by exact GET without changing its local label", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  await candidates.getByRole("searchbox").fill("FAMILY-130");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  const row = candidates.locator(`tr[data-product-id="${id(130)}"]`);
  await expect(row).toContainText("Membership Not Verified");
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row).toContainText("Member (exact GET check)");
  await expect(row).toContainText("Membership Not Verified");
});

test("exact GET reports each source failure and rejects malformed responses", async ({ page, context }) => {
  const cases = [
    ["collections-check-not-connected", "Verification Not Connected"],
    ["collections-check-error", "Verification Error"],
    ["collections-check-incomplete", "Verification Incomplete"],
    ["collections-check-bad-dto", "Verification Error — no trusted result"],
    ["collections-check-extra-dto", "Verification Error — no trusted result"],
    ["collections-check-non-json", "Verification Error — no trusted result"],
  ] as const;
  for (const [fixture, label] of cases) {
    await fixtureCookies(context, fixture);
    await page.goto(detailUrl(2));
    const row = page.getByRole("region", { name: "Candidate product search" })
      .locator(`tr[data-product-id="${id(101)}"]`);
    await row.getByRole("button", { name: "Verify Membership" }).click();
    await expect(row).toContainText(label);
    await expect(row).toContainText("Membership Not Verified");
  }
});

test("delayed verification is cancelled on query change and expires automatically", async ({ page, context }) => {
  await fixtureCookies(context, "collections-check-delay");
  await page.clock.install();
  await page.goto(detailUrl(2));
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const row = candidates.locator(`tr[data-product-id="${id(101)}"]`);
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row).toContainText("Verifying…");
  await expect(row.getByRole("button", { name: "Verify Membership" })).toBeDisabled();
  await candidates.getByRole("searchbox").fill("FAMILY-102");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(page).toHaveURL(/candidate_q=FAMILY-102/);
  await expect(candidates).not.toContainText("Verifying…");
  const next = candidates.locator(`tr[data-product-id="${id(102)}"]`);
  await next.getByRole("button", { name: "Verify Membership" }).click();
  await expect(next).toContainText("Not a Member — Verified for this view only");
  await page.clock.fastForward(30_001);
  await expect(next).toContainText("Verification Expired — verify again");
  await expect(next.getByRole("button", { name: "Verify Membership" })).toBeEnabled();
});

test("a throttled expiry timer is corrected on visible resume and window focus", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.clock.install();
  await page.goto(detailUrl(2));
  await page.evaluate(() => {
    const delayed: Array<() => void> = [];
    (window as Window & { delayedVerificationTimers?: Array<() => void> }).delayedVerificationTimers = delayed;
    const originalSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (typeof handler === "function" && timeout !== undefined && timeout > 29_000 && timeout <= 30_000) {
        delayed.push(() => handler(...args));
        return originalSetTimeout(() => {}, 120_000);
      }
      return originalSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout;
  });
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Expiry resume keeps this draft");
  await member.getByRole("button", { name: "Remove locally" }).click();
  const row = candidates.locator(`tr[data-product-id="${id(101)}"]`);
  const verify = row.getByRole("button", { name: "Verify Membership" });
  await verify.click();
  await expect(row).toContainText("Not a Member — Verified for this view only");
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { delayedVerificationTimers?: Array<() => void> }).delayedVerificationTimers?.length ?? 0))
    .toBe(1);
  await verify.click();
  await expect(row).toContainText("Not a Member — Verified for this view only");
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { delayedVerificationTimers?: Array<() => void> }).delayedVerificationTimers?.length ?? 0))
    .toBe(2);
  await page.evaluate(() =>
    (window as Window & { delayedVerificationTimers?: Array<() => void> }).delayedVerificationTimers?.[0]?.());
  await expect(row).toContainText("Not a Member — Verified for this view only");
  await page.clock.fastForward(30_001);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  // The Shell now synchronously locks Catalog access on resume, which revokes
  // the old check even before its delayed expiry callback runs.
  await expect(row).toContainText("Not Verified");
  await expect(row).not.toContainText("Not a Member — Verified for this view only");
  await expect(row.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
  await verify.click();
  await expect(row).toContainText("Not a Member — Verified for this view only");
  await page.clock.fastForward(30_001);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(row).toContainText("Not Verified");
  await expect(row).not.toContainText("Not a Member — Verified for this view only");
  await expect(row.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
  await expect(basic.getByLabel("English name")).toHaveValue("Expiry resume keeps this draft");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
});

test("a late old response cannot replace the newer product verification", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(2));
  let releaseOld!: () => void;
  let oldReceived!: () => void;
  let oldHandled!: () => void;
  const received = new Promise<void>((resolve) => { oldReceived = resolve; });
  const handled = new Promise<void>((resolve) => { oldHandled = resolve; });
  await page.route("**/membership-check?productId=*", async (route) => {
    const productId = new URL(route.request().url()).searchParams.get("productId");
    if (productId === id(101)) {
      oldReceived();
      await new Promise<void>((resolve) => { releaseOld = resolve; });
    }
    try {
      await route.fulfill({ status: 200, contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify({ collectionId: id(2), productId,
          status: "NOT_MEMBER", origin: "OFFLINE_FIXTURE" }) });
    } catch { /* An aborted old request is an expected outcome. */ }
    if (productId === id(101)) oldHandled();
  });
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const first = candidates.locator(`tr[data-product-id="${id(101)}"]`);
  const second = candidates.locator(`tr[data-product-id="${id(102)}"]`);
  await first.getByRole("button", { name: "Verify Membership" }).click();
  await received;
  await expect(first).toContainText("Verifying…");
  await second.getByRole("button", { name: "Verify Membership" }).click();
  await expect(second).toContainText("Not a Member — Verified for this view only");
  releaseOld();
  await handled;
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(second).toContainText("Not a Member — Verified for this view only");
  await expect(first).not.toContainText("Not a Member — Verified for this view only");
});

test("both local drafts survive Verify and browser history does not restore an old check", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(2));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Basic remains dirty");
  await member.getByRole("button", { name: "Remove locally" }).click();
  const row = candidates.locator(`tr[data-product-id="${id(101)}"]`);
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row).toContainText("Not a Member — Verified for this view only");
  await expect(basic.getByLabel("English name")).toHaveValue("Basic remains dirty");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  await candidates.getByRole("searchbox").fill("FAMILY-102");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(page).toHaveURL(/candidate_q=FAMILY-102/);
  await page.goBack();
  await expect(page).not.toHaveURL(/candidate_q=FAMILY-102/);
  await expect(row).toContainText("Not Verified");
  await expect(row).not.toContainText("Not a Member — Verified for this view only");
  await expect(basic.getByLabel("English name")).toHaveValue("Basic remains dirty");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/candidate_q=FAMILY-102/);
  await expect(candidates).not.toContainText("Not a Member — Verified for this view only");
  page.once("dialog", async (dialog) => { await dialog.accept(); });
  await page.goto(detailUrl(1));
  await expect(candidates).not.toContainText("Not a Member — Verified for this view only");
});

test("status filtering and candidate pagination invalidate an exact check", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(2));
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const row101 = candidates.locator(`tr[data-product-id="${id(101)}"]`);
  await row101.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row101).toContainText("Not a Member — Verified for this view only");
  await candidates.getByLabel("Product status").selectOption("draft");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(page).toHaveURL(/candidate_status=draft/);
  await expect(candidates).not.toContainText("Not a Member — Verified for this view only");
  await candidates.getByRole("button", { name: "Clear candidate filters" }).click();
  await expect(page).not.toHaveURL(/candidate_status=/);
  await row101.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row101).toContainText("Not a Member — Verified for this view only");
  await candidates.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/candidate_cursor=/);
  await expect(candidates).not.toContainText("Not a Member — Verified for this view only");
  await candidates.getByRole("button", { name: "Previous" }).click();
  await expect(page).toHaveURL(/candidate_direction=before/);
  await expect(row101).toBeVisible();
  await expect(row101).toContainText("Not Verified");
  await expect(row101).not.toContainText("Not a Member — Verified for this view only");
});

test("candidate membership labels follow the single local draft across navigation", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(detailUrl(1));
  const editors = page.getByTestId("collection-editors");
  const candidates = editors.getByRole("region", { name: "Candidate product search" });
  const member = editors.getByRole("region", { name: "Local collection membership editor" });
  const basic = editors.getByRole("region", { name: "Local collection basic editor" });
  const candidateRow = (n: number) => candidates.locator(`tr[data-product-id="${id(n)}"]`);
  const memberRow = member.locator(`[data-product-id="${id(101)}"]`);
  await expect(candidateRow(101)).toContainText("Already in Collection");
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Basic only marker check");
  await expect(candidateRow(101)).toContainText("Already in Collection");
  await memberRow.getByRole("button", { name: "Remove locally" }).click();
  await expect(candidateRow(101)).toContainText("Pending Removal");
  await memberRow.getByRole("button", { name: "Restore locally" }).click();
  await expect(candidateRow(101)).toContainText("Already in Collection");
  await memberRow.getByRole("button", { name: "Remove locally" }).click();
  await member.getByRole("button", { name: "Discard membership changes" }).click();
  await expect(candidateRow(101)).toContainText("Already in Collection");
  await memberRow.getByLabel("Local sort order for FAMILY-101").fill("-5");
  await candidates.getByRole("searchbox").fill("FAMILY-101");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(page).toHaveURL(/candidate_q=FAMILY-101/);
  await expect(candidateRow(101)).toContainText("Already in Collection");
  await expect(basic.getByLabel("English name")).toHaveValue("Basic only marker check");
  await candidates.getByLabel("Product status").selectOption("draft");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(page).toHaveURL(/candidate_status=draft/);
  await expect(candidateRow(101)).toContainText("Already in Collection");
  await candidates.getByRole("button", { name: "Clear candidate filters" }).click();
  await expect(page).not.toHaveURL(/candidate_q=|candidate_status=/);
  await candidates.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/candidate_cursor=/);
  await expect(candidateRow(130)).toContainText("Membership Not Verified");
  page.once("dialog", async (dialog) => { await dialog.accept(); });
  await page.getByRole("navigation", { name: "Collection member pages" }).getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/[?&]cursor=/);
  await expect(candidateRow(130)).toContainText("Already in Collection");
  await expect(basic.getByLabel("English name")).toHaveValue("Basic only marker check");
  await candidates.getByRole("button", { name: "Previous" }).click();
  await expect(candidateRow(101)).toContainText("Already in Collection");
  await basic.getByRole("button", { name: "Discard changes" }).click();
  await member.getByRole("button", { name: "Discard membership changes" }).click();
  await expect.poll(() => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(false);
  await page.goto(detailUrl(2));
  await expect(editors).toHaveAttribute("data-collection-id", id(2));
  await expect(candidateRow(101)).toContainText("Membership Not Verified");
  expect(writes).toEqual([]);
});

test("candidate navigation preserves both local drafts and member cursor independently", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Unsaved basic candidate search");
  await member.locator(`[data-product-id="${id(101)}"]`).getByRole("button", { name: "Remove locally" }).click();
  await candidates.getByRole("searchbox").fill("Candidate");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(basic.getByLabel("English name")).toHaveValue("Unsaved basic candidate search");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  await candidates.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/candidate_cursor=/);
  await expect(basic.getByLabel("English name")).toHaveValue("Unsaved basic candidate search");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  page.once("dialog", async (dialog) => { await dialog.accept(); });
  await page.getByRole("navigation", { name: "Collection member pages" }).getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(page).toHaveURL(/candidate_cursor=/);
  await expect(candidates.getByRole("searchbox")).toHaveValue("Candidate");
  await expect(basic.getByLabel("English name")).toHaveValue("Unsaved basic candidate search");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  await candidates.getByLabel("Product status").selectOption("draft");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(page).not.toHaveURL(/candidate_cursor=/);
  await expect(page).toHaveURL(/[?&]cursor=/);
  await candidates.getByRole("button", { name: "Clear candidate filters" }).click();
  await expect(page).toHaveURL(/[?&]cursor=/);
  await expect(basic.getByLabel("English name")).toHaveValue("Unsaved basic candidate search");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  await fixtureCookies(context, "collections-candidates-not-connected");
  await candidates.getByRole("searchbox").fill("new query");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(candidates).toContainText("Product database not connected");
  await expect(basic.getByLabel("English name")).toHaveValue("Unsaved basic candidate search");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(true);
});

test("individual drafts survive candidate navigation and URL history restores filters", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const search = candidates.getByRole("searchbox");
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Basic only local change");
  await search.fill("Candidate 101");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(basic.getByLabel("English name")).toHaveValue("Basic only local change");
  await expect(member.getByText("No membership changes")).toBeVisible();
  await basic.getByRole("button", { name: "Discard changes" }).click();
  await member.locator(`[data-product-id="${id(101)}"]`).getByRole("button", { name: "Remove locally" }).click();
  await search.fill("Candidate 102");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  await expect(basic.getByText("No local changes")).toBeVisible();
  await member.getByRole("button", { name: "Discard membership changes" }).click();
  await candidates.getByLabel("Product status").selectOption("draft");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(page).toHaveURL(/candidate_status=draft/);
  await page.goBack();
  await expect(candidates.getByRole("searchbox")).toHaveValue("Candidate 102");
  await expect(candidates.getByLabel("Product status")).toHaveValue("all");
  await page.goForward();
  await expect(candidates.getByLabel("Product status")).toHaveValue("draft");
  await page.reload();
  await expect(candidates.getByLabel("Product status")).toHaveValue("draft");
  await expect(member.getByText("No membership changes")).toBeVisible();
});

test("candidate navigation locks edits until commit and preserves ordered URL history", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const search = candidates.getByRole("searchbox");
  const submit = candidates.getByRole("button", { name: "Search candidates" });
  const status = candidates.getByLabel("Product status");
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Unsaved while searching");
  await member.locator(`[data-product-id="${id(101)}"]`).getByRole("button", { name: "Remove locally" }).click();

  const requests: string[] = [];
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.method());
    const url = new URL(request.url());
    if (url.pathname === `/admin/collections/${id(1)}` && url.searchParams.has("_rsc")) {
      requests.push(`${url.searchParams.get("candidate_q") ?? ""}:${url.searchParams.get("candidate_status") ?? "all"}`);
    }
  });
  let releaseFirst!: () => void;
  const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let observeFirst!: () => void;
  const firstObserved = new Promise<void>((resolve) => { observeFirst = resolve; });
  await page.route("**/admin/collections/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/admin/collections/${id(1)}` &&
      url.searchParams.get("candidate_q") === "Candidate 101" && url.searchParams.has("_rsc")) {
      observeFirst();
      await firstHeld;
    }
    await route.continue();
  });
  try {
    await search.fill("Candidate 101");
    await submit.click();
    await firstObserved;
    await expect(search).toBeDisabled();
    await expect(status).toBeDisabled();
    await expect(submit).toBeDisabled();
    await expect(candidates.locator(".admin-candidate-state").first())
      .toContainText("Search controls are unavailable until navigation completes");
    expect(requests).not.toContain("Candidate 102:all");
  } finally { releaseFirst(); }
  await expect(page).toHaveURL(/candidate_q=Candidate\+101/);
  await expect(search).toBeEnabled();
  await search.fill("Candidate 102");
  await submit.click();
  await expect(page).toHaveURL(/candidate_q=Candidate\+102/);
  await expect(search).toHaveValue("Candidate 102");
  await status.selectOption("draft");
  await submit.click();
  await expect(page).toHaveURL(/candidate_q=Candidate\+102&candidate_status=draft/);
  await expect(status).toHaveValue("draft");
  await expect(basic.getByLabel("English name")).toHaveValue("Unsaved while searching");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  await basic.getByRole("button", { name: "Discard changes" }).click();
  await member.getByRole("button", { name: "Discard membership changes" }).click();
  await page.goBack();
  await expect(page).toHaveURL(/candidate_q=Candidate\+102(?:&|$)/);
  await expect(page).not.toHaveURL(/candidate_status=draft/);
  await expect(search).toHaveValue("Candidate 102");
  await page.goForward();
  await expect(page).toHaveURL(/candidate_status=draft/);
  await expect(search).toHaveValue("Candidate 102");
  await expect(status).toHaveValue("draft");
  await expect(basic.getByText("No local changes")).toBeVisible();
  await expect(member.getByText("No membership changes")).toBeVisible();
  expect(requests).toEqual(expect.arrayContaining([
    "Candidate 101:all", "Candidate 102:all", "Candidate 102:draft"]));
  expect(requests.indexOf("Candidate 101:all")).toBeLessThan(requests.indexOf("Candidate 102:all"));
  expect(requests.indexOf("Candidate 102:all")).toBeLessThan(requests.indexOf("Candidate 102:draft"));
  expect(writes).toEqual([]);
});

test("candidate navigation remains locked while member pagination supersedes its held request", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const search = candidates.getByRole("searchbox");
  const submit = candidates.getByRole("button", { name: "Search candidates" });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let observed!: () => void;
  const requested = new Promise<void>((resolve) => { observed = resolve; });
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === `/admin/collections/${id(1)}` && url.searchParams.has("_rsc"))
      requests.push(`${url.searchParams.get("candidate_q") ?? ""}:${url.searchParams.has("cursor")}`);
  });
  await page.route("**/admin/collections/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/admin/collections/${id(1)}` &&
      url.searchParams.get("candidate_q") === "Candidate 101" && url.searchParams.has("_rsc")) {
      observed();
      await held;
    }
    await route.continue();
  });
  try {
    await search.fill("Candidate 101");
    await submit.click();
    await requested;
    await expect(submit).toBeDisabled();
    await page.getByRole("navigation", { name: "Collection member pages" })
      .getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/cursor=/);
    expect(requests).toContain("Candidate 101:false");
    await expect(submit).toBeDisabled();
    await expect(search).toHaveValue("Candidate 101");
    await candidates.getByRole("button", { name: "Resume editing this search" }).click();
    await search.fill("Candidate 102");
    release();
    await expect(page).toHaveURL((url) => url.searchParams.has("cursor") &&
      !url.searchParams.has("candidate_q"));
    await expect(search).toHaveValue("Candidate 102");
    await submit.click();
    await expect(page).toHaveURL((url) => url.searchParams.get("candidate_q") === "Candidate 102" &&
      url.searchParams.has("cursor"));
    await expect(search).toHaveValue("Candidate 102");
    expect(requests).toContain("Candidate 102:true");
    await expect(page).toHaveURL((url) => url.searchParams.get("candidate_q") === "Candidate 102");
    await expect(search).toHaveValue("Candidate 102");
  } finally { release(); }
});

test("stalled candidate navigation allows explicit recovery without losing the next search", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const form = candidates.getByRole("search");
  const search = candidates.getByRole("searchbox");
  const submit = candidates.getByRole("button", { name: "Search candidates" });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let observed!: () => void;
  const requested = new Promise<void>((resolve) => { observed = resolve; });
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === `/admin/collections/${id(1)}` && url.searchParams.has("_rsc"))
      requests.push(url.searchParams.get("candidate_q") ?? "");
  });
  await page.route("**/admin/collections/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/admin/collections/${id(1)}` &&
      url.searchParams.get("candidate_q") === "Candidate 101" && url.searchParams.has("_rsc")) {
      observed();
      await held;
    }
    await route.continue();
  });
  try {
    await search.fill("Candidate 101");
    await submit.click();
    await requested;
    await expect(form).toHaveAttribute("data-navigation-attempt", "1");
    await expect(submit).toBeDisabled();
    await expect(page).not.toHaveURL(/candidate_q=/);
    await candidates.getByRole("button", { name: "Resume editing this search" }).click();
    await expect(submit).toBeEnabled();
    await expect(search).toBeFocused();
    await search.fill("Candidate 102");
    release();
    await expect(page).toHaveURL((url) => url.searchParams.get("candidate_q") === "Candidate 101");
    await expect(search).toHaveValue("Candidate 102");
    await expect(candidates).toContainText("Your unsubmitted search is preserved");
    await submit.click();
    await expect(page).toHaveURL((url) => url.searchParams.get("candidate_q") === "Candidate 102");
    await expect(search).toHaveValue("Candidate 102");
    await expect(search).toHaveValue("Candidate 102");
    expect(requests).toEqual(expect.arrayContaining(["Candidate 101", "Candidate 102"]));
  } finally { release(); }
});

test("resumed unsubmitted candidate filters survive member pages and history", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const form = candidates.getByRole("search");
  const search = candidates.getByRole("searchbox");
  const status = candidates.getByRole("combobox", { name: "Product status" });
  const submit = candidates.getByRole("button", { name: "Search candidates" });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let observed!: () => void;
  const requested = new Promise<void>((resolve) => { observed = resolve; });
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === `/admin/collections/${id(1)}` && url.searchParams.has("_rsc"))
      requests.push(`${url.searchParams.get("candidate_q") ?? ""}:${url.searchParams.has("cursor")}`);
  });
  await page.route("**/admin/collections/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/admin/collections/${id(1)}` &&
      url.searchParams.get("candidate_q") === "Candidate 101" && url.searchParams.has("_rsc")) {
      observed();
      await held;
    }
    await route.continue();
  });
  try {
    const startHistory = await page.evaluate(() => history.length);
    await search.fill("Candidate 101");
    await submit.click();
    await requested;
    await expect(form).toHaveAttribute("data-navigation-phase", "PENDING");
    await candidates.getByRole("button", { name: "Resume editing this search" }).click();
    await expect(search).toBeFocused();
    await search.fill("Candidate 102");
    await status.selectOption("draft");
    await page.getByRole("navigation", { name: "Collection member pages" })
      .getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.has("cursor") &&
      !url.searchParams.has("candidate_q"));
    await expect(form).toHaveAttribute("data-navigation-phase", "IDLE");
    await expect(search).toHaveValue("Candidate 102");
    await expect(status).toHaveValue("draft");
    await expect(candidates).toContainText("Results reflect your last submitted search");
    expect(await page.evaluate(() => history.length)).toBe(startHistory + 1);
    release();
    await expect(search).toHaveValue("Candidate 102");
    await page.goBack();
    await expect(page).toHaveURL((url) => !url.searchParams.has("cursor"));
    await expect(search).toHaveValue("Candidate 102");
    await expect(status).toHaveValue("draft");
    await page.goForward();
    await expect(page).toHaveURL((url) => url.searchParams.has("cursor"));
    await expect(search).toHaveValue("Candidate 102");
    await submit.click();
    await expect(page).toHaveURL((url) => url.searchParams.get("candidate_q") === "Candidate 102" &&
      url.searchParams.get("candidate_status") === "draft" && url.searchParams.has("cursor"));
    await expect(search).toHaveValue("Candidate 102");
    expect(await page.evaluate(() => history.length)).toBe(startHistory + 2);
    expect(requests).toEqual(expect.arrayContaining(["Candidate 101:false", ":true", "Candidate 102:true"]));
  } finally { release(); }
});

test("candidate history preserves unsubmitted edits while the URL changes", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${detailUrl(1)}?candidate_q=Candidate+101`);
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const search = candidates.getByRole("searchbox");
  const submit = candidates.getByRole("button", { name: "Search candidates" });
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === `/admin/collections/${id(1)}` && url.searchParams.has("_rsc"))
      requests.push(url.searchParams.get("candidate_q") ?? "");
  });
  await search.fill("Candidate 102");
  await submit.click();
  await expect(page).toHaveURL((url) => url.searchParams.get("candidate_q") === "Candidate 102");
  await search.fill("Candidate 103");
  const historyLength = await page.evaluate(() => history.length);
  await page.goBack();
  await expect(page).toHaveURL((url) => url.searchParams.get("candidate_q") === "Candidate 101");
  await expect(search).toHaveValue("Candidate 103");
  await expect(candidates).toContainText("Results reflect your last submitted search");
  await page.goForward();
  await expect(page).toHaveURL((url) => url.searchParams.get("candidate_q") === "Candidate 102");
  await expect(search).toHaveValue("Candidate 103");
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await submit.click();
  await expect(page).toHaveURL((url) => url.searchParams.get("candidate_q") === "Candidate 103");
  await expect(search).toHaveValue("Candidate 103");
  expect(requests).toEqual(expect.arrayContaining(["Candidate 102", "Candidate 103"]));
});

test("clear discards unsubmitted candidate filters when the URL is already clear", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const search = candidates.getByRole("searchbox");
  const status = candidates.getByRole("combobox", { name: "Product status" });
  const before = await page.evaluate(() => history.length);
  await search.fill("Candidate 102");
  await status.selectOption("draft");
  await candidates.getByRole("button", { name: "Clear candidate filters" }).click();
  await expect(search).toHaveValue("");
  await expect(status).toHaveValue("all");
  await expect(page).toHaveURL((url) => !url.searchParams.has("candidate_q") &&
    !url.searchParams.has("candidate_status"));
  expect(await page.evaluate(() => history.length)).toBe(before);
});

test("candidate pagination keeps unsubmitted filters visibly distinct from its server query", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const search = candidates.getByRole("searchbox");
  const status = candidates.getByRole("combobox", { name: "Product status" });
  const notice = candidates.getByRole("alert").filter({ hasText: "Results reflect your last submitted search" });
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === `/admin/collections/${id(1)}` && url.searchParams.has("_rsc"))
      requests.push(`${url.searchParams.get("candidate_q") ?? ""}:${url.searchParams.get("candidate_status") ?? "all"}`);
  });
  const initialHistory = await page.evaluate(() => history.length);
  await search.fill("Candidate 102");
  await status.selectOption("draft");
  await expect(notice).toHaveCount(0);
  await candidates.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL((url) => url.searchParams.has("candidate_cursor") &&
    !url.searchParams.has("candidate_q") && !url.searchParams.has("candidate_status"));
  await expect(search).toHaveValue("Candidate 102");
  await expect(status).toHaveValue("draft");
  await expect(notice).toBeVisible();
  await expect(candidates.getByText("Current query page", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(initialHistory + 1);
  await candidates.getByRole("button", { name: "Previous" }).click();
  await expect(page).toHaveURL((url) => !url.searchParams.has("candidate_q") &&
    !url.searchParams.has("candidate_status"));
  await expect(search).toHaveValue("Candidate 102");
  await expect(notice).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(initialHistory + 2);
  await page.goBack();
  await expect(search).toHaveValue("Candidate 102");
  await expect(notice).toBeVisible();
  await page.goForward();
  await expect(search).toHaveValue("Candidate 102");
  await expect(notice).toBeVisible();
  await search.fill("");
  await status.selectOption("all");
  await expect(notice).toHaveCount(0);
  await search.fill("Candidate 102");
  await status.selectOption("draft");
  await expect(notice).toHaveCount(0);
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("candidate_q") === "Candidate 102" &&
    url.searchParams.get("candidate_status") === "draft" && !url.searchParams.has("candidate_cursor"));
  await expect(notice).toHaveCount(0);
  expect(requests).toEqual(expect.arrayContaining([":all", "Candidate 102:draft"]));
  await candidates.getByRole("button", { name: "Clear candidate filters" }).click();
  await expect(page).toHaveURL((url) => !url.searchParams.has("candidate_q") &&
    !url.searchParams.has("candidate_status") && !url.searchParams.has("candidate_cursor"));
  await expect(search).toHaveValue("");
  await expect(status).toHaveValue("all");
  await expect(notice).toHaveCount(0);
});

test("same candidate URL and alternate space encoding do not create a pending navigation", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${detailUrl(1)}?candidate_q=Candidate%20101`);
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const form = candidates.getByRole("search");
  const search = candidates.getByRole("searchbox");
  const before = await page.evaluate(() => history.length);
  await expect(search).toHaveValue("Candidate 101");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(form).toHaveAttribute("data-navigation-phase", "IDLE");
  await expect(search).toBeEnabled();
  expect(await page.evaluate(() => history.length)).toBe(before);
});

test("failed candidate request can be recovered without a permanent search lock", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const form = candidates.getByRole("search");
  const search = candidates.getByRole("searchbox");
  await page.route("**/admin/collections/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/admin/collections/${id(1)}` &&
      url.searchParams.get("candidate_q") === "Candidate 101" && url.searchParams.has("_rsc")) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await search.fill("Candidate 101");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect.poll(async () => form.getAttribute("data-navigation-phase"))
    .toMatch(/^(IDLE|RECOVERABLE)$/);
  if (await form.getAttribute("data-navigation-phase") === "RECOVERABLE")
    await candidates.getByRole("button", { name: "Resume editing this search" }).click();
  await expect(search).toBeEnabled();
  await expect(search).toHaveValue("Candidate 101");
});

test("invalid and cross-query candidate cursors stay explicit; source states stay isolated", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${detailUrl(1)}?candidate_cursor=invalid`);
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  await expect(candidates).toContainText("Candidate cursor is invalid");
  await expect(page.getByRole("region", { name: "Associated products" }).getByText("FAMILY-101")).toBeVisible();
  await page.goto(detailUrl(1));
  await candidates.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/candidate_cursor=/);
  const signed = new URL(page.url()).searchParams.get("candidate_cursor");
  expect(signed).toBeTruthy();
  await page.goto(`${detailUrl(1)}?candidate_q=other&candidate_cursor=${encodeURIComponent(signed!)}`);
  await expect(candidates).toContainText("Candidate cursor is invalid");
  for (const [fixture, message] of [["collections-candidates-not-connected", "Product database not connected"],
    ["collections-candidates-error", "Candidate products could not be read"],
    ["collections-candidates-incomplete", "Candidate page could not be verified"]] as const) {
    await fixtureCookies(context, fixture);
    await page.goto(detailUrl(1));
    await expect(candidates).toContainText(message);
    await expect(candidates.locator("tbody tr")).toHaveCount(0);
    await expect(page.getByText("private://candidate-source-secret")).toHaveCount(0);
  }
});

test("candidate search remains keyboard usable on mobile without private fields", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(detailUrl(1));
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const search = candidates.getByRole("searchbox");
  await search.focus();
  await expect(search).toBeFocused();
  await search.fill("FAMILY-101");
  await page.keyboard.press("Enter");
  await expect(candidates.getByText("FAMILY-101", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(candidates).not.toContainText("storage_key");
});

test("invalid member cursor survives candidate search and filtering until member recovery", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${detailUrl(1)}?cursor=bad&candidate_q=old`);
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await expect(page.getByText("Invalid member cursor")).toBeVisible();
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Keep this local draft");
  await candidates.getByRole("searchbox").fill("Candidate 101");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(page).toHaveURL(/[?&]cursor=bad(?:&|$)/);
  await expect(candidates).toContainText("Search: Candidate 101");
  await expect(page.getByText("Invalid member cursor")).toBeVisible();
  await expect(basic.getByLabel("English name")).toHaveValue("Keep this local draft");
  await candidates.getByLabel("Product status").selectOption("draft");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(page).toHaveURL(/[?&]cursor=bad(?:&|$)/);
  await expect(page).toHaveURL(/candidate_status=draft/);
  await expect(page.getByText("Invalid member cursor")).toBeVisible();
  page.once("dialog", async (dialog) => { await dialog.accept(); });
  const recover = page.getByRole("link", { name: "First member page" });
  await recover.focus();
  await expect(recover).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/[?&]cursor=bad(?:&|$)/);
  await expect(page).toHaveURL(/candidate_status=draft/);
  await expect(page.getByText("Invalid member cursor")).toHaveCount(0);
  await expect(basic.getByLabel("English name")).toHaveValue("Keep this local draft");
});

test("invalid candidate cursor survives member Next and Previous while both drafts remain dirty", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${detailUrl(1)}?candidate_cursor=bad`);
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  await expect(candidates).toContainText("Candidate cursor is invalid");
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Both drafts remain");
  await member.locator(`[data-product-id="${id(101)}"]`).getByRole("button", { name: "Remove locally" }).click();
  const memberPages = page.getByRole("navigation", { name: "Collection member pages" });
  page.once("dialog", async (dialog) => { await dialog.accept(); });
  await memberPages.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/candidate_cursor=bad/);
  await expect(candidates).toContainText("Candidate cursor is invalid");
  await expect(basic.getByLabel("English name")).toHaveValue("Both drafts remain");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  page.once("dialog", async (dialog) => { await dialog.accept(); });
  await memberPages.getByRole("link", { name: "Previous" }).click();
  await expect(page).toHaveURL(/candidate_cursor=bad/);
  await expect(candidates).toContainText("Candidate cursor is invalid");
  await page.goBack();
  await expect(candidates).toContainText("Candidate cursor is invalid");
  await page.goForward();
  await expect(candidates).toContainText("Candidate cursor is invalid");
  await expect(basic.getByLabel("English name")).toHaveValue("Both drafts remain");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  const recover = candidates.getByRole("button", { name: "First candidate page" });
  await recover.focus();
  await expect(recover).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/candidate_cursor=bad/);
  await expect(candidates).toContainText("Current query page");
  await expect(basic.getByLabel("English name")).toHaveValue("Both drafts remain");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
});

test("two invalid cursors recover separately and malformed query keeps its own error", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${detailUrl(1)}?cursor=bad&candidate_cursor=bad`);
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  await expect(page.getByText("Invalid member cursor")).toBeVisible();
  await expect(candidates).toContainText("Candidate cursor is invalid");
  await candidates.getByRole("button", { name: "First candidate page" }).click();
  await expect(page).toHaveURL(/[?&]cursor=bad(?:&|$)/);
  await expect(page.getByText("Invalid member cursor")).toBeVisible();
  await expect(candidates).not.toContainText("Candidate cursor is invalid");
  await page.goto(`${detailUrl(1)}?cursor=bad&candidate_cursor=bad`);
  await page.getByRole("link", { name: "First member page" }).click();
  await expect(page).toHaveURL(/candidate_cursor=bad/);
  await expect(candidates).toContainText("Candidate cursor is invalid");
  await expect(page.getByText("Invalid member cursor")).toHaveCount(0);
  for (const suffix of ["candidate_status=bogus&candidate_cursor=a.b",
    "candidate_q=%00&candidate_cursor=bad", "candidate_q=one&candidate_q=two&cursor=bad"]) {
    await page.goto(`${detailUrl(1)}?${suffix}`);
    await expect(candidates).toContainText("Candidate search or status is invalid");
    if (suffix.split("&").includes("cursor=bad"))
      await expect(page.getByText("Invalid member cursor")).toBeVisible();
  }
});

test("unsupported URL parameters have explicit recovery without changing either cursor", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  const candidates = page.getByRole("region", { name: "Candidate product search" });
  const unsupported = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: "Unsupported URL parameters" }) });
  await page.goto(`${detailUrl(1)}?unexpected=x&unexpected=y&other=&cursor=bad&candidate_cursor=bad`);
  await expect(unsupported).toBeVisible();
  await expect(page.getByText("Invalid member cursor")).toBeVisible();
  await expect(candidates).toContainText("Candidate cursor is invalid");
  await expect(candidates.locator("tbody tr")).toHaveCount(0);
  const clear = unsupported.getByRole("link", { name: "Clear unsupported parameters" });
  await clear.focus();
  await expect(clear).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(unsupported).toHaveCount(0);
  const cleared = new URL(page.url()).searchParams;
  expect(cleared.has("unexpected")).toBe(false);
  expect(cleared.has("other")).toBe(false);
  expect(cleared.get("cursor")).toBe("bad");
  expect(cleared.get("candidate_cursor")).toBe("bad");
  await expect(page.getByText("Invalid member cursor")).toBeVisible();
  await expect(candidates).toContainText("Candidate cursor is invalid");
  await page.getByRole("link", { name: "First member page" }).click();
  await expect(page.getByText("Invalid member cursor")).toHaveCount(0);
  await expect(candidates).toContainText("Candidate cursor is invalid");
  await candidates.getByRole("button", { name: "First candidate page" }).click();
  await expect(candidates).toContainText("Current query page");
  await candidates.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/candidate_cursor=/);
  const signedCursor = new URL(page.url()).searchParams.get("candidate_cursor");
  expect(signedCursor).toBeTruthy();
  await page.goto(`${detailUrl(1)}?unexpected=x&candidate_cursor=${encodeURIComponent(signedCursor!)}`);
  await expect(unsupported).toBeVisible();
  await expect(page.getByRole("region", { name: "Associated products" })).toContainText("Member read paused by URL parameters");
  await expect(candidates).toContainText("Candidate read paused by URL parameters");
  await expect(page.getByRole("region", { name: "Associated products" })).not.toContainText("Member data incomplete");
  await expect(candidates).not.toContainText("Candidate page could not be verified");
  await expect(candidates.locator("tbody tr")).toHaveCount(0);
  await unsupported.getByRole("link", { name: "Clear unsupported parameters" }).click();
  await expect(page).toHaveURL(/candidate_cursor=/);
  await expect(candidates).toContainText("Current query page");
  await expect(candidates).not.toContainText("Candidate read paused by URL parameters");

  await page.goto(`${detailUrl(1)}?unexpected=x&candidate_q=one&candidate_q=two&candidate_status=bogus`);
  await expect(unsupported).toBeVisible();
  await expect(candidates).toContainText("Candidate search or status is invalid");
  await unsupported.getByRole("link", { name: "Clear unsupported parameters" }).click();
  await expect(unsupported).toHaveCount(0);
  expect(new URL(page.url()).searchParams.getAll("candidate_q")).toEqual(["one", "two"]);
  await expect(candidates).toContainText("Candidate search or status is invalid");

  await page.goto(`${detailUrl(1)}?unsupported=one&cursor=bad&candidate_cursor=bad`);
  await candidates.getByRole("searchbox").fill("Candidate 101");
  await candidates.getByRole("button", { name: "Search candidates" }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("candidate_q") === "Candidate 101" &&
    url.searchParams.get("unsupported") === "one" && url.searchParams.get("cursor") === "bad" &&
    !url.searchParams.has("candidate_cursor"));
  await expect(candidates).toContainText("Candidate read paused by URL parameters");
  await expect(candidates).toContainText("Search: Candidate 101");
  await expect(unsupported).toBeVisible();
  await expect(page).toHaveURL(/[?&]cursor=bad(?:&|$)/);
  await expect(page.getByText("Invalid member cursor")).toBeVisible();
  await page.getByRole("link", { name: "First member page" }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("unsupported") === "one" &&
    url.searchParams.get("candidate_q") === "Candidate 101" && !url.searchParams.has("cursor"));
  await expect(page.getByText("Invalid member cursor")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Associated products" })).toContainText("Member read paused by URL parameters");
  await expect(unsupported).toBeVisible();
  await expect(page).toHaveURL(/[?&]unsupported=one(?:&|$)/);
  await candidates.getByRole("button", { name: "Clear candidate filters" }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("unsupported") === "one" &&
    !url.searchParams.has("cursor") && !url.searchParams.has("candidate_q") &&
    !url.searchParams.has("candidate_status") && !url.searchParams.has("candidate_cursor") &&
    !url.searchParams.has("candidate_direction"));
  await expect(candidates).toContainText("Candidate read paused by URL parameters");
  await expect(candidates).not.toContainText("Search: Candidate 101");
  await expect(unsupported).toBeVisible();
  await expect(page).toHaveURL(/[?&]unsupported=one(?:&|$)/);
});

test("unsupported URL pauses member and candidate reads while collection detail remains visible", async ({ page, context }) => {
  for (const [fixture, resumedError] of [
    ["collections-members-error", "Members unavailable"],
    ["collections-candidates-error", "Candidate products could not be read"],
  ] as const) {
    await fixtureCookies(context, fixture);
    await page.goto(`${detailUrl(1)}?unexpected=x`);
    const members = page.getByRole("region", { name: "Associated products" });
    const candidates = page.getByRole("region", { name: "Candidate product search" });
    await expect(page.getByRole("region", { name: "Collection detail information" })).toContainText("Collection 1");
    await expect(members).toContainText("Member read paused by URL parameters");
    await expect(candidates).toContainText("Candidate read paused by URL parameters");
    await expect(members).not.toContainText("Member data incomplete");
    await expect(candidates).not.toContainText("Candidate page could not be verified");
    await page.getByRole("link", { name: "Clear unsupported parameters" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/collections/${id(1)}$`));
    await expect(page.getByRole("region", { name: fixture === "collections-members-error"
      ? "Associated products" : "Candidate product search" })).toContainText(resumedError);
  }
});

test("unsupported parameter recovery preserves both local drafts across history and refresh", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${detailUrl(1)}?unexpected=x`);
  const unsupported = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: "Unsupported URL parameters" }) });
  await expect(unsupported).toBeVisible();
  await unsupported.getByRole("link", { name: "Clear unsupported parameters" }).click();
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  await expect(member.locator(`[data-product-id="${id(101)}"]`)).toBeVisible();
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Unsaved during URL recovery");
  await member.locator(`[data-product-id="${id(101)}"]`).getByRole("button", { name: "Remove locally" }).click();
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  await page.goBack();
  await expect(unsupported).toBeVisible();
  await expect(basic.getByLabel("English name")).toHaveValue("Unsaved during URL recovery");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  page.once("dialog", async (dialog) => { await dialog.accept(); });
  await unsupported.getByRole("link", { name: "Clear unsupported parameters" }).click();
  await expect(unsupported).toHaveCount(0);
  await expect(basic.getByLabel("English name")).toHaveValue("Unsaved during URL recovery");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  page.once("dialog", async (dialog) => { await dialog.accept(); });
  await page.reload();
  await expect(basic.getByText("No local changes")).toBeVisible();
  await expect(member.getByText("No membership changes")).toBeVisible();
});

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
  const description = page.locator(".admin-page-description");
  await expect(description).toContainText("LOCAL DEMO drafts");
  await expect(description).toContainText("Basic and membership changes stay in this tab across Admin navigation");
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
  await expect(page.getByRole("region", { name: "Associated products" }).getByText("Draft Product", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/collections\?status=published$/);
  await expect(list.getByText("Collection 2", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/admin/collections/${id(2)}$`));
  await page.reload();
  await expect(page.getByRole("region", { name: "Associated products" }).getByText("Draft Product", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("region", { name: "Associated products" }).getByText("Draft Product", { exact: true })).toBeVisible();
  await page.goto(detailUrl(3));
  await expect(page.getByRole("region", { name: "Collection detail information" })
    .getByText("retired", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("region", { name: "Associated products" }).getByText(/CODE-X{100}/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const table = page.getByRole("region", { name: "Associated products" }).locator(".admin-table-scroll");
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
  await page.getByRole("link", { name: "Back to Collections" }).click();
  const leave = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: /Stay and keep editing/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/collections/${id(1)}$`));
  await expect(editor.getByLabel("English name")).toHaveValue("Unsaved name");
  await page.getByRole("region", { name: "Associated products" }).getByRole("link", { name: "Next" }).click();
  await expect(leave).toBeHidden();
  await expect(page).toHaveURL(/cursor=/);
  await expect(editor.getByLabel("English name")).toHaveValue("Unsaved name");
  page.once("dialog", async (dialog) => { await dialog.accept(); });
  await page.reload();
  const refreshed = page.getByRole("region", { name: "Local collection basic editor" });
  await refreshed.getByRole("button", { name: "Edit local draft" }).click();
  await expect(refreshed.getByLabel("English name")).toHaveValue("Collection 1");
});

for (const scenario of [
  { name: "Remove then leave", actions: ["remove"], dirty: true },
  { name: "Remove then Add then leave", actions: ["remove", "add"], verify: true, dirty: true },
  { name: "Add then leave", actions: ["add"], verify: true, dirty: true },
  { name: "Sort then leave", actions: ["sort"], dirty: true },
  { name: "Cancel then leave", actions: ["cancel"], setupAdd: true, dirty: false },
  { name: "Basic edit then leave", actions: ["basic"], editBasic: true, dirty: true },
  { name: "Basic edit then restore original then leave", actions: ["basic", "basic-reset"], editBasic: true, dirty: false },
  { name: "Basic edit then Remove then leave", actions: ["basic", "remove"], editBasic: true, dirty: true },
  { name: "Remove then Restore then leave", actions: ["remove", "restore"], dirty: false },
  { name: "Add then Cancel then leave", actions: ["add", "cancel"], verify: true, dirty: false },
  { name: "Discard then leave", actions: ["discard"], setupRemove: true, dirty: false },
  { name: "Basic dirty and Membership clean then leave", actions: ["basic", "remove", "restore"], editBasic: true, dirty: true },
  { name: "Basic clean and Membership dirty then leave", actions: ["basic", "basic-reset", "remove"], editBasic: true, dirty: true },
  { name: "Both drafts dirty then leave", actions: ["basic", "remove"], editBasic: true, dirty: true },
] as const) {
  test(`same-task dirty guard: ${scenario.name}`, async ({ page, context }) => {
    await fixtureCookies(context, "collections");
    await page.goto(detailUrl(2));
    const member = page.getByRole("region", { name: "Local collection membership editor" });
    const basic = page.getByRole("region", { name: "Local collection basic editor" });
    const row = page.locator(`.admin-candidate-panel tr[data-product-id="${id(101)}"]`);
    if ("editBasic" in scenario) await basic.getByRole("button", { name: "Edit local draft" }).click();
    if ("setupRemove" in scenario) {
      await member.locator(`[data-product-id="${id(202)}"]`)
        .getByRole("button", { name: "Remove locally" }).click();
    }
    if ("verify" in scenario || "setupAdd" in scenario) {
      await row.getByRole("button", { name: "Verify Membership" }).click();
      await expect(row.getByRole("button", { name: "Add to Draft" })).toBeVisible();
    }
    if ("setupAdd" in scenario) {
      await row.getByRole("button", { name: "Add to Draft" }).click();
      await expect(member.locator(`[data-proposed-product-id="${id(101)}"]`)).toBeVisible();
    }
    const originalBasicName = "editBasic" in scenario ? await basic.getByLabel("English name").inputValue() : "";
    const observed = await page.evaluate(async ({ actions, memberId, candidateId, originalBasicName }) => {
      let confirmations = 0;
      window.confirm = () => { confirmations++; return false; };
      const memberRow = () => document.querySelector<HTMLElement>(
        `.admin-membership-editor [data-product-id="${memberId}"]`);
      const candidateRow = () => document.querySelector<HTMLElement>(
        `.admin-candidate-panel tr[data-product-id="${candidateId}"]`);
      const button = (root: ParentNode | null, label: string) => {
        const result = [...(root?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
          .find((item) => item.textContent?.includes(label));
        if (!result) throw Error(`Missing ${label} control`);
        return result;
      };
      const changeInput = (input: HTMLInputElement | null, value: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (!input || !setter) throw Error("Missing input control");
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      for (const action of actions) {
        if (action === "remove") button(memberRow(), "Remove locally").click();
        // React may not repaint between these clicks; the same mounted button
        // still dispatches the current draft transition for Restore.
        if (action === "restore") button(memberRow(), "Remove locally").click();
        if (action === "add") button(candidateRow(), "Add to Draft").click();
        if (action === "sort") changeInput(document.getElementById(`membership-sort-${memberId}`) as HTMLInputElement, "-17");
        if (action === "basic") changeInput(document.querySelector<HTMLInputElement>(
          '.admin-editor[aria-label="Local collection basic editor"] input'), "Same-task basic edit");
        if (action === "basic-reset") changeInput(document.querySelector<HTMLInputElement>(
          '.admin-editor[aria-label="Local collection basic editor"] input'), originalBasicName);
        if (action === "discard") button(document.querySelector(".admin-membership-editor"), "Discard membership changes").click();
        if (action === "cancel") {
          await Promise.resolve();
          button(document.querySelector(`[data-proposed-product-id="${candidateId}"]`), "Cancel proposed add").click();
        }
      }
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      const back = [...document.querySelectorAll<HTMLAnchorElement>("a")]
        .find((link) => link.textContent?.includes("Back to Collections"));
      if (!back) throw Error("Missing Back to Collections link");
      back.click();
      return { confirmations, beforeunloadPrevented: unload.defaultPrevented };
    }, { actions: scenario.actions, memberId: id(202), candidateId: id(101), originalBasicName });
    expect(observed.confirmations).toBe(0);
    expect(observed.beforeunloadPrevented).toBe(scenario.dirty);
    const actions: readonly string[] = scenario.actions;
    if (scenario.dirty) {
      const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
      await expect(guard).toBeVisible();
      await guard.getByRole("button", { name: /Stay and keep editing/ }).click();
      await expect(page).toHaveURL(detailUrl(2));
      if (actions.includes("basic")) await expect(basic.getByLabel("English name"))
        .toHaveValue(actions.includes("basic-reset") ? originalBasicName : "Same-task basic edit");
      if (actions.includes("remove") && !actions.includes("restore")) {
        await expect(member.locator(`[data-product-id="${id(202)}"]`)
          .getByRole("button", { name: "Restore locally" })).toBeVisible();
      }
      if (actions.includes("add") && !actions.includes("cancel")) {
        await expect(member.locator(`[data-proposed-product-id="${id(101)}"]`)).toBeVisible();
      }
    } else {
      await expect(page).toHaveURL(`${fixtureOrigin}/admin/collections`);
    }
  });
}

test("same-Collection member paging bypasses departure confirmation; leaving uses the guard once", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  await expect.poll(async () => {
    const identityStatus = page.locator(".admin-identity-status");
    const status = await identityStatus.count() ? await identityStatus.textContent() : null;
    if (status?.includes("unavailable") || new URL(page.url()).pathname === "/admin/login")
      throw Error("Admin identity verification failed before the Collection editor became available");
    return page.locator(".admin-shell").isVisible();
  }, { message: "Admin identity did not finish verification" }).toBe(true);
  await expect(page.locator(`.admin-membership-editor [data-product-id="${id(101)}"] button`),
    "Verified Collection is missing the member edit control").toBeVisible();
  await expect(page.locator('nav[aria-label="Collection member pages"] a'),
    "Verified Collection is missing the paging link").toBeVisible();
  const rejected = await page.evaluate((memberId) => {
    let confirmations = 0;
    window.confirm = () => { confirmations++; return false; };
    const remove = document.querySelector<HTMLButtonElement>(
      `.admin-membership-editor [data-product-id="${memberId}"] button`);
    const next = document.querySelector<HTMLAnchorElement>(
      'nav[aria-label="Collection member pages"] a');
    if (!remove || !next) throw Error("Missing member edit or paging link");
    remove.click(); next.click();
    return confirmations;
  }, id(101));
  expect(rejected).toBe(0);
  await expect(page).toHaveURL(/cursor=/);
  await expect(page.getByRole("dialog", { name: /Unsaved local changes/ })).toBeHidden();
  await expect(page.getByRole("region", { name: "Local collection membership editor" })
    .locator(`[data-product-id="${id(101)}"]`)
    .getByRole("button", { name: "Restore locally" })).toBeVisible();
  const accepted = await page.evaluate(() => {
    let confirmations = 0;
    window.confirm = () => { confirmations++; return true; };
    const back = [...document.querySelectorAll<HTMLAnchorElement>("a")]
      .find((link) => link.textContent?.includes("Back to Collections"));
    if (!back) throw Error("Missing Back to Collections link");
    back.click();
    return confirmations;
  });
  expect(accepted).toBe(0);
  await page.getByRole("dialog", { name: /Unsaved local changes/ })
    .getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin/collections`);
});

test("same-task Basic field changes preserve the final dirty draft before navigation", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(2));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  const originalZh = await basic.getByLabel("中文名称").inputValue();
  const confirmations = await page.evaluate((originalZh) => {
    let count = 0;
    window.confirm = () => { count++; return false; };
    const fields = document.querySelectorAll<HTMLInputElement>(
      '.admin-editor[aria-label="Local collection basic editor"] fieldset input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (fields.length < 2 || !setter) throw Error("Missing Basic draft fields");
    for (const [input, value] of [[fields[0], "Keep this English edit"],
      [fields[1], "Temporary Chinese edit"], [fields[1], originalZh]] as const) {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const back = [...document.querySelectorAll<HTMLAnchorElement>("a")]
      .find((link) => link.textContent?.includes("Back to Collections"));
    if (!back) throw Error("Missing Back to Collections link");
    back.click();
    return count;
  }, originalZh);
  expect(confirmations).toBe(0);
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: /Stay and keep editing/ }).click();
  await expect(page).toHaveURL(detailUrl(2));
  await expect(basic.getByLabel("English name")).toHaveValue("Keep this English edit");
  await expect(basic.getByLabel("中文名称")).toHaveValue(originalZh);
});

test("basic draft remains mounted across successful member pagination", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const editor = page.getByRole("region", { name: "Local collection basic editor" });
  await editor.getByRole("button", { name: "Edit local draft" }).click();
  await editor.getByLabel("English name").fill("Across pages");
  await page.getByRole("navigation", { name: "Collection member pages" }).getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(editor.getByLabel("English name")).toHaveValue("Across pages");
});

test("membership draft survives member pages and both drafts keep the leave guard", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(detailUrl(1));
  const memberEditor = page.getByRole("region", { name: "Local collection membership editor" });
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await expect(memberEditor).toContainText("LOCAL DEMO / NOT CONNECTED");
  await expect(memberEditor).toContainText("TEST DATA");
  await expect(memberEditor.locator("[data-product-id]")).toHaveCount(25);
  const first = memberEditor.locator(`[data-product-id="${id(101)}"]`);
  const remove = first.getByRole("button", { name: "Remove locally" });
  await remove.focus();
  await expect(remove).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(memberEditor.getByText("Unsaved membership changes")).toBeVisible();
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Unsaved basic");
  await page.getByRole("navigation", { name: "Collection member pages" }).getByRole("link", { name: "Next" }).click();
  await expect(memberEditor.locator("[data-product-id]")).toHaveCount(50);
  await expect(first.getByRole("button", { name: "Restore locally" })).toBeVisible();
  await expect(basic.getByLabel("English name")).toHaveValue("Unsaved basic");
  await page.getByRole("navigation", { name: "Collection member pages" }).getByRole("link", { name: "Previous" }).click();
  await expect(first.getByRole("button", { name: "Restore locally" })).toBeVisible();
  await basic.getByRole("button", { name: "Discard changes" }).click();
  await expect(memberEditor.getByText("Unsaved membership changes")).toBeVisible();
  await first.getByRole("button", { name: "Restore locally" }).click();
  await first.getByLabel("Local sort order for FAMILY-101").fill("2147483648");
  await memberEditor.getByRole("button", { name: "Check membership draft" }).click();
  await expect(memberEditor.getByText("Local fields: INVALID")).toBeVisible();
  await first.getByLabel("Local sort order for FAMILY-101").fill("-2147483648");
  await memberEditor.getByRole("button", { name: "Check membership draft" }).click();
  await expect(memberEditor.getByText("Local fields: VALID")).toBeVisible();
  await expect(memberEditor.getByText("Full membership and write checks: NOT_VERIFIED")).toBeVisible();
  await memberEditor.getByRole("button", { name: "Discard membership changes" }).click();
  await expect(memberEditor.getByText("No membership changes")).toBeVisible();
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Basic only");
  await memberEditor.getByRole("button", { name: "Discard membership changes" }).click();
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(true);
  await page.getByRole("link", { name: "Back to Collections" }).click();
  await page.getByRole("dialog", { name: /Unsaved local changes/ })
    .getByRole("button", { name: /Stay and keep editing/ }).click();
  await expect(basic.getByLabel("English name")).toHaveValue("Basic only");
  await basic.getByRole("button", { name: "Discard changes" }).click();
  await expect.poll(() => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(false);
  expect(writes).toEqual([]);
  await page.reload();
  await expect(memberEditor.getByText("No membership changes")).toBeVisible();
  await expect(memberEditor.locator("[data-product-id]")).toHaveCount(25);
  await page.goto(detailUrl(2));
  await expect(memberEditor.locator(`[data-product-id="${id(101)}"]`)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Candidate product search" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Local collection basic editor" }).getByText("No local changes")).toBeVisible();
});

test("mounted member source conflict preserves dirty draft and pauses checking", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${fixtureOrigin}/admin/collection-membership-refresh-fixture`);
  const controls = page.getByRole("group", { name: "Fixture member source updates" });
  const editor = page.getByRole("region", { name: "Local collection membership editor" });
  const row = editor.locator('[data-product-id="550e8400-e29b-41d4-a716-446655440001"]');
  await row.getByRole("button", { name: "Remove locally" }).click();
  await controls.getByRole("button", { name: "Same values, new object" }).click();
  await expect(editor.getByText(/Loaded member source data changed/i)).toHaveCount(0);
  await controls.getByRole("button", { name: "Update source" }).click();
  await expect(row.getByRole("button", { name: "Restore locally" })).toBeVisible();
  await expect(editor.getByText(/Loaded member source data changed/i)).toBeVisible();
  await expect(editor.getByRole("button", { name: "Check membership draft" })).toBeDisabled();
  await editor.getByRole("button", { name: "Discard membership changes" }).click();
  await expect(editor.getByText("No membership changes")).toBeVisible();
  await expect(row.getByText("Source sort order: 2")).toBeVisible();
  await row.getByRole("button", { name: "Remove locally" }).click();
  for (const [button, state] of [["Incomplete source", "INCOMPLETE"], ["Error source", "ERROR"],
    ["Disconnect source", "NOT_CONNECTED"], ["Empty page", "EMPTY_PAGE"]] as const) {
    await controls.getByRole("button", { name: button }).click();
    await expect(editor.getByText(`Current member source: ${state}. No new member facts were accepted; checking is paused.`)).toBeVisible();
    await expect(row.getByRole("button", { name: "Restore locally" })).toBeDisabled();
    await expect(editor.getByText("Unsaved membership changes")).toBeVisible();
  }
  await controls.getByRole("button", { name: "Reconnect" }).click();
  await expect(row.getByRole("button", { name: "Restore locally" })).toBeEnabled();
  await editor.getByRole("button", { name: "Discard membership changes" }).click();
  await expect(editor.getByText("No membership changes")).toBeVisible();
});

test("a verified candidate loses its result when the member source fails or discovers that member", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.route("**/api/admin/collections/*/membership-check?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json",
      headers: { "Cache-Control": "private, no-store" },
      body: JSON.stringify({ collectionId: "550e8400-e29b-41d4-a716-446655440000",
        productId: "550e8400-e29b-41d4-a716-446655440002", status: "NOT_MEMBER",
        origin: "OFFLINE_FIXTURE" }) });
  });
  await page.goto(`${fixtureOrigin}/admin/collection-membership-refresh-fixture`);
  const controls = page.getByRole("group", { name: "Fixture member source updates" });
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const row = page.locator('tr[data-product-id="550e8400-e29b-41d4-a716-446655440002"]');
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row).toContainText("Not a Member — Verified for this view only");
  await expect(row.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  await controls.getByRole("button", { name: "Error source" }).click();
  await expect(member).toContainText("Current member source: ERROR");
  await expect(row).not.toContainText("Not a Member — Verified for this view only");
  await expect(row.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
  await expect(member).toContainText("No membership changes");
  await controls.getByRole("button", { name: "Reconnect" }).click();
  await expect(row.getByRole("button", { name: "Verify Membership" })).toBeEnabled();
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  await controls.getByRole("button", { name: "Candidate becomes member" }).click();
  await expect(row).toContainText("Already in Collection");
  await expect(row.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
  await expect(row).not.toContainText("Not a Member — Verified for this view only");
  await expect(member).toContainText("No membership changes");
});

test("a source that discovers a proposed candidate keeps the draft and blocks a second Add", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.route("**/api/admin/collections/*/membership-check?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json",
      headers: { "Cache-Control": "private, no-store" },
      body: JSON.stringify({ collectionId: "550e8400-e29b-41d4-a716-446655440000",
        productId: "550e8400-e29b-41d4-a716-446655440002", status: "NOT_MEMBER",
        origin: "OFFLINE_FIXTURE" }) });
  });
  await page.goto(`${fixtureOrigin}/admin/collection-membership-refresh-fixture`);
  const controls = page.getByRole("group", { name: "Fixture member source updates" });
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const row = page.locator('tr[data-product-id="550e8400-e29b-41d4-a716-446655440002"]');
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await row.getByRole("button", { name: "Add to Draft" }).click();
  await expect(member.locator('[data-proposed-product-id="550e8400-e29b-41d4-a716-446655440002"]'))
    .toHaveCount(1);
  await controls.getByRole("button", { name: "Candidate becomes member" }).click();
  await expect(member).toContainText("Loaded member source data changed");
  await expect(member).toContainText("Unsaved membership changes");
  await expect(member.locator('[data-proposed-product-id="550e8400-e29b-41d4-a716-446655440002"]'))
    .toHaveCount(1);
  await expect(row.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
  await expect(row).not.toContainText("Not a Member — Verified for this view only");
});

test("an exact check from an old detail visit cannot survive Back and Forward", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(2));
  const row = page.locator(`.admin-candidate-panel tr[data-product-id="${id(101)}"]`);
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const began = new Promise<void>((resolve) => { started = resolve; });
  let count = 0;
  await page.route("**/api/admin/collections/*/membership-check?*", async (route) => {
    count++;
    if (count === 1) { started(); await held; }
    try { await route.continue(); } catch { /* The first request belongs to an unmounted visit. */ }
  });
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await began;
  try {
    await page.getByRole("link", { name: "Back to Collections" }).click();
    await expect(page).toHaveURL(/\/admin\/collections(?:\?|$)/);
    await page.goBack();
  } finally { release(); }
  const returned = page.locator(`.admin-candidate-panel tr[data-product-id="${id(101)}"]`);
  await expect(returned.getByRole("button", { name: "Verify Membership" })).toBeVisible();
  await expect(returned).not.toContainText("Not a Member — Verified for this view only");
  await expect(returned.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
  await returned.getByRole("button", { name: "Verify Membership" }).click();
  await expect(returned).toContainText("Not a Member — Verified for this view only");
  expect(count).toBeGreaterThanOrEqual(2);
});

test("duplicate source anomaly survives Discard and unrelated clean reads", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${fixtureOrigin}/admin/collection-membership-refresh-fixture`);
  const controls = page.getByRole("group", { name: "Fixture member source updates" });
  const editor = page.getByRole("region", { name: "Local collection membership editor" });
  await controls.getByRole("button", { name: "Duplicate source IDs" }).click();
  await expect(editor.getByText(/source page had duplicate or invalid member identities/i)).toBeVisible();
  await expect(editor.getByRole("button", { name: "Check membership draft" })).toBeDisabled();
  await editor.getByRole("button", { name: "Remove locally" }).click();
  await editor.getByRole("button", { name: "Discard membership changes" }).click();
  await expect(editor.getByText("No membership changes")).toBeVisible();
  await expect(editor.getByText(/source page had duplicate or invalid member identities/i)).toBeVisible();
  await expect(editor.getByRole("button", { name: "Check membership draft" })).toBeDisabled();
  await controls.getByRole("button", { name: "Same values, new object" }).click();
  await expect(editor.getByRole("button", { name: "Check membership draft" })).toBeDisabled();
  await page.reload();
  await expect(editor.getByRole("button", { name: "Check membership draft" })).toBeEnabled();
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

test("member source request is bound to its starting visit across browser history", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(`${fixtureOrigin}/admin/collection-basic-refresh-fixture`);
  const sourceState = page.getByTestId("fixture-source-state");
  const sourceResult = page.getByTestId("fixture-source-result");
  await expect(sourceState).toHaveText("INCOMPLETE");
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  await page.route("**/api/admin/collections/*/member-source*", async (route) => {
    if (!first) { await route.continue(); return; }
    first = false;
    await delayed;
    try { await route.continue(); } catch { /* The old visit aborted its request. */ }
  });
  await page.getByRole("button", { name: "Load member source" }).click();
  await expect(sourceState).toHaveText("NEEDS_REVALIDATION");
  await page.getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
  release();
  await page.goBack();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin/collection-basic-refresh-fixture`);
  await expect(sourceState).toHaveText("INCOMPLETE");
  await page.getByRole("button", { name: "Load member source" }).click();
  await expect(sourceResult).toHaveText("APPLIED");
  await expect(sourceState).toHaveText("COMPLETE");
  const response = await page.request.get(`${fixtureOrigin}/api/admin/collections/${id(1)}/member-source`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("Basic and Membership drafts share the Shell session across Admin history", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  page.on("dialog", (dialog) => { void dialog.accept(); });
  await page.goto(detailUrl(1));
  const basic = () => page.getByRole("region", { name: "Local collection basic editor" });
  const membership = () => page.getByRole("region", { name: "Local collection membership editor" });
  const row = () => membership().locator(`[data-product-id="${id(101)}"]`);
  await expect(row().getByRole("button", { name: "Remove locally" })).toBeEnabled();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await basic().getByLabel("English name").fill("Basic survives history");
  await row().getByRole("button", { name: "Remove locally" }).click();
  await expect(row().getByRole("button", { name: "Restore locally" })).toBeVisible();
  await page.getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "Admin", exact: true }).click();
  await page.getByRole("dialog", { name: /Unsaved local changes/ })
    .getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
  await page.goBack();
  await expect(row().getByRole("button", { name: "Restore locally" })).toBeVisible();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).toHaveValue("Basic survives history");
  await page.goForward();
  await page.goBack();
  await expect(row().getByRole("button", { name: "Restore locally" })).toBeVisible();
  await page.reload();
  await expect(row().getByRole("button", { name: "Remove locally" })).toBeVisible();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).not.toHaveValue("Basic survives history");
});

test("Membership Proposed Add, removal and sort restore by UUID without crossing Collections", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  page.on("dialog", (dialog) => { void dialog.accept(); });
  await page.goto(detailUrl(2));
  const member = () => page.getByRole("region", { name: "Local collection membership editor" });
  const candidate = page.locator(`.admin-candidate-panel tr[data-product-id="${id(101)}"]`);
  await candidate.getByRole("button", { name: "Verify Membership" }).click();
  await candidate.getByRole("button", { name: "Add to Draft" }).click();
  await member().getByLabel("Local sort order for proposed FAMILY-101").fill("-4");
  await member().locator(`[data-product-id="${id(202)}"]`)
    .getByRole("button", { name: "Remove locally" }).click();
  await page.getByRole("link", { name: "Back to Collections" }).click();
  await page.getByRole("region", { name: "Collection list" })
    .getByRole("link", { name: "Open full details for Collection 1", exact: true }).click();
  await expect(member().locator(`[data-proposed-product-id="${id(101)}"]`)).toHaveCount(0);
  await member().locator(`[data-product-id="${id(101)}"]`)
    .getByRole("button", { name: "Remove locally" }).click();
  await page.getByRole("link", { name: "Back to Collections" }).click();
  await page.getByRole("region", { name: "Collection list" })
    .getByRole("link", { name: "Open full details for Collection 2", exact: true }).click();
  await expect(member().locator(`[data-product-id="${id(202)}"]`)
    .getByRole("button", { name: "Restore locally" })).toBeVisible();
  await expect(member().getByLabel("Local sort order for proposed FAMILY-101")).toHaveValue("-4");
  await expect(candidate.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
  await expect(candidate.getByRole("button", { name: "Verify Membership" })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to Collections" }).click();
  await page.getByRole("region", { name: "Collection list" })
    .getByRole("link", { name: "Open full details for Collection 1", exact: true }).click();
  await expect(member().locator(`[data-product-id="${id(101)}"]`)
    .getByRole("button", { name: "Restore locally" })).toBeVisible();
  await expect(member().locator(`[data-proposed-product-id="${id(101)}"]`)).toHaveCount(0);
});

test("Membership capacity rejection keeps the prior Session draft and explains the limit", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(2));
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const input = member.getByLabel("Local sort order for FAMILY-202");
  await expect(input).toHaveValue("0");
  await input.evaluate((element: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw Error("Input setter is unavailable");
    setter.call(element, "x".repeat(4 * 1024 * 1024));
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(member.getByRole("alert")).toContainText("Session space is insufficient");
  await expect(input).toHaveValue("0");
  await expect(member.getByText("No membership changes")).toBeVisible();
});

test("AdminShell Basic session survives client routes, history, and isolates Collections", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  page.on("dialog", (dialog) => { void dialog.accept(); });
  await page.goto(detailUrl(1));
  const basic = () => page.getByRole("region", { name: "Local collection basic editor" });
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await basic().getByLabel("English name").fill("Unsaved A");
  await expect(basic().getByText("Unsaved local changes")).toBeVisible();
  await page.evaluate(() => {
    (window as typeof window & { adminShellForTest?: Element | null }).adminShellForTest =
      document.querySelector(".admin-shell");
  });
  await page.getByRole("link", { name: "Back to Collections" }).click();
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(guard).toBeVisible();
  await expect(page).toHaveURL(detailUrl(1));
  await expect(basic().getByLabel("English name")).toHaveValue("Unsaved A");
  await guard.getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(/\/admin\/collections$/);
  expect(await page.evaluate(() => document.querySelector(".admin-shell") ===
    (window as typeof window & { adminShellForTest?: Element | null }).adminShellForTest)).toBe(true);
  const list = page.getByRole("region", { name: "Collection list" });
  await list.getByRole("link", { name: "Open full details for Collection 2", exact: true }).click();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await basic().getByLabel("English name").fill("Unsaved B");
  await page.getByRole("link", { name: "Back to Collections" }).click();
  await expect(guard).toBeVisible();
  await expect(page).toHaveURL(detailUrl(2));
  await expect(basic().getByLabel("English name")).toHaveValue("Unsaved B");
  await guard.getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(/\/admin\/collections$/);
  await list.getByRole("link", { name: "Open full details for Collection 1", exact: true }).click();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).toHaveValue("Unsaved A");
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/collections$/);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/admin/collections/${id(1)}$`));
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).toHaveValue("Unsaved A");
  await page.goBack();
  await page.goForward();
  await expect(basic()).toBeVisible();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).toHaveValue("Unsaved A");
  await basic().getByRole("button", { name: "Discard changes" }).click();
  await expect(basic().getByText("No local changes")).toBeVisible();
  await page.getByRole("link", { name: "Back to Collections" }).click();
  await list.getByRole("link", { name: "Open full details for Collection 2", exact: true }).click();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).toHaveValue("Unsaved B");
  await page.reload();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).toHaveValue("Collection 2");
});

test("AdminShell discards the prior administrator draft before a changed identity can see it", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  page.on("dialog", (dialog) => { void dialog.accept(); });
  await page.goto(detailUrl(1));
  const basic = () => page.getByRole("region", { name: "Local collection basic editor" });
  const member = () => page.getByRole("region", { name: "Local collection membership editor" });
  const memberRow = () => member().locator(`[data-product-id="${id(101)}"]`);
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await basic().getByLabel("English name").fill("Private draft from A");
  await memberRow().getByRole("button", { name: "Remove locally" }).click();
  await expect(basic().getByText("Unsaved local changes")).toBeVisible();
  await fixtureCookies(context, "collections", "catalog-only");
  await page.getByRole("link", { name: "Back to Collections" }).click();
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(guard).toBeVisible();
  await expect(page).toHaveURL(detailUrl(1));
  await expect(basic().getByLabel("English name")).toHaveValue("Private draft from A");
  await guard.getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(/\/admin\/collections$/);
  await expect(page.getByLabel("Administrator ID ending 22222222")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin navigation" }).first()
    .getByRole("link", { name: "Collections" })).toBeVisible();
  await expect(page.locator('a[href="/admin/imports"]')).toHaveCount(0);
  await expect(page.getByText("Private draft from A")).toHaveCount(0);
  const serverView = await context.newPage();
  await serverView.goto(detailUrl(1));
  await expect(serverView.getByLabel("Administrator ID ending 22222222")).toBeVisible();
  await serverView.close();
  await page.getByRole("region", { name: "Collection list" })
    .getByRole("link", { name: "Open full details for Collection 1", exact: true }).click();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).toHaveValue("Collection 1");
  await expect(memberRow().getByRole("button", { name: "Remove locally" })).toBeVisible();
  await basic().getByLabel("English name").fill("Private draft from B");
  await memberRow().getByRole("button", { name: "Remove locally" }).click();
  await fixtureCookies(context, "collections", "editor");
  await page.getByRole("link", { name: "Back to Collections" }).click();
  await expect(guard).toBeVisible();
  await expect(page).toHaveURL(detailUrl(1));
  await expect(basic().getByLabel("English name")).toHaveValue("Private draft from B");
  await guard.getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(/\/admin\/collections$/);
  await expect(page.getByLabel("Administrator ID ending 11111111")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin navigation" }).filter({ visible: true })
    .getByRole("link", { name: "Imports" })).toBeVisible();
  await page.getByRole("region", { name: "Collection list" })
    .getByRole("link", { name: "Open full details for Collection 1", exact: true }).click();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).toHaveValue("Collection 1");
  await expect(memberRow().getByRole("button", { name: "Remove locally" })).toBeVisible();
  await expect(page.getByText("Private draft from B")).toHaveCount(0);
});

test("AdminShell hides Basic drafts during delayed focus verification and clears a new login session", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = () => page.getByRole("region", { name: "Local collection basic editor" });
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await basic().getByLabel("English name").fill("Previous login draft");
  let release!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  let delaying = true;
  await page.route("**/api/admin/session-identity", async (route) => {
    if (delaying) await paused;
    try { await route.continue(); } catch { /* A canceled request cannot re-enable an old session. */ }
  });
  await context.addCookies([{ name: "admin-ui-fixture-session", value: "second", url: fixtureOrigin }]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("status").filter({ hasText: "Confirming administrator identity" })).toBeVisible();
  await expect(basic()).toHaveCount(0);
  delaying = false;
  release();
  await expect(basic()).toBeVisible();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).toHaveValue("Collection 1");
  await expect(page.getByText("Previous login draft")).toHaveCount(0);
});

test("AdminShell rejects an invalidated login before revealing a retained Basic draft", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Hidden after logout");
  await context.clearCookies();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByText("Hidden after logout")).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
});

test("revoking catalog read destroys the Basic owner without removing Dashboard access", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = () => page.getByRole("region", { name: "Local collection basic editor" });
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await basic().getByLabel("English name").fill("Draft before grant revocation");
  await context.addCookies([{ name: "admin-ui-fixture", value: "dashboard", url: fixtureOrigin }]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Draft before grant revocation")).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
  await page.goto(`${fixtureOrigin}/admin`);
  await expect(page.getByRole("heading", { name: "Good to see you." })).toBeVisible();
  await fixtureCookies(context, "collections", "editor");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator('main a[href="/admin/collections"]')).toBeVisible();
  await page.locator('main a[href="/admin/collections"]').click();
  await page.getByRole("region", { name: "Collection list" })
    .getByRole("link", { name: "Open full details for Collection 1", exact: true }).click();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).toHaveValue("Collection 1");
});

test("revoked catalog grant unmounts stale Collections controls before navigation completes", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  page.on("dialog", (dialog) => { void dialog.accept(); });
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  const membership = page.getByRole("region", { name: "Local collection membership editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Revoked Basic draft");
  await membership.getByRole("button", { name: "Remove locally" }).first().click();
  await expect(membership.getByText("Unsaved membership changes")).toBeVisible();

  let release!: () => void;
  let started!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const navigationStarted = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/admin**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/admin/login" && url.searchParams.has("_rsc")) {
      started();
      await paused;
    }
    try { await route.continue(); } catch { /* Superseded navigation is safe. */ }
  });
  try {
    await context.addCookies([{ name: "admin-ui-fixture", value: "dashboard", url: fixtureOrigin }]);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await navigationStarted;
    await expect(page.locator(".admin-membership-editor")).toHaveCount(0);
    await expect(page.locator('[aria-label="Local collection basic editor"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelector(".admin-membership-editor button") === null)).toBe(true);
  } finally { release(); }
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
  await page.goto(`${fixtureOrigin}/admin`);
  await expect(page.getByRole("heading", { name: "Good to see you." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Collections" })).toHaveCount(0);
});

test("focus verification synchronously rejects old Membership callbacks", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  const counts: VerificationRequests = { identity: 0, memberSource: 0, exactGet: 0 };
  verificationRequests.set(page, counts);
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/admin/session-identity") counts.identity++;
    if (path.endsWith("/member-source")) counts.memberSource++;
    if (path.endsWith("/membership-check")) counts.exactGet++;
  });
  await page.goto(detailUrl(2));
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const candidate = page.locator(`.admin-candidate-panel tr[data-product-id="${id(101)}"]`);
  await candidate.getByRole("button", { name: "Verify Membership" }).click();
  await expect(candidate.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  counts.beforeFocusPhase = await candidate.locator("[data-verification-status]")
    .getAttribute("data-verification-status");
  const originalSort = await member.getByLabel("Local sort order for FAMILY-202").inputValue();
  let release!: () => void;
  let started!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/api/admin/session-identity", async (route) => {
    started();
    await paused;
    try { await route.continue(); } catch { /* A superseded identity read is safe. */ }
  });
  await context.addCookies([{ name: "admin-ui-fixture", value: "dashboard", url: fixtureOrigin }]);
  await page.evaluate(([memberId, productId]) => {
    const remove = document.querySelector<HTMLButtonElement>(
      `.admin-membership-editor [data-product-id="${memberId}"] button`);
    const sort = document.getElementById(`membership-sort-${memberId}`) as HTMLInputElement | null;
    const add = document.querySelector<HTMLButtonElement>(
      `.admin-candidate-panel tr[data-product-id="${productId}"] button:last-of-type`);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!remove || !sort || !add || !setter) throw Error("Missing old Membership controls");
    window.dispatchEvent(new Event("focus"));
    remove.click();
    setter.call(sort, "-9");
    sort.dispatchEvent(new Event("input", { bubbles: true }));
    add.click();
  }, [id(202), id(101)]);
  await firstStarted;
  try {
    await expect(member.getByText("No membership changes")).toBeHidden();
    expect(await page.evaluate(() => document.querySelector(".admin-membership-editor")
      ?.textContent?.includes("Unsaved membership changes"))).toBe(false);
    expect(await page.evaluate(() => document.querySelector(".admin-membership-proposed"))).toBeNull();
    // A programmatic click on an inert old node must also fail the synchronous gate.
    await page.evaluate((memberId) => document.querySelector<HTMLButtonElement>(
      `.admin-membership-editor [data-product-id="${memberId}"] button`)?.click(), id(202));
    expect(await page.evaluate(() => document.querySelector(".admin-membership-editor")
      ?.textContent?.includes("Unsaved membership changes"))).toBe(false);
  } finally {
    await fixtureCookies(context, "collections", "editor");
    release();
  }
  await expect(member.getByText("No membership changes")).toBeVisible();
  await expect(member.getByLabel("Local sort order for FAMILY-202")).toHaveValue(originalSort);
  await expect(member.locator("[data-proposed-product-id]")).toHaveCount(0);
  await expect(member.getByRole("button", { name: "Remove locally" }).first()).toBeVisible();
  await expect(candidate.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
  await member.getByRole("button", { name: "Remove locally" }).first().click();
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
});

test("a membership check started before the access lock cannot complete after revalidation", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(2));
  const candidate = page.locator(`.admin-candidate-panel tr[data-product-id="${id(101)}"]`);
  let releaseCheck!: () => void;
  let checkStarted!: () => void;
  const pendingCheck = new Promise<void>((resolve) => { releaseCheck = resolve; });
  const beganCheck = new Promise<void>((resolve) => { checkStarted = resolve; });
  await page.route("**/api/admin/collections/*/membership-check?*", async (route) => {
    checkStarted();
    await pendingCheck;
    try { await route.continue(); } catch { /* Access lock aborts the old request. */ }
  });
  await candidate.getByRole("button", { name: "Verify Membership" }).click();
  await beganCheck;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  releaseCheck();
  await expect(candidate.getByRole("button", { name: "Verify Membership" })).toBeVisible();
  await expect(candidate).not.toContainText("Not a Member — Verified for this view only");
  await expect(candidate.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
});

test("fixture focus verification lifecycle invalidates a checked candidate before an old Add callback", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  const counts = { identity: 0, memberSource: 0, exactGet: 0 };
  verificationRequests.set(page, counts);
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/admin/session-identity") counts.identity++;
    if (path.endsWith("/member-source")) counts.memberSource++;
    if (path.endsWith("/membership-check")) counts.exactGet++;
  });
  await page.route("**/api/admin/collections/*/membership-check?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json",
      headers: { "Cache-Control": "private, no-store" },
      body: JSON.stringify({ collectionId: "550e8400-e29b-41d4-a716-446655440000",
        productId: "550e8400-e29b-41d4-a716-446655440002", status: "NOT_MEMBER",
        origin: "OFFLINE_FIXTURE" }) });
  });
  await page.goto(`${fixtureOrigin}/admin/collection-membership-refresh-fixture`);
  const row = page.locator('tr[data-product-id="550e8400-e29b-41d4-a716-446655440002"]');
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  await row.getByRole("button", { name: "Verify Membership" }).click();
  await expect(row.getByRole("button", { name: "Add to Draft" })).toBeVisible();
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const began = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/api/admin/session-identity", async (route) => {
    started(); await held;
    try { await route.continue(); } catch { /* A stale identity request may be aborted. */ }
  });
  try {
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.querySelector<HTMLButtonElement>(
        'tr[data-product-id="550e8400-e29b-41d4-a716-446655440002"] button:nth-of-type(2)')?.click();
    });
    await began;
    const locked = await page.evaluate(() => (window as Window & {
      verificationFixtureSnapshot?: () => { accessOpen: boolean };
    }).verificationFixtureSnapshot?.());
    expect(locked?.accessOpen).toBe(false);
    await expect(member).toHaveCount(0);
  } finally { release(); }
  await expect(row.getByRole("button", { name: "Verify Membership" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Add to Draft" })).toHaveCount(0);
  await expect(row).not.toContainText("Not a Member — Verified for this view only");
  await expect(member).toContainText("No membership changes");
  expect(counts.identity).toBeGreaterThan(0);
  expect(counts.exactGet).toBe(1);
});

test("a member source cannot merge before access revalidation completes", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(`${fixtureOrigin}/admin/collection-membership-refresh-fixture`);
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  const controls = page.getByRole("group", { name: "Fixture member source updates" });
  await expect(member.getByText("Source sort order: 1")).toBeVisible();
  let release!: () => void;
  let started!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/api/admin/session-identity", async (route) => {
    started();
    await paused;
    try { await route.continue(); } catch { /* A superseded identity read is safe. */ }
  });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.querySelector<HTMLButtonElement>(
      '[aria-label="Fixture member source updates"] button:nth-of-type(3)')?.click();
  });
  await firstStarted;
  try {
    expect(await page.evaluate(() => document.querySelector(".admin-membership-editor")
      ?.textContent?.includes("Source sort order: 2"))).toBe(false);
  } finally { release(); }
  // The same verified administrator may accept this source once the gate opens.
  await expect(controls.getByRole("button", { name: "Update source" })).toBeVisible();
  await expect(member.getByText("Source sort order: 2")).toBeVisible();
});

test("late granted identity response cannot reopen a revoked Catalog route", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  let release!: () => void;
  let started!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  let first = true;
  await page.route("**/api/admin/session-identity", async (route) => {
    if (first) {
      first = false;
      started();
      await paused;
      try { await route.fulfill({ status: 200, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId: "11111111-1111-4111-8111-111111111111",
          sessionKey: "a".repeat(64), canReadCatalog: true }) }); }
      catch { /* Canceled old response must not reopen the route. */ }
      return;
    }
    await route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await firstStarted;
  await context.addCookies([{ name: "admin-ui-fixture", value: "dashboard", url: fixtureOrigin }]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
  release();
  await expect(page.locator(".admin-membership-editor")).toHaveCount(0);
  await page.goto(`${fixtureOrigin}/admin`);
  await expect(page.getByRole("heading", { name: "Good to see you." })).toBeVisible();
});

test("late revoked identity response cannot close a newer granted Catalog confirmation", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Keep newer permission");
  let release!: () => void;
  let started!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  let first = true;
  await page.route("**/api/admin/session-identity", async (route) => {
    if (first) {
      first = false;
      started();
      await paused;
      try { await route.fulfill({ status: 200, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId: "11111111-1111-4111-8111-111111111111",
          sessionKey: "a".repeat(64), canReadCatalog: false }) }); }
      catch { /* Canceled old response must not close the route. */ }
      return;
    }
    await route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await firstStarted;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(basic.getByLabel("English name")).toHaveValue("Keep newer permission");
  release();
  await expect(page).toHaveURL(detailUrl(1));
  await expect(basic.getByLabel("English name")).toHaveValue("Keep newer permission");
});

test("catalog grant revocation closes each catalog.read workspace route", async ({ page, context }) => {
  for (const path of ["/admin/collections", "/admin/products", "/admin/categories", "/admin/media"]) {
    await fixtureCookies(context, "collections", "editor");
    await page.goto(`${fixtureOrigin}${path}`);
    await expect(page.locator(".admin-shell")).toBeVisible();
    await context.addCookies([{ name: "admin-ui-fixture", value: "dashboard", url: fixtureOrigin }]);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
    await page.goto(`${fixtureOrigin}/admin`);
    await expect(page.getByRole("heading", { name: "Good to see you." })).toBeVisible();
    await expect(page.locator(`main a[href="${path}"]`)).toHaveCount(0);
  }
});

test("a late old identity response cannot re-enable the previous AdminShell owner", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("A should disappear");
  let release!: () => void;
  let started!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  let first = true;
  await page.route("**/api/admin/session-identity", async (route) => {
    if (first) {
      first = false;
      started();
      await paused;
      try { await route.fulfill({ status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
        body: JSON.stringify({ adminId: "11111111-1111-4111-8111-111111111111",
          sessionKey: "a".repeat(64), canReadCatalog: true }) }); }
      catch { /* The first request may already have been aborted. */ }
      return;
    }
    await route.continue();
  });
  await context.addCookies([{ name: "admin-ui-fixture", value: "catalog-only", url: fixtureOrigin }]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await firstStarted;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Administrator ID ending 22222222")).toBeVisible();
  release();
  await expect(page.getByText("A should disappear")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Local collection basic editor" })).toBeVisible();
});

test("a late mismatched response cannot destroy a freshly reconfirmed administrator owner", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("A remains valid");
  let release!: () => void;
  let started!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  let first = true;
  await page.route("**/api/admin/session-identity", async (route) => {
    if (first) {
      first = false;
      started();
      await paused;
      try { await route.fulfill({ status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
        body: JSON.stringify({ adminId: "22222222-2222-4222-8222-222222222222",
          sessionKey: "b".repeat(64), canReadCatalog: true }) }); }
      catch { /* The stale request may already have been aborted. */ }
      return;
    }
    await route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await firstStarted;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(basic.getByLabel("English name")).toHaveValue("A remains valid");
  release();
  await expect(page.getByLabel("Administrator ID ending 11111111")).toBeVisible();
  await expect(basic.getByLabel("English name")).toHaveValue("A remains valid");
});

test("identity confirmation is uncached and denies an unauthenticated request", async ({ context }) => {
  await fixtureCookies(context, "collections", "editor");
  const allowed = await context.request.get(`${fixtureOrigin}/api/admin/session-identity`);
  expect(allowed.status()).toBe(200);
  expect(allowed.headers()["cache-control"]).toBe("private, no-store");
  expect((await allowed.json()).adminId).toBe("11111111-1111-4111-8111-111111111111");
  await context.clearCookies();
  const denied = await context.request.get(`${fixtureOrigin}/api/admin/session-identity`);
  expect(denied.status()).toBe(401);
  expect(denied.headers()["cache-control"]).toBe("private, no-store");
  expect(await denied.json()).not.toHaveProperty("adminId");
  await context.addCookies([{ name: "admin-ui-fixture", value: "no-catalog", url: fixtureOrigin }]);
  const revoked = await context.request.get(`${fixtureOrigin}/api/admin/session-identity`);
  expect(revoked.status()).toBe(200);
  expect(revoked.headers()["cache-control"]).toBe("private, no-store");
  expect((await revoked.json()).canReadCatalog).toBe(false);
  const method = await context.request.post(`${fixtureOrigin}/api/admin/session-identity`);
  expect(method.status()).toBe(405);
  expect(method.headers()["cache-control"]).toBe("private, no-store");
});

test("losing focus hides the draft before another tab changes administrator identity", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = () => page.getByRole("region", { name: "Local collection basic editor" });
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await basic().getByLabel("English name").fill("A before background");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(basic()).toHaveCount(0);
  await fixtureCookies(context, "collections", "catalog-only");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Administrator ID ending 22222222")).toBeVisible();
  await expect(page.getByText("A before background")).toHaveCount(0);
});

test("desktop sidebar cancel and confirm use the shared guard and preserve history", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop sidebar only");
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = () => page.getByRole("region", { name: "Local collection basic editor" });
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await basic().getByLabel("English name").fill("Sidebar draft");
  let nativeDialogs = 0;
  page.on("dialog", (dialog) => { nativeDialogs++; void dialog.dismiss(); });
  const dashboard = page.getByRole("complementary", { name: "Admin sidebar" })
    .getByRole("link", { name: "Dashboard" });
  await dashboard.click();
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: /Stay and keep editing/ }).click();
  await expect(page).toHaveURL(detailUrl(1));
  await expect(basic().getByLabel("English name")).toHaveValue("Sidebar draft");
  expect((await context.request.get(`${fixtureOrigin}/api/admin/session-identity`)).status()).toBe(200);
  expect(nativeDialogs).toBe(0);
  await dashboard.click();
  await guard.getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
  await page.goBack();
  await expect(page).toHaveURL(detailUrl(1));
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).toHaveValue("Sidebar draft");
});

test("mobile menu cancel and confirm use the shared guard", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile menu only");
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Mobile sidebar draft");
  let nativeDialogs = 0;
  page.on("dialog", (dialog) => { nativeDialogs++; void dialog.dismiss(); });
  const menu = page.getByRole("dialog", { name: "Admin menu" });
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  const menuButton = page.getByRole("button", { name: "Open admin menu" });
  await menuButton.click();
  await menu.getByRole("link", { name: "Dashboard" }).click();
  await expect(menu).toBeHidden();
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: /Stay and keep editing/ }).click();
  await expect(page).toHaveURL(detailUrl(1));
  await expect(basic.getByLabel("English name")).toHaveValue("Mobile sidebar draft");
  expect((await context.request.get(`${fixtureOrigin}/api/admin/session-identity`)).status()).toBe(200);
  expect(nativeDialogs).toBe(0);
  await menuButton.click();
  await menu.getByRole("link", { name: "Dashboard" }).click();
  await guard.getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
});

test("clean formal sidebar navigation has no confirmation", async ({ page, context }, testInfo) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  if (testInfo.project.name === "mobile-chrome") {
    await page.getByRole("button", { name: "Open admin menu" }).click();
    await page.getByRole("dialog", { name: "Admin menu" })
      .getByRole("link", { name: "Dashboard" }).click();
  } else {
    await page.getByRole("complementary", { name: "Admin sidebar" })
      .getByRole("link", { name: "Dashboard" }).click();
  }
  await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
  await expect(page.getByRole("dialog", { name: /Unsaved local changes/ })).toBeHidden();
});

test("repeated formal sidebar clicks and approvals navigate once", async ({ page, context }, testInfo) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("One sidebar navigation");
  if (testInfo.project.name === "mobile-chrome")
    await page.getByRole("button", { name: "Open admin menu" }).click();
  await page.evaluate((mobile) => {
    const selector = mobile ? ".admin-mobile-dialog .admin-nav-link" : ".admin-sidebar .admin-nav-link";
    const dashboard = document.querySelector<HTMLAnchorElement>(selector);
    dashboard?.click();
    dashboard?.click();
  }, testInfo.project.name === "mobile-chrome");
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(guard).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(guard).toBeHidden();
  await expect(page).toHaveURL(detailUrl(1));
  await expect(basic.getByLabel("English name")).toHaveValue("One sidebar navigation");
  if (testInfo.project.name === "mobile-chrome")
    await page.getByRole("button", { name: "Open admin menu" }).click();
  await page.evaluate((mobile) => {
    const selector = mobile ? ".admin-mobile-dialog .admin-nav-link" : ".admin-sidebar .admin-nav-link";
    document.querySelector<HTMLAnchorElement>(selector)?.click();
  }, testInfo.project.name === "mobile-chrome");
  await expect(guard).toBeVisible();
  await page.evaluate(() => {
    const approve = document.querySelector<HTMLButtonElement>(".admin-guard-actions button:last-child");
    approve?.click();
    approve?.click();
  });
  await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
  await page.goBack();
  await expect(page).toHaveURL(detailUrl(1));
});

test("breadcrumb cancel and confirm use the shared guard on desktop and mobile", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = () => page.getByRole("region", { name: "Local collection basic editor" });
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await basic().getByLabel("English name").fill("Breadcrumb draft");
  let nativeDialogs = 0;
  page.on("dialog", (dialog) => { nativeDialogs++; void dialog.dismiss(); });
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "Collections" });
  await breadcrumb.focus();
  await breadcrumb.click();
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(guard).toBeVisible();
  await expect(guard).toHaveAttribute("data-navigation-lifecycle", "CONFIRMING");
  await page.keyboard.press("Escape");
  await expect(guard).toBeHidden();
  await expect(breadcrumb).toBeFocused();
  await expect(page).toHaveURL(detailUrl(1));
  await expect(basic().getByLabel("English name")).toHaveValue("Breadcrumb draft");
  expect((await context.request.get(`${fixtureOrigin}/api/admin/session-identity`)).status()).toBe(200);
  expect(nativeDialogs).toBe(0);
  await breadcrumb.click();
  await guard.getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin/collections`);
  await page.goBack();
  await expect(page).toHaveURL(detailUrl(1));
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).toHaveValue("Breadcrumb draft");
});

test("repeated breadcrumb clicks and approvals create only one history entry", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("One breadcrumb navigation");
  const before = await page.evaluate(() => history.length);
  await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>('.admin-breadcrumb a[href="/admin"]');
    link?.click();
    link?.click();
  });
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(guard).toHaveCount(1);
  await expect(guard).toBeVisible();
  await page.evaluate(() => {
    const approve = document.querySelector<HTMLButtonElement>(".admin-guard-actions button:last-child");
    approve?.click();
    approve?.click();
  });
  await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
  expect(await page.evaluate(() => history.length)).toBe(before + 1);
  await page.goBack();
  await expect(page).toHaveURL(detailUrl(1));
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic.getByLabel("English name")).toHaveValue("One breadcrumb navigation");
});

test("clean Admin, Collections and Products breadcrumbs navigate without confirmation", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await page.goto(detailUrl(1));
  await breadcrumb.getByRole("link", { name: "Collections" }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin/collections`);
  await expect(guard).toBeHidden();
  await page.goto(`${fixtureOrigin}/admin/products/FAMILY-2`);
  await breadcrumb.getByRole("link", { name: "Products" }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin/products`);
  await expect(guard).toBeHidden();
  await breadcrumb.getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
  await expect(guard).toBeHidden();
});

test("a failed sign-out rechecks identity and preserves the same session draft", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Keep after failed sign-out");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("dialog", { name: /Unsaved local changes/ })
    .getByRole("button", { name: /Sign out/ }).click();
  await expect(basic.getByLabel("English name")).toHaveValue("Keep after failed sign-out");
  await expect(basic.getByText("Unsaved local changes")).toBeVisible();
});

test("two failed sign-outs keep the draft and a third confirmed attempt succeeds", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Keep through two failures");
  let submissions = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/admin"))
      submissions++;
  });
  const attempt = async (count: number) => {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
    await expect(guard).toBeVisible();
    expect(submissions).toBe(count - 1);
    await guard.getByRole("button", { name: /Sign out/ }).click();
    await expect.poll(() => submissions).toBe(count);
  };
  for (const count of [1, 2]) {
    await attempt(count);
    await expect(basic.getByLabel("English name")).toHaveValue("Keep through two failures");
    await expect(page.getByText("Unable to sign out. Please try again or contact an administrator."))
      .toBeVisible();
    expect((await context.request.get(`${fixtureOrigin}/api/admin/session-identity`)).status()).toBe(200);
  }
  await context.addCookies([{ name: "admin-ui-fixture-logout", value: "succeed", url: fixtureOrigin }]);
  await attempt(3);
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
  await expect(page.getByText("Keep through two failures")).toHaveCount(0);
  expect(submissions).toBe(3);
});

test("cancelled sign-out keeps the draft and login without calling the action", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await context.addCookies([{ name: "admin-ui-fixture-logout", value: "succeed", url: fixtureOrigin }]);
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Keep after cancel");
  let submissions = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/admin"))
      submissions++;
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(guard).toBeVisible();
  await expect(guard).toContainText("permanently discards every unsaved local draft");
  expect(submissions).toBe(0);
  await guard.getByRole("button", { name: /Stay and keep editing/ }).click();
  await expect(guard).toBeHidden();
  await expect(page).toHaveURL(detailUrl(1));
  await expect(basic.getByLabel("English name")).toHaveValue("Keep after cancel");
  expect(submissions).toBe(0);
  const identity = await context.request.get(`${fixtureOrigin}/api/admin/session-identity`);
  expect(identity.status()).toBe(200);
});

test("successful fixture sign-out clears the owner before the next login", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await context.addCookies([{ name: "admin-ui-fixture-logout", value: "succeed", url: fixtureOrigin }]);
  await page.goto(detailUrl(1));
  const basic = () => page.getByRole("region", { name: "Local collection basic editor" });
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await basic().getByLabel("English name").fill("Old login secret");
  await page.getByRole("button", { name: "Sign out" }).click();
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(guard).toBeVisible();
  await expect(basic().getByLabel("English name")).toHaveValue("Old login secret");
  await guard.getByRole("button", { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
  await expect(page.getByText("Old login secret")).toHaveCount(0);
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).toHaveValue("Collection 1");
});

test("clean sign-out submits without a confirmation", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await context.addCookies([{ name: "admin-ui-fixture-logout", value: "succeed", url: fixtureOrigin }]);
  await page.goto(detailUrl(1));
  await expect(page.getByRole("region", { name: "Local collection basic editor" })
    .getByText("No local changes")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
  await expect(page.getByRole("dialog", { name: /Unsaved local changes/ })).toHaveCount(0);
});

test("repeated sign-out clicks and approvals submit only once", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await context.addCookies([{ name: "admin-ui-fixture-logout", value: "succeed", url: fixtureOrigin }]);
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("One submit");
  let submissions = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/admin"))
      submissions++;
  });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent === "Sign out");
    button?.click();
    button?.click();
  });
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(guard).toHaveCount(1);
  expect(submissions).toBe(0);
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>(".admin-guard-actions button:last-child");
    button?.click();
    button?.click();
  });
  await expect(page).toHaveURL(/\/admin\/login(?:\?.*)?$/);
  expect(submissions).toBe(1);
});

test("a temporary identity service failure locks edits without losing the same login draft", async ({ page, context }) => {
  await fixtureCookies(context, "collections", "editor");
  await page.goto(detailUrl(1));
  const basic = () => page.getByRole("region", { name: "Local collection basic editor" });
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await basic().getByLabel("English name").fill("Retain through outage");
  const outage = async (route: import("@playwright/test").Route) => {
    await route.fulfill({ status: 503, headers: { "Cache-Control": "private, no-store" },
      body: "Unavailable" });
  };
  await page.route("**/api/admin/session-identity", outage);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Admin identity is unavailable")).toBeVisible();
  await expect(basic()).toHaveCount(0);
  await page.unroute("**/api/admin/session-identity", outage);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(basic().getByLabel("English name")).toHaveValue("Retain through outage");
  await expect(basic().getByText("Unsaved local changes")).toBeVisible();
});

test("AdminShell Basic session rejects a fourth Dirty Collection without losing the first three", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  page.on("dialog", (dialog) => { void dialog.accept(); });
  await page.goto(`${fixtureOrigin}/admin/collections`);
  const list = page.getByRole("region", { name: "Collection list" });
  const basic = () => page.getByRole("region", { name: "Local collection basic editor" });
  for (const n of [1, 2, 4]) {
    await list.getByRole("link", { name: `Open full details for Collection ${n}`, exact: true }).click();
    await basic().getByRole("button", { name: "Edit local draft" }).click();
    await basic().getByLabel("English name").fill(`Dirty ${n}`);
    await expect(basic().getByLabel("English name")).toHaveValue(`Dirty ${n}`);
    await page.getByRole("link", { name: "Back to Collections" }).click();
  }
  await list.getByRole("link", { name: "Open full details for Collection 5", exact: true }).click();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await basic().getByLabel("English name").fill("Fourth draft");
  await expect(basic().getByRole("alert")).toContainText("Only three Collections");
  await expect(basic().getByLabel("English name")).toHaveValue("Collection 5");
  await page.getByRole("link", { name: "Back to Collections" }).click();
  await list.getByRole("link", { name: "Open full details for Collection 1", exact: true }).click();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic().getByLabel("English name")).toHaveValue("Dirty 1");
  await basic().getByRole("button", { name: "Discard changes" }).click();
  await page.getByRole("link", { name: "Back to Collections" }).click();
  await list.getByRole("link", { name: "Open full details for Collection 5", exact: true }).click();
  await basic().getByRole("button", { name: "Edit local draft" }).click();
  await basic().getByLabel("English name").fill("Now allowed");
  await expect(basic().getByLabel("English name")).toHaveValue("Now allowed");
});

test("AdminShell Basic session reports payload rejection and retains the prior draft", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Keep this draft");
  await basic.getByLabel("English description").fill("X".repeat(4_194_305));
  await expect(basic.getByRole("alert")).toContainText("Session space is insufficient");
  await expect(basic.getByLabel("English name")).toHaveValue("Keep this draft");
  await expect(basic.getByLabel("English description")).toHaveValue("");
  await expect(basic.getByText("Unsaved local changes")).toBeVisible();
});
