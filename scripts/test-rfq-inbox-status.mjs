import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { requireRFQManage } from "../src/lib/rfq/inbox-auth.ts";
import { createRFQStatusService } from "../src/lib/rfq/inbox-status.ts";
import { createRFQInboxRepository } from "../src/lib/rfq/inbox.ts";

const rfqId = "00000001-0000-4000-8000-000000000000";
const adminId = "00000002-0000-4000-8000-000000000000";
const operationId = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const instant = "2026-11-10T12:00:00.000Z";
const command = (from = "received", to = "reviewed", version = 0, op = operationId(1)) =>
  ({ rfqId, operationId: op, expectedStatus: from, expectedVersion: version, targetStatus: to });
const denied = (task, code) => assert.rejects(task, (error) => error?.code === code);

function auth() {
  const state = { session: "active", status: "active", grants: ["rfq.manage"], subject: "owner" };
  const dependencies = {
    provider: { async verifySession(value) {
      return value && value === state.session ? { identity_provider: "test", provider_subject: state.subject } : null;
    } },
    directory: { async findByProviderIdentity() {
      return { admin_id: adminId, identity_provider: "test", provider_subject: "owner",
        status: state.status, disabled_at: state.status === "active" ? null : instant,
        created_at: instant, permissions: state.grants };
    } },
  };
  return { state, dependencies };
}

function fixture(initialStatus = "received") {
  const identity = auth();
  const state = { status: initialStatus, version: 0, audit: [], calls: 0, fail: false };
  const operations = new Map();
  let queue = Promise.resolve();
  const source = { transitionAtomically(input) {
    const work = queue.then(() => {
      state.calls++;
      const prior = operations.get(input.operationId);
      if (prior) {
        const same = prior.input.rfqId === input.rfqId && prior.input.actorId === input.actorId &&
          prior.input.expectedStatus === input.expectedStatus && prior.input.expectedVersion === input.expectedVersion &&
          prior.input.targetStatus === input.targetStatus;
        return same ? { kind: "REPLAYED", audit: prior.audit } : { kind: "CONFLICT", reason: "OPERATION_REUSED" };
      }
      if (state.fail) throw Error("buyer@example.invalid; private database failure");
      if (state.status === null) return { kind: "NOT_FOUND" };
      if (!["received", "reviewed", "closed"].includes(state.status))
        return { kind: "CONFLICT", reason: "UNKNOWN_STATUS" };
      if (state.version !== input.expectedVersion) return { kind: "CONFLICT", reason: "STALE_VERSION" };
      if (state.status !== input.expectedStatus) return { kind: "CONFLICT", reason: "STATUS_MISMATCH" };
      const audit = { operationId: input.operationId, rfqId: input.rfqId, actorId: input.actorId,
        occurredAt: input.occurredAt, oldStatus: state.status, newStatus: input.targetStatus,
        oldVersion: state.version, newVersion: state.version + 1 };
      // One synthetic critical section mirrors the required future DB transaction.
      state.status = input.targetStatus;
      state.version += 1;
      state.audit.push(audit);
      operations.set(input.operationId, { input, audit });
      return { kind: "APPLIED", audit: { ...audit, privateEmail: "must not leak" } };
    });
    queue = work.catch(() => {});
    return work;
  } };
  const service = createRFQStatusService(source,
    () => requireRFQManage(identity.state.session, identity.dependencies), () => new Date(instant));
  return { identity, state, source, service };
}

test("approved transitions create ordered audit events with server actor and time", async () => {
  const f = fixture();
  const a = await f.service.changeStatus(command());
  const b = await f.service.changeStatus(command("reviewed", "closed", 1, operationId(2)));
  const c = await f.service.changeStatus(command("closed", "reviewed", 2, operationId(3)));
  assert.deepEqual([a.kind, b.kind, c.kind], ["APPLIED", "APPLIED", "APPLIED"]);
  assert.deepEqual([f.state.status, f.state.version, f.state.audit.length], ["reviewed", 3, 3]);
  assert.deepEqual([a.audit.actorId, a.audit.occurredAt, a.audit.oldStatus, a.audit.newStatus],
    [adminId, instant, "received", "reviewed"]);
  assert.doesNotMatch(JSON.stringify(f.state.audit), /privateEmail|buyer@example/);
  assert.doesNotMatch(JSON.stringify([a, b, c]), /privateEmail|must not leak|buyer@example/);
});

test("invalid and unknown transitions do not call the source", async () => {
  const f = fixture();
  for (const input of [command("reviewed", "received"), command("received", "closed"),
    command("closed", "closed")]) await denied(f.service.changeStatus(input), "INVALID_TRANSITION");
  for (const input of [command("unknown", "reviewed"), { ...command(), expectedVersion: -1 },
    { ...command(), actorId: adminId }, { ...command(), email: "buyer@example.invalid" },
    { ...command(), rfqId: "bad" }, { ...command(), targetStatus: "pending" }])
    await denied(f.service.changeStatus(input), "INVALID_INPUT");
  assert.equal(f.state.calls, 0);
});

test("read-only and Catalog grants cannot modify RFQ state", async () => {
  const f = fixture();
  for (const grants of [["rfq.read"], ["catalog.read"], ["catalog.read", "rfq.read"], []]) {
    f.identity.state.grants = grants;
    await denied(f.service.changeStatus(command()), "FORBIDDEN");
  }
  assert.equal(f.state.calls, 0);
  assert.equal(f.state.audit.length, 0);
});

test("expired session, disabled administrator and spoofed actor are rejected", async () => {
  const f = fixture();
  f.identity.state.session = null;
  await denied(f.service.changeStatus(command()), "FORBIDDEN");
  f.identity.state.session = "active";
  f.identity.state.status = "disabled";
  await denied(f.service.changeStatus(command()), "FORBIDDEN");
  f.identity.state.status = "active";
  await denied(f.service.changeStatus({ ...command(), actorId: operationId(99) }), "INVALID_INPUT");
  assert.equal(f.state.calls, 0);
});

test("concurrent expected-version writes conflict and create one event", async () => {
  const f = fixture();
  const outcomes = await Promise.allSettled([
    f.service.changeStatus(command("received", "reviewed", 0, operationId(1))),
    f.service.changeStatus(command("received", "reviewed", 0, operationId(2))),
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((result) => result.status === "rejected" && result.reason.code === "CONFLICT").length, 1);
  assert.equal(f.state.audit.length, 1);
  assert.equal(f.state.version, 1);
});

test("same operation replays one audit event; reused key with different command conflicts", async () => {
  const f = fixture();
  const first = await f.service.changeStatus(command());
  const replay = await f.service.changeStatus(command());
  assert.equal(first.kind, "APPLIED");
  assert.equal(replay.kind, "REPLAYED");
  assert.deepEqual(replay.audit, first.audit);
  assert.equal(f.state.audit.length, 1);
  await assert.rejects(f.service.changeStatus(command("reviewed", "closed", 1)),
    (error) => error?.code === "CONFLICT" && error?.reason === "OPERATION_REUSED");
  assert.equal(f.state.audit.length, 1);
});

test("unknown persisted status is blocked, never defaulted to received", async () => {
  const f = fixture("old_unknown");
  await assert.rejects(f.service.changeStatus(command()),
    (error) => error?.code === "CONFLICT" && error?.reason === "UNKNOWN_STATUS");
  assert.equal(f.state.status, "old_unknown");
  assert.equal(f.state.audit.length, 0);
});

test("read-only inbox accepts reviewed and closed but blocks unknown historical state", async () => {
  const row = { id: rfqId, rfqNumber: "RFQ-1", createdAt: instant, status: "reviewed",
    companyName: "Example Co", fullName: "Example Buyer", email: "buyer@example.invalid",
    country: "US", whatsapp: null, requirements: "Sample inquiry details",
    items: [{ productId: rfqId, sku: "SKU-1", variantId: adminId, quantity: 50,
      productName: "Sample item", moqAtSubmission: null, moqUnitAtSubmission: null, belowMoq: null }] };
  const reader = createRFQInboxRepository({
    async list() { return [{ id: row.id, rfqNumber: row.rfqNumber, createdAt: row.createdAt,
      status: row.status, companyName: row.companyName, itemMoqStates: [null] }]; },
    async getById() { return row; },
  }, async () => {});
  assert.equal((await reader.list()).items[0].status, "reviewed");
  row.status = "closed";
  assert.equal((await reader.getById(rfqId)).status, "closed");
  row.status = "legacy_unknown";
  await denied(reader.getById(rfqId), "SOURCE_UNAVAILABLE");
  await denied(reader.list(), "SOURCE_UNAVAILABLE");
});

test("simulated transaction failure preserves status and audit atomically", async () => {
  const f = fixture();
  f.state.fail = true;
  await assert.rejects(f.service.changeStatus(command()),
    (error) => error?.code === "SOURCE_UNAVAILABLE" && !/buyer@example|private database/.test(String(error)));
  assert.equal(f.state.status, "received");
  assert.equal(f.state.version, 0);
  assert.equal(f.state.audit.length, 0);
});

test("missing writer and unauthorized calls fail closed", async () => {
  const f = fixture();
  const absent = createRFQStatusService(null,
    () => requireRFQManage(f.identity.state.session, f.identity.dependencies));
  await denied(absent.changeStatus(command()), "NOT_CONNECTED");
  f.identity.state.grants = ["rfq.read"];
  await denied(absent.changeStatus(command()), "FORBIDDEN");
  assert.equal(f.state.calls, 0);
  const server = readFileSync(new URL("../src/lib/rfq/inbox-status-server.ts", import.meta.url), "utf8");
  assert.match(server, /createRFQStatusService\(null,/);
  assert.doesNotMatch(server, /new Pool|DATABASE_URL|service_role/);
});

test("unexpected adapter results are blocked without leaking contacts", async () => {
  const f = fixture();
  for (const result of [{ kind: "PASS" }, { kind: "APPLIED", audit: null },
    { kind: "CONFLICT", reason: "invented" }]) {
    const invalid = createRFQStatusService({ async transitionAtomically() { return result; } },
      () => requireRFQManage(f.identity.state.session, f.identity.dependencies));
    await denied(invalid.changeStatus(command()), "SOURCE_UNAVAILABLE");
  }
});

test("detail UI shows current status and disables every action while writer is absent", () => {
  const panel = readFileSync(new URL("../src/components/admin/rfq-inbox-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /Current status:/);
  assert.match(panel, /Viewing this inquiry does not change its status/);
  assert.equal((panel.match(/<button type="button" disabled>/g) ?? []).length, 3);
  assert.doesNotMatch(panel, /fetch\(|localStorage|sessionStorage/);
});
