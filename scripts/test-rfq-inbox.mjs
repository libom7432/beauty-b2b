import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { requireRFQRead, checkRFQReadAccess } from "../src/lib/rfq/inbox-auth.ts";
import { createRFQInboxRepository, RFQ_INBOX_PAGE_SIZE } from "../src/lib/rfq/inbox.ts";
import { visibleAdminNavigation, adminRouteLabel } from "../src/lib/admin/navigation.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const stamp = "2026-11-10T10:00:00.000Z";
const admin = { admin_id: id(99), identity_provider: "test", provider_subject: "owner",
  status: "active", created_at: stamp, disabled_at: null, permissions: ["rfq.read"] };
function auth() {
  const state = { session: "owner", record: admin, calls: 0 };
  const dependencies = {
    provider: { async verifySession(session) {
      state.calls++;
      return session && session === state.session ? { identity_provider: "test", provider_subject: "owner" } : null;
    } },
    directory: { async findByProviderIdentity() { return state.record; } },
  };
  return { state, dependencies };
}
const item = (belowMoq = true) => ({ productId: id(3), sku: "SKU-3", variantId: id(4),
  quantity: 50, productName: "Sample item", moqAtSubmission: belowMoq === null ? null : 100,
  moqUnitAtSubmission: belowMoq === null ? null : "pieces", belowMoq });
const detail = (n = 1, belowMoq = true) => ({ id: id(n), rfqNumber: `RFQ-${n}`,
  createdAt: new Date(Date.parse(stamp) - n * 1000).toISOString(), status: "received",
  companyName: "Example Co", fullName: "Example Buyer", email: "buyer@example.invalid",
  country: "US", whatsapp: "+10000000000", requirements: "Sample purchase request",
  hasBelowMoq: false, items: [item(belowMoq)], secret: "never output" });
const listRow = (row) => ({ id: row.id, rfqNumber: row.rfqNumber, createdAt: row.createdAt,
  status: row.status, companyName: row.companyName,
  itemMoqStates: row.items.map((entry) => entry.belowMoq),
  email: "must not appear in summary" });
function fixture(rows = [detail()]) {
  const state = { reads: 0, requests: [] };
  const source = {
    async list(query) {
      state.reads++; state.requests.push(query);
      return rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .slice((query.page - 1) * RFQ_INBOX_PAGE_SIZE,
          (query.page - 1) * RFQ_INBOX_PAGE_SIZE + query.limit).map(listRow);
    },
    async getById(requested) { state.reads++; return rows.find((row) => row.id === requested) ?? null; },
  };
  const authorization = auth();
  const repository = createRFQInboxRepository(source,
    async () => { await requireRFQRead(authorization.state.session, authorization.dependencies); });
  return { state, source, authorization, repository };
}
const denied = (task, code) => assert.rejects(task, (error) => error?.code === code);

test("verified rfq.read is independent of catalog.read and client role claims", async () => {
  const { state, dependencies } = auth();
  assert.equal(await requireRFQRead("owner", dependencies), admin.admin_id);
  state.record = { ...admin, permissions: ["catalog.read"] };
  await denied(requireRFQRead({ role: "super_admin", permissions: ["rfq.read"] }, dependencies), "PERMISSION_DENIED");
  await denied(requireRFQRead("owner", dependencies), "PERMISSION_DENIED");
  assert.equal(await checkRFQReadAccess("owner", dependencies), "forbidden");
  state.record = { ...admin, permissions: ["rfq.read"] };
  assert.equal(await checkRFQReadAccess("owner", dependencies), "allowed");
});

test("anonymous, expired session and disabled account cannot read", async () => {
  const { state, dependencies } = auth();
  assert.equal(await checkRFQReadAccess(null, dependencies), "anonymous");
  state.session = null;
  await denied(requireRFQRead("owner", dependencies), "PERMISSION_DENIED");
  state.session = "owner";
  state.record = { ...admin, status: "disabled", disabled_at: stamp };
  assert.equal(await checkRFQReadAccess("owner", dependencies), "forbidden");
});

test("each list and detail read checks auth before source access", async () => {
  const f = fixture();
  f.authorization.state.record = { ...admin, permissions: ["catalog.read"] };
  await denied(f.repository.list(), "FORBIDDEN");
  await denied(f.repository.getById(id(1)), "FORBIDDEN");
  assert.equal(f.state.reads, 0);
  f.authorization.state.record = admin;
  assert.equal((await f.repository.list()).items.length, 1);
  f.authorization.state.session = null;
  await denied(f.repository.getById(id(1)), "FORBIDDEN");
  assert.equal(f.state.reads, 1);
});

test("bounded pagination is ordered newest first and does not expose contact fields", async () => {
  const f = fixture(Array.from({ length: 22 }, (_, index) => detail(index + 1)));
  const first = await f.repository.list(1);
  assert.equal(first.items.length, 20);
  assert.equal(first.hasMore, true);
  assert.deepEqual(f.state.requests[0], { page: 1, limit: 21 });
  assert.deepEqual(first.items.map((row) => row.id), Array.from({ length: 20 }, (_, index) => id(index + 1)));
  assert.equal(first.items[0].hasBelowMoq, true);
  assert.doesNotMatch(JSON.stringify(first), /buyer@example|Example Buyer|never output|must not appear/);
  const second = await f.repository.list(2);
  assert.equal(second.items.length, 2);
  assert.equal(second.hasMore, false);
  for (const page of [0, -1, 1.5, 1001, Number.MAX_SAFE_INTEGER])
    await denied(f.repository.list(page), "INVALID_INPUT");
  assert.equal(f.state.reads, 2);
});

test("missing and invalid IDs are distinct from authorization failures", async () => {
  const f = fixture();
  await denied(f.repository.getById("bad"), "INVALID_INPUT");
  await denied(f.repository.getById(id(2)), "NOT_FOUND");
  assert.equal((await f.repository.getById(id(1))).email, "buyer@example.invalid");
  f.authorization.state.record = { ...admin, permissions: [] };
  await denied(f.repository.getById(id(1)), "FORBIDDEN");
});

test("historical missing MOQ remains unknown and malformed snapshots fail closed", async () => {
  const old = fixture([detail(1, null)]);
  assert.equal((await old.repository.list()).items[0].hasBelowMoq, null);
  const shown = await old.repository.getById(id(1));
  assert.deepEqual([shown.items[0].moqAtSubmission, shown.items[0].moqUnitAtSubmission,
    shown.items[0].belowMoq], [null, null, null]);
  const malformed = detail();
  malformed.items[0].belowMoq = false;
  await denied(fixture([malformed]).repository.getById(id(1)), "SOURCE_UNAVAILABLE");
});

test("absent real source and source errors do not fall back to fixtures or leak details", async () => {
  const disconnected = createRFQInboxRepository(null, async () => {});
  await denied(disconnected.list(), "NOT_CONNECTED");
  await denied(disconnected.getById(id(1)), "NOT_CONNECTED");
  const f = fixture();
  const failing = createRFQInboxRepository({
    async list() { throw Error("postgres://private-secret"); },
    async getById() { throw Error("buyer@example.invalid"); },
  }, async () => { await requireRFQRead(f.authorization.state.session, f.authorization.dependencies); });
  for (const action of [() => failing.list(), () => failing.getById(id(1))]) {
    await assert.rejects(action, (error) => error?.code === "SOURCE_UNAVAILABLE" &&
      !/private-secret|buyer@example/.test(String(error)));
  }
});

test("navigation grant and mobile layout remain separate from Catalog", () => {
  assert.deepEqual(visibleAdminNavigation(["catalog.read"]).map((item) => item.label),
    ["Dashboard", "Products", "Categories", "Collections", "Media"]);
  assert.deepEqual(visibleAdminNavigation(["rfq.read"]).map((item) => item.label), ["Dashboard", "RFQ Inbox"]);
  assert.equal(adminRouteLabel(`/admin/rfq/${id(1)}`), "RFQ detail");
  const css = readFileSync(new URL("../src/styles/admin.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 600px\).*admin-rfq-fields/s);
  assert.match(css, /admin-mobile-dialog/);
});

const require = createRequire(import.meta.url);
const loadComponent = (path, extra = {}) => {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const compiled = { exports: {} };
  const localRequire = (name) => extra[name] ?? (name === "next/link"
    ? { default: ({ href, children, ...props }) => createElement("a", { href, ...props }, children) }
    : require(name));
  new Function("module", "exports", "require", js)(compiled, compiled.exports, localRequire);
  return compiled.exports;
};
const guardLinks = { GuardedAdminLink: ({ href, children, className }) =>
  createElement("a", { href, className }, children) };
const ui = loadComponent("src/components/admin/ui.tsx", { "./admin-unsaved-changes": guardLinks });
const { RFQInboxListPanel, RFQInboxDetailPanel } = loadComponent("src/components/admin/rfq-inbox-panel.tsx", {
  "./ui": ui, "./admin-unsaved-changes": guardLinks });
const render = (component, props) => renderToStaticMarkup(createElement(component, props));

test("synthetic UI marks low and historical MOQ without showing list contact data", async () => {
  const f = fixture([detail(1, true), detail(2, null)]);
  const list = render(RFQInboxListPanel, { result: await f.repository.list(), demo: true });
  assert.match(list, /SYNTHETIC DATA/);
  assert.match(list, /Below MOQ/);
  assert.match(list, /Historical MOQ unknown/);
  assert.match(list, /aria-label="RFQ pages"/);
  assert.match(list, /\/admin\/rfq\/00000001/);
  assert.doesNotMatch(list, /buyer@example|Example Buyer|never output/);
  const details = render(RFQInboxDetailPanel, { detail: await f.repository.getById(id(2)), demo: true });
  assert.match(details, /buyer@example.invalid/);
  assert.match(details, /Historical MOQ unknown/);
  assert.doesNotMatch(details, /never output/);
});

test("loading, empty, unauthorized and unavailable states are explicit", () => {
  for (const state of ["loading", "not_connected", "unavailable", "invalid", "unauthorized"])
    assert.ok(render(RFQInboxListPanel, { state }).length > 30);
  assert.match(render(RFQInboxListPanel, { result: { items: [], page: 1, hasMore: false } }), /No inquiries/);
  assert.match(render(RFQInboxListPanel, { state: "unauthorized" }), /permission to read inquiries/);
});

test("production pages stay disconnected, dynamic and never import synthetic data", () => {
  for (const relative of ["src/app/admin/(workspace)/rfq/page.tsx", "src/app/admin/(workspace)/rfq/[id]/page.tsx"]) {
    const source = readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
    assert.match(source, /serverRFQInboxRepository/);
    assert.match(source, /force-dynamic/);
    assert.match(source, /force-no-store/);
    assert.doesNotMatch(source, /mockProducts|fixture|createOfflineCatalogSource/);
  }
  const server = readFileSync(new URL("../src/lib/rfq/inbox-server.ts", import.meta.url), "utf8");
  assert.match(server, /createRFQInboxRepository\(null,/);
  assert.match(server, /admin\?rfq=forbidden/);
  assert.doesNotMatch(server, /new Pool|DATABASE_URL|service_role/);
  const dashboard = readFileSync(new URL("../src/app/admin/(workspace)/page.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /You do not have permission to read inquiries/);
});
