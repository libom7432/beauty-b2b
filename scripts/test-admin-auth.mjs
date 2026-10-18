import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { checkAdminAccess } from "../src/lib/admin/access.ts";
import { loginAdmin, logoutAdmin, supabasePasswordAuth } from "../src/lib/admin/login-flow.ts";
import { permissionsForRole } from "../src/lib/admin/permissions.ts";
import { requireCatalogPermission } from "../src/lib/catalog-import/admin-auth.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const active = { admin_id: ID, identity_provider: "fixture", provider_subject: "user-a",
  status: "active", created_at: "2026-10-18T00:00:00Z", disabled_at: null,
  permissions: permissionsForRole("catalog_editor") };
function setup() {
  const state = { current: null, record: active, signedOut: false };
  const dependencies = {
    provider: { async verifySession() { return state.current ? { identity_provider: "fixture", provider_subject: state.current.subject } : null; } },
    directory: { async findByProviderIdentity() { return state.record; } },
  };
  return { state, dependencies };
}

test("anonymous, ordinary, disabled and underprivileged users cannot enter protected pages", async () => {
  const { state, dependencies } = setup();
  assert.equal(await checkAdminAccess(null, dependencies), "anonymous");
  state.current = { subject: "user-a" };
  state.record = null;
  assert.equal(await checkAdminAccess(null, dependencies), "forbidden");
  state.record = { ...active, status: "disabled", disabled_at: "2026-10-18T01:00:00Z" };
  assert.equal(await checkAdminAccess(null, dependencies), "forbidden");
  state.record = { ...active, permissions: [] };
  assert.equal(await checkAdminAccess(null, dependencies, "catalog.read"), "forbidden");
});

test("valid editor may read products; forged role and self promotion have no effect", async () => {
  const { state, dependencies } = setup();
  state.current = { subject: "user-a", role: "super_admin", user_metadata: { admin: true } };
  assert.equal(await checkAdminAccess(null, dependencies), "allowed");
  assert.equal(await checkAdminAccess(null, dependencies, "catalog.read"), "allowed");
  assert.equal(await checkAdminAccess(null, dependencies, "catalog.publish"), "forbidden");
  assert.equal(await checkAdminAccess(null, dependencies, "catalog.import.commit"), "forbidden");
  assert.deepEqual(permissionsForRole("catalog_editor").includes("catalog.publish"), false);
  assert.deepEqual(permissionsForRole("super_admin").includes("catalog.publish"), true);
});

test("expired and signed-out sessions are denied; disablement applies next request", async () => {
  const { state, dependencies } = setup();
  state.current = { subject: "user-a" };
  assert.equal(await checkAdminAccess(null, dependencies), "allowed");
  state.record = { ...active, status: "disabled", disabled_at: "2026-10-18T01:00:00Z" };
  assert.equal(await checkAdminAccess(null, dependencies), "forbidden");
  state.record = active;
  state.current = null;
  assert.equal(await checkAdminAccess(null, dependencies), "anonymous");
});

test("login accepts only an independently listed admin and signs out ordinary accounts", async () => {
  const { state, dependencies } = setup();
  const auth = { async signIn() { state.current = { subject: "user-a" }; return true; },
    async signOut() { state.current = null; state.signedOut = true; return true; },
    async hasSession() { return state.current !== null; } };
  state.record = null;
  assert.equal(await loginAdmin("user@example.com", "password", auth, null, dependencies, async () => true), "invalid");
  assert.equal(state.signedOut, true);
  state.record = active;
  assert.equal(await loginAdmin("user@example.com", "password", auth, null, dependencies, async () => true), "allowed");
  assert.equal(await loginAdmin("user@example.com", "password", auth, null, dependencies, async () => false), "rate_limited");
});

test("logout success removes the session and the next protected request is denied", async () => {
  const { state, dependencies } = setup();
  state.current = { subject: "user-a" };
  const auth = { async signOut() { state.current = null; return true; },
    async hasSession() { return state.current !== null; } };
  assert.equal(await checkAdminAccess(null, dependencies), "allowed");
  assert.equal(await logoutAdmin(auth), "signed_out");
  assert.equal(await checkAdminAccess(null, dependencies), "anonymous");
});

test("Supabase adapter maps signOut error, exception and actual local session state", async () => {
  for (const outcome of ["cleared", "error", "throw", "lingering"]) {
    let session = { user: "user-a" };
    const client = { auth: {
      async signInWithPassword() { return { error: null }; },
      async signOut(options) {
        assert.deepEqual(options, { scope: "local" });
        if (outcome === "throw") throw new Error("private provider detail");
        if (outcome === "cleared") session = null;
        return { error: outcome === "error" ? new Error("private provider detail") : null };
      },
      async getSession() { return { data: { session }, error: null }; },
    } };
    assert.equal(await logoutAdmin(supabasePasswordAuth(client)), outcome === "cleared" ? "signed_out" : "failed");
    assert.equal(session === null, outcome === "cleared");
  }
});

test("logout provider error and exception never report success", async () => {
  for (const signOut of [async () => false, async () => { throw new Error("secret provider detail"); }]) {
    const { state, dependencies } = setup();
    state.current = { subject: "user-a" };
    const auth = { signOut, async hasSession() { return state.current !== null; } };
    assert.equal(await logoutAdmin(auth), "failed");
    assert.equal(await checkAdminAccess(null, dependencies), "allowed");
  }
});

test("provider success with a lingering session is still a logout failure", async () => {
  const { state, dependencies } = setup();
  state.current = { subject: "user-a" };
  const auth = { async signOut() { return true; }, async hasSession() { return state.current !== null; } };
  assert.equal(await logoutAdmin(auth), "failed");
  assert.equal(await checkAdminAccess(null, dependencies), "allowed");
});

test("ordinary user rejection clears the new session, or reports failed cleanup", async () => {
  for (const outcome of ["cleared", "error", "throw", "lingering"]) {
    const { state, dependencies } = setup();
    state.record = null;
    const auth = {
      async signIn() { state.current = { subject: "user-a" }; return true; },
      async signOut() {
        if (outcome === "throw") throw new Error("secret provider detail");
        if (outcome === "error") return false;
        if (outcome === "cleared") state.current = null;
        return true;
      },
      async hasSession() { return state.current !== null; },
    };
    assert.equal(await loginAdmin("user@example.com", "password", auth, null, dependencies, async () => true),
      outcome === "cleared" ? "invalid" : "cleanup_failed");
    assert.equal(await checkAdminAccess(null, dependencies), outcome === "cleared" ? "anonymous" : "forbidden");
  }
});

test("expired sessions and disabled admins remain denied after fresh checks", async () => {
  const { state, dependencies } = setup();
  state.current = { subject: "user-a" };
  assert.equal(await checkAdminAccess(null, dependencies), "allowed");
  state.current = null;
  assert.equal(await checkAdminAccess(null, dependencies), "anonymous");
  state.current = { subject: "user-a" };
  state.record = { ...active, status: "disabled", disabled_at: "2026-10-18T01:00:00Z" };
  assert.equal(await checkAdminAccess(null, dependencies), "forbidden");
});

test("existing singular import receipt permission remains valid", async () => {
  const { state, dependencies } = setup();
  state.current = { subject: "user-a" };
  const actor = await requireCatalogPermission(null, "catalog.import.receipt.read", dependencies);
  assert.equal(actor.actor_id, ID);
});

test("directory migration exposes no browser reads or self-grant path", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261018120000_create_admin_identity_foundation.sql", import.meta.url), "utf8");
  assert.match(sql, /REVOKE ALL ON SCHEMA admin_private FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT SELECT \(id, auth_user_id, status, role, created_at, disabled_at\)/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON admin_private\.admin_users TO admin_directory_provisioner/);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE)[^;]* TO (?:anon|authenticated|service_role)/);
  assert.doesNotMatch(sql, /CREATE FUNCTION|CREATE POLICY[^;]*TO (?:anon|authenticated)/);
});
