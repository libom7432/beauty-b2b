import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { requireCatalogPermission } from "../src/lib/catalog-import/admin-auth.ts";
import { assertVerifiedCatalogActor } from "../src/lib/catalog-import/transaction.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const account = (admin_id, provider_subject, permissions, status = "active") => ({
  admin_id, identity_provider: "test-only", provider_subject, permissions, status,
  created_at: "2026-01-01T00:00:00Z", disabled_at: status === "disabled" ? "2026-02-01T00:00:00Z" : null,
});
const entries = new Map([
  ["admin-a", account(A, "admin-a", ["catalog.import.preview", "catalog.import.commit", "catalog.import.receipt.read"])],
  ["admin-b", account(B, "admin-b", ["catalog.import.receipt.read"])],
  ["disabled", account("33333333-3333-4333-8333-333333333333", "disabled", ["catalog.import.commit"], "disabled")],
  ["customer", account("44444444-4444-4444-8444-444444444444", "customer", [])],
]);
// The fake provider exists only in this test file. It is not exported from application source.
const dependencies = {
  provider: { verifySession: async (session) => typeof session === "string" && entries.has(session)
    ? { identity_provider: "test-only", provider_subject: session } : null },
  directory: { findByProviderIdentity: async ({ identity_provider, provider_subject }) =>
    identity_provider === "test-only" ? entries.get(provider_subject) ?? null : null },
};
const permit = (session, permission, deps = dependencies) => requireCatalogPermission(session, permission, deps);
const denied = (promise) => assert.rejects(promise, (error) => error?.code === "PERMISSION_DENIED");

test("unauthenticated, ordinary user, disabled admin and missing grant are denied", async () => {
  await denied(permit(null, "catalog.import.preview"));
  await denied(permit("customer", "catalog.import.preview"));
  await denied(permit("disabled", "catalog.import.commit"));
  await denied(permit("admin-b", "catalog.import.commit"));
  await denied(permit("admin-a", "catalog.import.unknown"));
  await denied(permit("admin-a", "catalog.import.commit", { ...dependencies, directory: { findByProviderIdentity: async () => null } }));
});

test("verified admin receives only a server-derived stable actor identity", async () => {
  const authorized = await permit("admin-a", "catalog.import.commit");
  assert.equal(authorized.admin_id, A);
  assert.equal(authorized.actor_id, A);
  assert.equal(authorized.actor_context.actor_id, A);
  assert.equal(authorized.permission, "catalog.import.commit");
  assertVerifiedCatalogActor(authorized.actor_context);
  assert.ok(Object.isFrozen(authorized));
  await denied(permit({ actor_id: B, role: "catalog_admin", session: "admin-a" }, "catalog.import.commit"));
  assert.throws(() => assertVerifiedCatalogActor({ actor_id: A, role: "catalog_import" }), (error) => error?.code === "PERMISSION_DENIED");
});

test("different admins cannot substitute identities for receipt recovery", async () => {
  const first = await permit("admin-a", "catalog.import.receipt.read");
  const second = await permit("admin-b", "catalog.import.receipt.read");
  assert.equal(first.actor_id, A);
  assert.equal(second.actor_id, B);
  assert.notEqual(first.actor_id, second.actor_id);
  assert.equal(Object.hasOwn(first, "actor_context"), false);
  assert.equal(Object.hasOwn(second, "actor_context"), false);
  // A receipt lookup must use the actor ID from the newly verified session.
  assert.equal(`${first.actor_id}\0key-1` === `${second.actor_id}\0key-1`, false);
});

test("preview grant cannot produce a commit-capable transaction context", async () => {
  const preview = await permit("admin-a", "catalog.import.preview");
  assert.equal(preview.actor_id, A);
  assert.equal(Object.hasOwn(preview, "actor_context"), false);
  assert.throws(() => assertVerifiedCatalogActor(preview), (error) => error?.code === "PERMISSION_DENIED");
});

test("account disablement is effective on the next request", async () => {
  await permit("admin-a", "catalog.import.commit");
  const original = entries.get("admin-a");
  entries.set("admin-a", { ...original, status: "disabled", disabled_at: "2026-02-01T00:00:00Z" });
  try { await denied(permit("admin-a", "catalog.import.commit")); }
  finally { entries.set("admin-a", original); }
});

test("directory cannot return a mismatched subject or invalid administrator identity", async () => {
  await denied(permit("admin-a", "catalog.import.commit", {
    ...dependencies, directory: { findByProviderIdentity: async () => entries.get("admin-b") },
  }));
  await denied(permit("admin-a", "catalog.import.commit", {
    ...dependencies, directory: { findByProviderIdentity: async () => ({ ...entries.get("admin-a"), admin_id: "client-chosen" }) },
  }));
});

test("fake provider is restricted to tests; no production route or fake module exists", () => {
  const source = readFileSync(new URL("../src/lib/catalog-import/admin-auth.ts", import.meta.url), "utf8");
  assert.ok(!source.includes("test-only"));
  assert.ok(!source.includes("fakeProvider"));
  assert.ok(!source.includes("process.env.NODE_ENV"));
});
