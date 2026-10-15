# Catalog administrator authentication and authorization foundation

## Current project facts

- Next.js App Router, React, TypeScript, PostgreSQL. The only current route under `src/app/api` is RFQ; there is no catalog import API, admin login, administrator directory, RBAC implementation, or production catalog PostgreSQL connector.
- `package.json` has no authentication SDK. Supabase Auth is a possible future provider, not a selected or connected one. The database's `catalog_admin` and `catalog_import` roles are database roles, not website administrator accounts.
- `transaction.ts` accepts a branded `ActorContext` from an injected verifier. `postgres.ts` uses a local only PostgreSQL pool and takes `actor_context.actor_id` as the receipt scope. These components do not authenticate a real administrator. The pool uses one database login per configured local target, with `SET LOCAL ROLE catalog_import` in each transaction.
- Current `COMMIT_UNKNOWN` guidance is to retry the same normalized request, idempotency key, and actor identity. The receipt's uniqueness scope is `(actor_id, idempotency_key)`; a different actor cannot obtain the same receipt through the transaction's actor-scoped lookup. This is application behavior, not yet database-level isolation of a shared role.

## Identity and permission contract

`src/lib/catalog-import/admin-auth.ts` defines a stable internal `admin_id` (UUID), `identity_provider`, provider subject, `active`/`disabled` status, `created_at`, `disabled_at`, and explicit grants. It defines three permissions:

| Permission | Intended action |
| --- | --- |
| `catalog.import.preview` | Read and validate a proposed import preview |
| `catalog.import.commit` | Commit a reviewed import |
| `catalog.import.receipt.read` | Read or recover the caller's own receipt |

All grants default to deny. `CatalogIdentityProvider.verifySession` must verify the incoming session on the trusted server. `CatalogAdminDirectory.findByProviderIdentity` resolves the verified provider subject to a stable internal administrator ID and current grants. `requireCatalogPermission` rechecks account state and the requested grant on every call. Only the `catalog.import.commit` grant returns a transaction-compatible, process-branded `ActorContext`; preview and receipt-read grants return the stable actor ID without a commit-capable context. The account ID is not supplied by a request body or header. The Fake Provider is defined only inside the unit test; it is not exported from application source or wired to a route.

The interfaces are deliberately provider-neutral. No administrator table, default account, migration, credential, or public route is created in this stage. `CatalogAdminDirectory` must eventually be backed by a private, server-controlled data store, not by untrusted request claims. A future implementation must separately review administrator creation, grant management, audit, and revocation.

Supabase Auth fits the provider interface as a future option because its [server-side Next.js integration](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework) supports server verification. For a current account-state check, that guidance distinguishes `getUser` from the session user object and warns against using the latter for authorization. This repository has not adopted or configured Supabase Auth. Its [transaction pooler documentation](https://supabase.com/docs/guides/database/connecting-to-postgres) also makes clear that session state does not persist across transactions, so any future database role setup must stay inside the import transaction.

## Required server flow before a production endpoint can exist

1. Validate the real session with a selected identity provider on the server. Never trust a decoded client claim, request parameter, or client header alone.
2. Resolve the provider identity in the private administrator directory. Check `active` and an explicit permission via `requireCatalogPermission`.
3. Use the returned `actor_id` for preview and a future actor-scoped receipt lookup. Only use the `actor_context` returned by the commit grant for the transaction. Do not accept a caller-supplied `actor_context`. Preview and commit require their own grants; receipt lookup requires `catalog.import.receipt.read`.
4. For commit, independently recheck `catalog.import.commit` immediately before starting the import. For `COMMIT_UNKNOWN`, retry with the **same authenticated internal actor ID**, key, request fingerprint, and original request, or use a future scoped receipt read operation. Reauthentication must not allow the caller to choose a prior actor ID.
5. Return a generic denial for missing identity, disabled accounts, and missing grants. Keep database credentials and receipt internals on the server.

The current PostgreSQL adapter still accepts `ActorContext` and has no production entry point. Its in-process brand proves only that some verifier function was called; it does not prove the verifier used a real provider. Future production wiring must call this authorization boundary with trusted adapters and must not call `verifyCatalogActorContext` with client-supplied claims. This stage does not alter existing import, receipt, or RFQ permissions.

## Disablement and identity continuity

- Keep `admin_id` stable and never reuse it, even if an email or provider subject changes. Link or replace provider subjects through an audited server-side process; do not assign another person the old `admin_id`.
- Recheck directory state for each new preview, commit, or receipt request. A disabled administrator cannot initiate new work or use the normal recovery endpoint. If a commit result is unknown when an account is disabled, a separately authorized, audited recovery process must confirm the receipt without letting another administrator impersonate the old actor.
- A request already in flight may have passed authorization before disablement. Production integration must define a locking or revocation protocol at the commit boundary and test that race; the current foundation alone does not cancel a running database transaction.
- Connection pool sessions must not carry administrator identity between requests. Actor identity remains in the server request scope; the current import transaction uses `SET LOCAL ROLE`, which is transaction-scoped. A production pool and access functions require their own safety review.

## Security limit and production prerequisites

The chosen trusted-server/shared-database-role architecture provides **server-enforced** administrator authorization when correctly wired. It does **not** provide strict database-level cross-actor isolation if a holder of the shared database role can query or forge actor-scoped receipts. The unresolved receipt permission risk remains a production blocker under the prior strict goal. A restricted function accepting an arbitrary `actor_id` is insufficient by itself.

Before enabling production import: choose and implement a real identity provider (Supabase Auth is an option), build the private administrator directory and grant management, enforce authorization at each server action, design and test a restricted receipt access path, resolve the shared-role isolation acceptance decision, test disablement races and cross-actor recovery, and separately approve any incremental SQL and the default-closed production API. No such integration is claimed here.

## Acceptance evidence for this stage

The unit test covers missing login, ordinary user, disabled admin, missing grant, explicit authorization, forged actor input, distinct administrators, stable recovery scope, directory mismatch, and the test-only Fake Provider boundary. Existing receipt offline tests and TypeScript, lint, build, and whitespace checks form the regression gate. No database or migration is needed.
