import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createRFQInboxRepository, RFQ_INBOX_PAGE_SIZE,
  validInboxVariantId } from "../src/lib/rfq/inbox.ts";
import { createPostgreSQLRFQInboxSource, RFQ_INBOX_LIST_SQL,
  RFQ_INBOX_DETAIL_SQL, RFQ_INBOX_ITEMS_SQL } from "../src/lib/rfq/inbox-postgres.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const stamp = "2026-11-10T10:00:00.000Z";
const denied = (action, code) => assert.rejects(action,
  (error) => error?.code === code && !/buyer@example|postgres:\/\/|SELECT /.test(String(error)));
const snapshot = (terms = { moqAtSubmission: 100, moqUnitAtSubmission: "pieces", belowMoq: true }) => ({
  productName: { en: "Sample product", zh: "样品" }, productSlug: "sample-product",
  selectedVariant: { id: id(800), attributes: { color: "red" } }, ...terms,
});
function request(n, options = {}) {
  const { status = "received", createdAt = stamp, terms = snapshot() } = options;
  const row = { id: id(n), rfq_number: `RFQ-${n}`, created_at: createdAt, status,
    company_name: `Company ${n}`, full_name: "Example Buyer", email: "buyer@example.invalid",
    country: "US", whatsapp: "+10000000000", requirements: "Sample purchase requirements" };
  const item = { product_id: id(700), sku: "SKU-700", quantity: "50", product_snapshot: terms };
  return { row, items: [item] };
}
function legacyRequest(variantId = "concept-almond-nails-neutral") {
  const old = request(1, { terms: snapshot({}) });
  old.items[0].product_id = "concept-almond-nails";
  old.items[0].sku = "DEMO-PO-001-N";
  old.items[0].product_snapshot.selectedVariant.id = variantId;
  return old;
}
function moqEntry(item) {
  const keys = ["moqAtSubmission", "moqUnitAtSubmission", "belowMoq"];
  const terms = item.product_snapshot;
  const validShape = terms && !Array.isArray(terms) && typeof terms === "object" &&
    terms.productName && typeof terms.productName.en === "string" &&
    typeof terms.productName.zh === "string" && typeof terms.productSlug === "string" &&
    Object.hasOwn(terms, "selectedVariant") &&
    ((item.sku === null && terms.selectedVariant === null) ||
      (item.sku !== null && terms.selectedVariant && typeof terms.selectedVariant === "object"));
  return [item.quantity, ...keys.map((key) => item.product_snapshot[key] ?? null),
    ...keys.map((key) => Object.hasOwn(item.product_snapshot, key)), Boolean(validShape)];
}
function fixture(requests = [request(1)]) {
  const state = { calls: [], authorized: true, fail: false };
  const adapter = { async query(sql, values) {
    state.calls.push({ sql, values });
    if (state.fail) throw Error("postgres://private-secret SELECT buyer@example.invalid");
    if (sql === RFQ_INBOX_LIST_SQL) {
      const [limit, offset] = values;
      const rows = requests.slice().sort((a, b) =>
        b.row.created_at.localeCompare(a.row.created_at) || b.row.id.localeCompare(a.row.id))
        .slice(offset, offset + limit).map(({ row, items }) => ({
          ...row, moq_snapshots: items.map(moqEntry),
        }));
      return { rows };
    }
    if (sql === RFQ_INBOX_DETAIL_SQL) {
      const found = requests.find(({ row }) => row.id === values[0]);
      return { rows: found ? [found.row] : [] };
    }
    if (sql === RFQ_INBOX_ITEMS_SQL) {
      const found = requests.find(({ row }) => row.id === values[0]);
      return { rows: found?.items.slice(0, 101) ?? [] };
    }
    throw Error("Unexpected SQL");
  } };
  const source = createPostgreSQLRFQInboxSource(adapter);
  const inbox = createRFQInboxRepository(source, async () => {
    if (!state.authorized) throw Error("rfq.read denied");
  });
  return { state, adapter, source, inbox };
}
const require = createRequire(import.meta.url);
function component(path, dependencies = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const localRequire = (name) => dependencies[name] ?? (name === "next/link"
    ? { default: ({ href, children, ...props }) => createElement("a", { href, ...props }, children) }
    : require(name));
  new Function("module", "exports", "require", output)(compiled, compiled.exports, localRequire);
  return compiled.exports;
}

test("parameterized, bounded list pages with stable same-time ID ordering", async () => {
  assert.equal(moqEntry(request(1).items[0])[7], true);
  const f = fixture(Array.from({ length: 22 }, (_, index) => request(index + 1)));
  const first = await f.inbox.list(1);
  assert.equal(first.items.length, RFQ_INBOX_PAGE_SIZE);
  assert.equal(first.hasMore, true);
  assert.deepEqual(first.items.slice(0, 2).map((row) => row.id), [id(22), id(21)]);
  const second = await f.inbox.list(2);
  assert.deepEqual(second.items.map((row) => row.id), [id(2), id(1)]);
  assert.equal(second.hasMore, false);
  assert.deepEqual(f.state.calls.map((call) => call.values), [[21, 0], [21, 20]]);
  assert.match(RFQ_INBOX_LIST_SQL, /ORDER BY created_at DESC, id DESC[\s\S]*LIMIT \$1 OFFSET \$2/);
  assert.match(RFQ_INBOX_LIST_SQL, /FROM page ORDER BY page.created_at DESC, page.id DESC/);
  assert.match(RFQ_INBOX_LIST_SQL, /FROM rfq_private.rfq_items WHERE rfq_request_id = page.id[\s\S]*LIMIT 101/);
  assert.match(RFQ_INBOX_LIST_SQL, /jsonb_typeof\(i.product_snapshot->'productName'->'zh'\) = 'string'/);
  assert.doesNotMatch(RFQ_INBOX_LIST_SQL, /full_name|email|whatsapp|requirements|product_id|SELECT \*/i);
  assert.doesNotMatch(JSON.stringify(first), /buyer@example|Example Buyer|Sample purchase requirements/);
});

test("invalid and excessive pagination cannot reach the query adapter", async () => {
  const f = fixture();
  for (const page of [0, -1, 1.5, 1001, Infinity, "1", Number.MAX_SAFE_INTEGER])
    await denied(f.inbox.list(page), "INVALID_INPUT");
  for (const query of [{ page: 1, limit: 22 }, { page: 1001, limit: 21 },
    { page: 1, limit: 0 }, { page: 1.1, limit: 21 }])
    await denied(f.source.list(query), "INVALID_INPUT");
  assert.equal(f.state.calls.length, 0);
});

test("restricted detail retains identity, contact and all submission-time MOQ fields", async () => {
  const f = fixture();
  const detail = await f.inbox.getById(id(1));
  assert.deepEqual([detail.id, detail.rfqNumber, detail.companyName, detail.fullName, detail.email,
    detail.country, detail.whatsapp, detail.requirements],
  [id(1), "RFQ-1", "Company 1", "Example Buyer", "buyer@example.invalid",
    "US", "+10000000000", "Sample purchase requirements"]);
  assert.deepEqual(detail.items[0], { productId: id(700), sku: "SKU-700", variantId: id(800),
    quantity: 50, productName: "Sample product", moqAtSubmission: 100,
    moqUnitAtSubmission: "pieces", belowMoq: true });
  assert.equal(detail.hasBelowMoq, true);
  assert.deepEqual(f.state.calls.map((call) => call.values), [[id(1)], [id(1)]]);
  assert.match(RFQ_INBOX_DETAIL_SQL, /WHERE id = \$1 LIMIT 1/);
  assert.match(RFQ_INBOX_ITEMS_SQL, /WHERE rfq_request_id = \$1[\s\S]*LIMIT 101/);
  assert.doesNotMatch(RFQ_INBOX_DETAIL_SQL, /idempotency_key|request_fingerprint|website|buyer_type|customization/);
  assert.doesNotMatch(RFQ_INBOX_ITEMS_SQL, /SELECT \*/);
});

test("missing request and malformed IDs are controlled and bounded", async () => {
  const f = fixture();
  await denied(f.inbox.getById(id(2)), "NOT_FOUND");
  assert.equal(f.state.calls.length, 1);
  await denied(f.inbox.getById("bad"), "INVALID_INPUT");
  assert.equal(f.state.calls.length, 1);
  const excessive = request(3);
  excessive.items = Array.from({ length: 101 }, () => excessive.items[0]);
  await denied(fixture([excessive]).inbox.list(), "SOURCE_UNAVAILABLE");
  await denied(fixture([excessive]).inbox.getById(id(3)), "SOURCE_UNAVAILABLE");
});

test("historical missing MOQ remains unknown in list and detail", async () => {
  const old = request(1, { terms: snapshot({}) });
  const f = fixture([old]);
  assert.equal((await f.inbox.list()).items[0].hasBelowMoq, null);
  const detail = await f.inbox.getById(id(1));
  assert.deepEqual([detail.items[0].moqAtSubmission, detail.items[0].moqUnitAtSubmission,
    detail.items[0].belowMoq, detail.hasBelowMoq], [null, null, null, null]);
});

test("old Mock slug variant IDs retain their exact historical identity without Catalog lookup", async () => {
  for (const variantId of ["concept-almond-nails-neutral", "mock-square-french-short"]) {
    const f = fixture([legacyRequest(variantId)]);
    assert.equal((await f.inbox.list()).items[0].hasBelowMoq, null);
    const detail = await f.inbox.getById(id(1));
    assert.equal(detail.items[0].productId, "concept-almond-nails");
    assert.equal(detail.items[0].sku, "DEMO-PO-001-N");
    assert.equal(detail.items[0].variantId, variantId);
    assert.deepEqual([detail.items[0].moqAtSubmission, detail.items[0].moqUnitAtSubmission,
      detail.items[0].belowMoq], [null, null, null]);
    assert.deepEqual(f.state.calls.map((call) => call.sql),
      [RFQ_INBOX_LIST_SQL, RFQ_INBOX_DETAIL_SQL, RFQ_INBOX_ITEMS_SQL]);
  }
  assert.equal(validInboxVariantId("concept-almond-nails", "concept-almond-nails-neutral", true), true);
  assert.equal(validInboxVariantId(id(700), "concept-almond-nails-neutral", true), false);
  assert.equal(validInboxVariantId(id(700), "concept-almond-nails-neutral", false), false);
});

test("legacy compatibility does not accept missing, unsafe or overlong variant IDs", async () => {
  for (const variantId of [undefined, "", 42, "a".repeat(201),
    "<img src=x onerror=alert(1)>", "../private", "\nmalicious"]) {
    const old = legacyRequest();
    old.items[0].product_snapshot.selectedVariant.id = variantId;
    await denied(fixture([old]).inbox.getById(id(1)), "SOURCE_UNAVAILABLE");
  }
  const newTerms = snapshot();
  newTerms.selectedVariant.id = "concept-almond-nails-neutral";
  await denied(fixture([request(1, { terms: newTerms })]).inbox.getById(id(1)), "SOURCE_UNAVAILABLE");
  const mixed = legacyRequest();
  mixed.items[0].product_id = id(700);
  await denied(fixture([mixed]).inbox.getById(id(1)), "SOURCE_UNAVAILABLE");
  const legacyWithMoq = legacyRequest();
  Object.assign(legacyWithMoq.items[0].product_snapshot,
    { moqAtSubmission: 100, moqUnitAtSubmission: "pieces", belowMoq: true });
  await denied(fixture([legacyWithMoq]).inbox.getById(id(1)), "SOURCE_UNAVAILABLE");
});

test("historical snapshot text is escaped when the merchant detail is rendered", async () => {
  const old = legacyRequest();
  old.items[0].product_snapshot.productName.en = '<img src=x onerror=alert(1)>';
  old.row.requirements = '<script>alert("private")</script>';
  const detail = await fixture([old]).inbox.getById(id(1));
  const ui = component("src/components/admin/ui.tsx");
  const { RFQInboxDetailPanel } = component("src/components/admin/rfq-inbox-panel.tsx", { "./ui": ui });
  const html = renderToStaticMarkup(createElement(RFQInboxDetailPanel, { detail }));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /concept-almond-nails-neutral/);
});

test("malformed JSONB, partial MOQ and explicit null fail closed", async () => {
  for (const terms of [snapshot({ moqAtSubmission: 100 }),
    snapshot({ moqAtSubmission: null, moqUnitAtSubmission: null, belowMoq: null }),
    snapshot({ moqAtSubmission: 100, moqUnitAtSubmission: "pieces", belowMoq: false }),
    { productName: { en: "Sample product" }, productSlug: "sample-product",
      selectedVariant: { id: id(800), attributes: {} } },
    ["invalid"]]) {
    const f = fixture([request(1, { terms })]);
    if (!Array.isArray(terms)) await denied(f.inbox.list(), "SOURCE_UNAVAILABLE");
    await denied(f.inbox.getById(id(1)), "SOURCE_UNAVAILABLE");
  }
});

test("received, reviewed and closed parse strictly; unknown status fails closed", async () => {
  for (const value of ["received", "reviewed", "closed"]) {
    const f = fixture([request(1, { status: value })]);
    assert.equal((await f.inbox.list()).items[0].status, value);
    assert.equal((await f.inbox.getById(id(1))).status, value);
  }
  const invalid = fixture([request(1, { status: "other" })]);
  await denied(invalid.inbox.list(), "SOURCE_UNAVAILABLE");
  await denied(invalid.inbox.getById(id(1)), "SOURCE_UNAVAILABLE");
});

test("query failure, missing connection and revoked rfq.read never fall back to Mock", async () => {
  const f = fixture();
  f.state.fail = true;
  await denied(f.inbox.list(), "SOURCE_UNAVAILABLE");
  await denied(f.inbox.getById(id(1)), "SOURCE_UNAVAILABLE");
  const disconnected = createRFQInboxRepository(createPostgreSQLRFQInboxSource(null), async () => {});
  await denied(disconnected.list(), "NOT_CONNECTED");
  await denied(disconnected.getById(id(1)), "NOT_CONNECTED");
  f.state.fail = false;
  f.state.authorized = false;
  const calls = f.state.calls.length;
  await denied(f.inbox.list(), "FORBIDDEN");
  await denied(f.inbox.getById(id(1)), "FORBIDDEN");
  assert.equal(f.state.calls.length, calls);
});
