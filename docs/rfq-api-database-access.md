# RFQ API database access, B1

This stage adds only the server role, grants, RLS policies, and a permission
acceptance script. It does not enable API submission or connect to Supabase.
The existing `20261010112952_create_rfq_schema.sql` is immutable because it
has already been applied to the development project.

## Role and SQL contract

`20261011120000_grant_rfq_api_role.sql` creates `rfq_api` without LOGIN or a
password. It has no memberships, object ownership, RLS bypass, database/schema
creation, or RFQ UPDATE/DELETE permission. The role is activated separately
after acceptance and secret provisioning. Its `search_path` is `pg_catalog`;
the application must use schema-qualified `rfq_private` identifiers and
parameterized values.

| Object | Granted operation | Why |
| --- | --- | --- |
| `rfq_private` | `USAGE` | Resolve the private tables; no `CREATE` |
| `rfq_requests` | Column-scoped `INSERT` | Create a request; DB generates `id`, `status`, timestamps |
| `rfq_requests` | Column-scoped `SELECT` on `id`, `rfq_number`, `idempotency_key`, `request_fingerprint`, `status`, `created_at` | `ON CONFLICT (idempotency_key)`, `RETURNING`, and retry lookup |
| `rfq_items` | Column-scoped `INSERT` | Save trusted item snapshots in the same transaction |
| `rfq_notification_jobs` | `INSERT(rfq_request_id)` | Create one pending job using DB defaults |

There is no `SELECT` on buyer contact or requirements, and no `SELECT` on item
or job tables. There is no grant to `anon`, `authenticated`, `service_role`, or
`PUBLIC`. Four RLS policies apply only to `rfq_api`: INSERT on each table and
SELECT on request metadata. `USING (true)` for request SELECT is necessary
because this anonymous public API has no buyer identity to scope rows. The
column grants still block reading contact fields. A stolen `rfq_api` credential
could enumerate allowed metadata; it must be stored only in the server secret
manager and rotated if compromised.

The expected write path is:

```sql
BEGIN;
INSERT INTO rfq_private.rfq_requests (...)
VALUES (...)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id, rfq_number, status, created_at;
-- If zero rows: SELECT id, rfq_number, request_fingerprint, status, created_at
-- FROM rfq_private.rfq_requests WHERE idempotency_key = $1;
-- If inserted: INSERT all rfq_items, then INSERT rfq_notification_jobs.
COMMIT;
```

The API must not use `RETURNING *`, read `rfq_items`, use `ON CONFLICT DO
UPDATE`, or insert explicit `id`/`status` values. Each change to this SQL
contract needs a new permission review. The database unique index arbitrates
concurrent idempotency keys. Application validation and trusted snapshots
remain required; `WITH CHECK (true)` is not payload validation.

## Manual development-project sequence

1. Review the new migration and run it **once** through the approved Supabase
   migration process in the isolated development project. Do not edit or
   reapply the already executed first migration. Do not add `rfq_private` to
   Exposed schemas.
2. In that project, run `supabase/verification/rfq_api_permissions.sql` as a
   privileged database operator in the SQL Editor. Run the *whole file*; it
   starts with `BEGIN` and ends with `ROLLBACK`. The business result is
   `RFQ_BUSINESS_PERMISSIONS = PASS` only if every statement, role switch and
   expected SQLSTATE `42501` denial succeeds. Any SQL error or missing final
   result means **FAIL**. Fixture contact/product values are fictional and
   rolled back.
3. Separately run the read-only
   `supabase/verification/rfq_api_effective_privileges.sql` in the same
   development project. Record `ROLE_SECURITY_AUDIT`, the `login_enabled`
   state, installed extensions, and every inventory entry marked
   `PROHIBITED` or `REVIEW_REQUIRED`. This query does not change privileges.
   `REVIEW_REQUIRED` is **not** an automatic PASS; a human security reviewer
   must resolve or explicitly accept each item before LOGIN is enabled.
4. Only after `RFQ_BUSINESS_PERMISSIONS = PASS`, `ROLE_SECURITY_AUDIT = PASS`
   (or documented human resolution of `REVIEW_REQUIRED`), and approval of the
   remaining platform risks, provision a long random password outside Git and
   issue tracking. Using a
   secure administrator `psql` session, `\password rfq_api` prompts for a
   password without placing it in a checked-in SQL file or shell command.
   Then execute `ALTER ROLE rfq_api LOGIN;`. Do not paste a plaintext password
   into the SQL Editor or a terminal command line. Store the resulting
   connection URI only as a server-side secret, e.g. `RFQ_DATABASE_URL` in
   Vercel's environment configuration. Do not use `NEXT_PUBLIC_` or the
   `postgres`/`service_role` credentials in the API.
5. Re-run both checks after activation and perform a connection smoke test as
   `rfq_api` from the intended deployment network. The read-only audit will
   report `REVIEW_REQUIRED` for `login_enabled = true`; verify that this
   matches the explicitly approved activation, rather than treating the
   change as an automatic PASS.
   In the shared Transaction Pooler, the custom username has the form
   `rfq_api.<project-ref>`; copy the exact host/port from Supabase Connect.
   Use the Node.js runtime and a single-connection-per-instance `pg` pool;
   avoid named prepared statements and session state across transactions.

The SQL Editor operator must be allowed to `SET ROLE` to the test roles.
Permission tests using `SET ROLE` are meaningful only if role switching
succeeds; a role-switch error is a failed test setup, never PASS.

## Interpretation of the two results

`RFQ_BUSINESS_PERMISSIONS` covers three-table insertion, the actual
`ON CONFLICT ... RETURNING` and replay lookup, RLS, column restrictions,
denied contact reads, denied UPDATE/DELETE, and denied client-role access.
The script asserts each switched `current_user`; expected denials match
SQLSTATE `42501` exactly. An unexpected success raises an exception and
prevents the final business PASS. An unexpected SQL error aborts the enclosing
transaction. The SQL Editor may show earlier PASS notices before a later
failure; only the final business result with no SQL error is conclusive.

`ROLE_SECURITY_AUDIT` inventories effective database, schema, table/view,
column, sequence, large-object, and function rights, including accessible extension
objects and selected high-risk `pg_catalog` functions. It shows whether a
grant comes from `PUBLIC` or another source when that can be determined from
ACLs. `PROHIBITED` means a role attribute, membership, RFQ ownership, CREATE,
or RFQ operation contradicts B1's minimum permissions, so the result is
**FAIL**. `REVIEW_REQUIRED` means TEMPORARY, non-RFQ/extension access, or an
enabled LOGIN state needs human evaluation. An installed extension other
than `plpgsql` also requires review because SQL function/table inventories
cannot prove every extension object's safety. Only an absent prohibited and
review-required condition yields **PASS**. If `rfq_api` is missing, the
result is FAIL. Ordinary built-in `pg_catalog` function execution is counted
rather than listing thousands of baseline functions; this is not a proof
that all PostgreSQL built-ins are harmless.

The effective-privilege audit is a read-only snapshot of the target project.
It does not replace a secure configuration review or prove that Vercel can
connect through the Transaction Pooler. **Do not enable LOGIN based on the
business PASS alone.**

## PUBLIC privilege boundary

`NOINHERIT` does **not** remove grants inherited from PostgreSQL `PUBLIC`.
The migration fails if `rfq_api` can create a persistent schema/object through
effective database or schema `CREATE` grants. The separate effective-privilege
audit reports inherited `TEMPORARY` as `REVIEW_REQUIRED`. Supabase commonly grants temporary
table creation to `PUBLIC`, and some functions may permit large-object
creation or access to extension-owned objects. These are outside the scoped
RFQ grants and cannot be denied for just one role while the `PUBLIC` grant
remains. A business-permission PASS therefore makes no claim that the role
cannot create *all* database objects.

If the requirement includes forbidding temporary and large objects, a
project-wide privilege-hardening plan is required. In particular, revoking
`TEMPORARY` from `PUBLIC` and re-granting it to Supabase roles that need it
may affect unrelated services. Audit those dependencies and obtain separate
approval before changing global grants. This B1 migration does not make that
global change.

An inherited `TEMPORARY` privilege permits a connected role to create
temporary tables and consume database resources even though it cannot create
persistent schemas or tables. An optional hardening path is to revoke
`TEMPORARY` on the database from `PUBLIC` and grant it back to every platform
role that requires it, but that is a separate project-wide change with possible
effects on Supabase services and application jobs. The read-only audit also
flags reachable `pg_net` objects/functions, accessible large objects, and
other installed-extension functions for review. Do not attempt a blanket
`REVOKE` on extension-owned objects: the project role may lack ownership, and
the change may break the extension while leaving other effective rights.

## Other security and deployment notes

- `rfq_private` remains outside Supabase Exposed schemas. RLS stays enabled;
  existing client-role revocations remain intact.
- The role's login password is absent from migrations and repository files.
  Keep TLS enabled and restrict access to the server deployment environment.
- `search_path` limits accidental unqualified resolution, but does not stop a
  session from changing it. Always qualify tables, never interpolate request
  values into SQL, and use `pg` parameters.
- Supabase Transaction Pooler is the provisional Vercel choice. Keep every
  `BEGIN`/`COMMIT` on the same acquired `pg` client. Avoid named prepared
  statements, session-level `SET`, and queries pipelined across transaction
  boundaries. Verify the actual pooler URL and connectivity before API work.
- The role is deliberately insert-only. Notification workers and future
  administrative reads need separate roles and reviewed migrations.
