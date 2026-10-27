import { test, expect } from "@playwright/test";
import { fixtureCookies, fixtureOrigin, startAdminFixture, stopAdminFixture } from "./support/admin-site";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const detailUrl = (n: number) => `${fixtureOrigin}/admin/collections/${id(n)}`;

test.beforeAll(async () => { await startAdminFixture(); });
test.afterAll(async () => { await stopAdminFixture(); });
test.setTimeout(120_000);

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
  await expect(candidates.getByRole("button", { name: /Verify Membership|Add to Draft/i })).toHaveCount(0);
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
  await expect(description).toContainText("LOCAL DEMO drafts for basic information and associated products");
  await expect(description).toContainText("lost on refresh or departure");
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

test("basic draft remains mounted across successful member pagination", async ({ page, context }) => {
  await fixtureCookies(context, "collections");
  await page.goto(detailUrl(1));
  const editor = page.getByRole("region", { name: "Local collection basic editor" });
  await editor.getByRole("button", { name: "Edit local draft" }).click();
  await editor.getByLabel("English name").fill("Across pages");
  page.once("dialog", async (dialog) => { await dialog.accept(); });
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
  page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.accept(); });
  await page.getByRole("navigation", { name: "Collection member pages" }).getByRole("link", { name: "Next" }).click();
  await expect(memberEditor.locator("[data-product-id]")).toHaveCount(50);
  await expect(first.getByRole("button", { name: "Restore locally" })).toBeVisible();
  await expect(basic.getByLabel("English name")).toHaveValue("Unsaved basic");
  page.once("dialog", async (dialog) => { await dialog.accept(); });
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
  page.once("dialog", async (dialog) => { await dialog.dismiss(); });
  await page.getByRole("link", { name: "Back to Collections" }).click();
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
    await expect(editor.getByText(`Current member page: ${state}. No new member facts were accepted; checking is paused.`)).toBeVisible();
    await expect(row.getByRole("button", { name: "Restore locally" })).toBeDisabled();
    await expect(editor.getByText("Unsaved membership changes")).toBeVisible();
  }
  await controls.getByRole("button", { name: "Reconnect" }).click();
  await expect(row.getByRole("button", { name: "Restore locally" })).toBeEnabled();
  await editor.getByRole("button", { name: "Discard membership changes" }).click();
  await expect(editor.getByText("No membership changes")).toBeVisible();
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
