import { expect, test, type Page } from "@playwright/test";
import { fixtureCookies, fixtureOrigin, startAdminFixture, stopAdminFixture } from "./support/admin-site";

const id = "00000001-0000-4000-8000-000000000000";
const detailUrl = () => `${fixtureOrigin}/admin/collections/${id}`;
test.beforeAll(async () => { await startAdminFixture(); });
test.afterAll(async () => { await stopAdminFixture(); });
test.setTimeout(120_000);

async function openProbe(context: { addCookies: (cookies: { name: string; value: string; url: string }[]) => Promise<void> },
  page: Page, state = "collections", path = detailUrl()) {
  await fixtureCookies(context, state);
  await context.addCookies([{ name: "admin-guard-probe", value: "1", url: fixtureOrigin }]);
  await page.goto(path);
  await expect(page.locator(".admin-shell")).toBeVisible();
}

test("clean intent navigates without a dialog", async ({ page, context }) => {
  await openProbe(context, page);
  await expect(page.getByTestId("admin-guard-probe")).toBeVisible();
  await page.getByRole("button", { name: "Probe Dashboard" }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
  await expect(page.getByRole("dialog", { name: /Unsaved local changes/ })).toBeHidden();
});

test("current Collection Dirty and Shell-wide Dirty are separate readings", async ({ page, context }) => {
  await openProbe(context, page);
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Collection A draft");
  page.once("dialog", async (dialog) => dialog.accept());
  await page.getByRole("link", { name: "Back to Collections" }).click();
  await page.locator('a[href="/admin/collections/00000002-0000-4000-8000-000000000000"]').first().click();
  await expect(page).toHaveURL(/00000002-0000-4000-8000-000000000000/);
  await expect(page.locator(".admin-shell")).toBeVisible();
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  await page.getByRole("button", { name: "Probe Collection scope" }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
  await expect(page.getByRole("dialog", { name: /Unsaved local changes/ })).toBeHidden();
});

test("Basic and Membership share one confirmation; cancel restores focus and keeps drafts", async ({ page, context }) => {
  await openProbe(context, page);
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  const member = page.getByRole("region", { name: "Local collection membership editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Guarded Basic");
  await member.locator('[data-product-id="00000101-0000-4000-8000-000000000000"]')
    .getByRole("button", { name: "Remove locally" }).click();
  const trigger = page.getByRole("button", { name: "Probe Dashboard" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Stay and keep editing/ })).toBeFocused();
  await expect(dialog).toContainText("not saved to the server");
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest(".admin-guard-dialog") !== null)).toBe(true);
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.activeElement?.closest(".admin-guard-dialog") !== null)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(basic.getByLabel("English name")).toHaveValue("Guarded Basic");
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  await trigger.click();
  await dialog.getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
  await page.goBack();
  await expect(member.getByText("Unsaved membership changes")).toBeVisible();
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await expect(basic.getByLabel("English name")).toHaveValue("Guarded Basic");
});

test("one intent owns the dialog and a second target cannot replace it", async ({ page, context }) => {
  await openProbe(context, page);
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("One intent");
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[aria-label="Isolated guard probe"] button')?.click();
    document.querySelectorAll<HTMLButtonElement>('[aria-label="Isolated guard probe"] button')[1]?.click();
  });
  await expect(page.getByTestId("guard-probe-results")).toContainText("PENDING,REJECTED");
  const dialog = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(dialog).toHaveCount(1);
  await dialog.getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
});

test("a cancelled intent ID cannot approve a later navigation", async ({ page, context }) => {
  await openProbe(context, page);
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Generation guard");
  const dialog = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await page.getByRole("button", { name: "Probe Dashboard" }).click();
  const firstId = Number(await dialog.getAttribute("data-navigation-intent-id"));
  await dialog.getByRole("button", { name: /Stay and keep editing/ }).click();
  await expect(page.locator(".admin-guard-dialog")).toHaveAttribute("data-navigation-lifecycle", "CANCELLED");
  await page.getByLabel("Probe approval ID").fill(String(firstId));
  await page.getByRole("button", { name: "Probe Products" }).click();
  const secondId = Number(await dialog.getAttribute("data-navigation-intent-id"));
  expect(secondId).toBeGreaterThan(firstId);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(
    '[aria-label="Isolated guard probe"] button:last-of-type')?.click());
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(detailUrl());
  await dialog.getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin/products`);
});

test("live Discard clears Dirty while the dialog is open and beforeunload stays compatible", async ({ page, context }) => {
  await openProbe(context, page);
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Temporary draft");
  const isUnloadBlocked = () => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(await isUnloadBlocked()).toBe(true);
  await page.getByRole("button", { name: "Probe Dashboard" }).click();
  const dialog = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(
    '[aria-label="Local collection basic editor"] button')]
    .find((button) => button.textContent?.includes("Discard changes"))?.click());
  await expect(basic.getByText("No local changes")).toBeVisible();
  expect(await isUnloadBlocked()).toBe(false);
  await dialog.getByRole("button", { name: /Continue navigation/ }).click();
  await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
});

test("origin changes and a synchronous identity lock invalidate the old intent", async ({ page, context }) => {
  await openProbe(context, page);
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Still here");
  const trigger = page.getByRole("button", { name: "Probe Dashboard" });
  const dialog = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await trigger.click();
  await page.evaluate(() => {
    history.pushState({}, "", `${location.pathname}?guard_probe_origin=changed`);
    document.querySelector<HTMLButtonElement>(".admin-guard-actions button:last-child")?.click();
  });
  await expect(page).not.toHaveURL(`${fixtureOrigin}/admin`);
  await expect(dialog).toBeHidden();
  await page.evaluate(() => history.replaceState({}, "", location.pathname));
  await trigger.click();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.querySelector<HTMLButtonElement>(".admin-guard-actions button:last-child")?.click();
  });
  await expect(page).not.toHaveURL(`${fixtureOrigin}/admin`);
  await expect(dialog).toBeHidden();
});

test("catalog permission revocation closes an open intent before it can navigate", async ({ page, context }) => {
  await openProbe(context, page);
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("No permission");
  await page.getByRole("button", { name: "Probe Dashboard" }).click();
  const dialog = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(dialog).toBeVisible();
  await fixtureCookies(context, "collections", "dashboard");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(`${fixtureOrigin}/admin`);
});

test("legacy Product and Category dirty sources reach the same dialog", async ({ page, context }) => {
  await openProbe(context, page, "success",
    `${fixtureOrigin}/admin/products/id/00000002-0000-4000-8000-000000000000`);
  await page.getByRole("button", { name: "Edit local draft" }).click();
  await page.getByRole("region", { name: "Local product editor" })
    .getByRole("group", { name: "English translation" }).getByLabel("Name").fill("Legacy Product");
  await page.getByRole("button", { name: "Probe Dashboard" }).click();
  await expect(page.getByRole("dialog", { name: /Unsaved local changes/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await openProbe(context, page, "category", `${fixtureOrigin}/admin/categories`);
  await page.getByRole("region", { name: "Category hierarchy" })
    .getByRole("button", { name: "Nails", exact: true }).click();
  await page.getByRole("region", { name: "Local category editor" })
    .getByLabel("English name").fill("Legacy Category");
  await page.getByRole("button", { name: "Probe Dashboard" }).click();
  await expect(page.getByRole("dialog", { name: /Unsaved local changes/ })).toBeVisible();
});

test("mobile menu closes before the guard modal and cancellation restores its trigger", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile viewport only");
  await openProbe(context, page);
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Mobile guard");
  const menuTrigger = page.getByRole("button", { name: "Open admin menu" });
  await menuTrigger.click();
  await expect(page.getByRole("dialog", { name: "Admin menu" })).toBeVisible();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(
    '[aria-label="Isolated guard probe"] button')?.click());
  await expect(page.getByRole("dialog", { name: "Admin menu" })).toBeHidden();
  const guard = page.getByRole("dialog", { name: /Unsaved local changes/ });
  await expect(guard).toBeVisible();
  expect(await page.evaluate(() => document.querySelectorAll("dialog[open]").length)).toBe(1);
  await page.keyboard.press("Escape");
  await expect(menuTrigger).toBeFocused();
});

for (const second of ["Probe Dashboard", "Probe Products"] as const) {
  test(`an approved navigation rejects ${second} while its RSC request is suspended`,
    async ({ page, context }) => {
      await openProbe(context, page);
      const basic = page.getByRole("region", { name: "Local collection basic editor" });
      await basic.getByRole("button", { name: "Edit local draft" }).click();
      await basic.getByLabel("English name").fill("In-flight draft");
      let release!: () => void;
      const hold = new Promise<void>((resolve) => { release = resolve; });
      const requests: string[] = [];
      await page.route("**/*", async (route) => {
        const request = route.request();
        if (new URL(request.url()).pathname === "/admin" && request.headers().rsc === "1") {
          requests.push(request.url());
          await hold;
        }
        await route.continue();
      });
      try {
        await page.getByRole("button", { name: "Probe Dashboard" }).click();
        const dialog = page.locator(".admin-guard-dialog");
        await expect(dialog).toBeVisible();
        const firstId = await dialog.getAttribute("data-navigation-intent-id");
        const firstRequest = page.waitForRequest((request) =>
          new URL(request.url()).pathname === "/admin" && request.headers().rsc === "1");
        await page.evaluate((secondName) => {
          document.querySelector<HTMLButtonElement>(".admin-guard-actions button:last-child")?.click();
          [...document.querySelectorAll<HTMLButtonElement>(
            '[aria-label="Isolated guard probe"] button')]
            .find((button) => button.textContent === secondName)?.click();
        }, second);
        await firstRequest;
        await expect(page.getByTestId("guard-probe-results")).toContainText("PENDING,REJECTED");
        await expect(dialog).toHaveAttribute("data-navigation-intent-id", firstId ?? "");
        await expect(dialog).toHaveAttribute("data-navigation-lifecycle", "NAVIGATING");
        await expect(dialog).toBeHidden();
        await expect(page.locator(".admin-guard-navigation-status")).toBeVisible();
        await expect(page).toHaveURL(detailUrl());
        expect(requests).toHaveLength(1);
        expect(await page.evaluate(() => {
          const event = new Event("beforeunload", { cancelable: true });
          window.dispatchEvent(event);
          return event.defaultPrevented;
        })).toBe(true);
        release();
        await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
        await expect(page.locator(".admin-guard-navigation-status")).toBeHidden();
      } finally { release(); }
    });
}

test("repeated Continue cannot execute an approved attempt twice", async ({ page, context }) => {
  await openProbe(context, page);
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("One approval");
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  let requestCount = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname === "/admin" && request.headers().rsc === "1") {
      requestCount++;
      await hold;
    }
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Probe Dashboard" }).click();
    const requestStarted = page.waitForRequest((request) =>
      new URL(request.url()).pathname === "/admin" && request.headers().rsc === "1");
    await page.evaluate(() => {
      const continueButton = document.querySelector<HTMLButtonElement>(
        ".admin-guard-actions button:last-child");
      continueButton?.click();
      continueButton?.click();
      document.querySelector<HTMLButtonElement>(
        '[aria-label="Isolated guard probe"] button:nth-of-type(2)')?.click();
    });
    await requestStarted;
    await expect(page.getByTestId("guard-probe-results")).toContainText("PENDING,REJECTED");
    expect(requestCount).toBe(1);
    release();
    await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
  } finally { release(); }
});

test("clean same-task submissions also keep one in-flight attempt", async ({ page, context }) => {
  await openProbe(context, page);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  let requestCount = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname === "/admin" && request.headers().rsc === "1") {
      requestCount++;
      await hold;
    }
    await route.continue();
  });
  try {
    const started = page.waitForRequest((request) =>
      new URL(request.url()).pathname === "/admin" && request.headers().rsc === "1");
    await page.evaluate(() => {
      const probe = document.querySelector<HTMLButtonElement>(
        '[aria-label="Isolated guard probe"] button');
      probe?.click();
      probe?.click();
    });
    await started;
    await expect(page.getByTestId("guard-probe-results")).toContainText("EXECUTED,REJECTED");
    await expect(page.locator(".admin-guard-dialog")).toHaveAttribute(
      "data-navigation-lifecycle", "NAVIGATING");
    await expect(page.locator(".admin-guard-dialog")).toBeHidden();
    expect(requestCount).toBe(1);
    release();
    await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
  } finally { release(); }
});

test("an external route change cannot give a suspended target to a new attempt", async ({ page, context }) => {
  await openProbe(context, page);
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("External route retains draft");
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname === "/admin" && request.headers().rsc === "1")
      await hold;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Probe Dashboard" }).click();
    const started = page.waitForRequest((request) =>
      new URL(request.url()).pathname === "/admin" && request.headers().rsc === "1");
    await page.getByRole("dialog", { name: /Unsaved local changes/ })
      .getByRole("button", { name: /Continue navigation/ }).click();
    await started;
    await page.evaluate(() => history.pushState(null, "", `${location.pathname}?member_cursor=external`));
    await expect(page).toHaveURL(/member_cursor=external/);
    await expect(page.locator(".admin-guard-dialog")).toHaveAttribute(
      "data-navigation-lifecycle", "INVALIDATED");
    await page.getByRole("button", { name: "Probe Dashboard" }).click();
    await expect(page.getByTestId("guard-probe-results")).toContainText("PENDING,REJECTED");
    await expect(basic.getByLabel("English name")).toHaveValue("External route retains draft");
  } finally { release(); }
});

test("a failed RSC request cannot create a second Guard navigation", async ({ page, context }) => {
  await openProbe(context, page);
  const basic = page.getByRole("region", { name: "Local collection basic editor" });
  await basic.getByRole("button", { name: "Edit local draft" }).click();
  await basic.getByLabel("English name").fill("Failure retains draft");
  let failedRequests = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname === "/admin" && request.headers().rsc === "1") {
      failedRequests++;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Probe Dashboard" }).click();
  const started = page.waitForRequest((request) =>
    new URL(request.url()).pathname === "/admin" && request.headers().rsc === "1");
  await page.getByRole("dialog", { name: /Unsaved local changes/ })
    .getByRole("button", { name: /Continue navigation/ }).click();
  await started;
  // Next may commit its route-level error boundary at the target even when the
  // RSC request fails. That is a committed route, not a recoverable origin.
  await expect(page).toHaveURL(`${fixtureOrigin}/admin`);
  expect(failedRequests).toBe(1);
});

test("a stalled navigation can resume editing without granting its old target to a new attempt",
  async ({ page, context }) => {
    await openProbe(context, page);
    const basic = page.getByRole("region", { name: "Local collection basic editor" });
    await basic.getByRole("button", { name: "Edit local draft" }).click();
    await basic.getByLabel("English name").fill("Retained during stall");
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (new URL(request.url()).pathname === "/admin" && request.headers().rsc === "1")
        await hold;
      await route.continue();
    });
    try {
      await page.getByRole("button", { name: "Probe Dashboard" }).click();
      const requestStarted = page.waitForRequest((request) =>
        new URL(request.url()).pathname === "/admin" && request.headers().rsc === "1");
      await page.getByRole("dialog", { name: /Unsaved local changes/ })
        .getByRole("button", { name: /Continue navigation/ }).click();
      await requestStarted;
      const resume = page.getByRole("button", { name: /Resume editing/ });
      await expect(resume).toBeVisible();
      await expect(resume).toBeFocused();
      await resume.click();
      await expect(basic.getByLabel("English name")).toHaveValue("Retained during stall");
      await page.getByRole("button", { name: "Probe Dashboard" }).click();
      await expect(page.getByTestId("guard-probe-results")).toContainText("PENDING,REJECTED");
      await expect(page.getByRole("dialog", { name: /Unsaved local changes/ })).toBeHidden();
      await page.getByRole("button", { name: "Probe Products" }).click();
      await expect(page.getByTestId("guard-probe-results")).toContainText("PENDING,REJECTED,PENDING");
      await expect(page.getByRole("dialog", { name: /Unsaved local changes/ })).toBeVisible();
      release();
      await expect(page.getByRole("dialog", { name: /Unsaved local changes/ })).toBeVisible();
    } finally { release(); }
  });

test("identity lock invalidates a navigation after approval without changing the dirty draft",
  async ({ page, context }) => {
    await openProbe(context, page);
    const basic = page.getByRole("region", { name: "Local collection basic editor" });
    await basic.getByRole("button", { name: "Edit local draft" }).click();
    await basic.getByLabel("English name").fill("Access bound");
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (new URL(request.url()).pathname === "/admin" && request.headers().rsc === "1")
        await hold;
      await route.continue();
    });
    try {
      await page.getByRole("button", { name: "Probe Dashboard" }).click();
      const requestStarted = page.waitForRequest((request) =>
        new URL(request.url()).pathname === "/admin" && request.headers().rsc === "1");
      await page.getByRole("dialog", { name: /Unsaved local changes/ })
        .getByRole("button", { name: /Continue navigation/ }).click();
      await requestStarted;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.locator(".admin-guard-dialog")).toHaveAttribute(
        "data-navigation-lifecycle", "INVALIDATED");
      await expect(page.locator(".admin-guard-navigation-status")).toBeHidden();
      await expect(basic.getByLabel("English name")).toHaveValue("Access bound");
    } finally { release(); }
  });
