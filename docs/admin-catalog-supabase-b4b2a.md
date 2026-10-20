# B4-B2-A Catalog Admin read source: implementation draft

Status: **implemented locally and tested against the dedicated Beauty B2B PostgreSQL cluster**. No Supabase project was contacted, no cloud migration was run, and no production credential was provisioned. The server source remains disabled unless explicitly selected in a production Node runtime.

## Boundaries

- `server.ts` still defaults to `notConfiguredCatalogSource`. Only server-side `CATALOG_READ_SOURCE=supabase` with `NODE_ENV=production` selects the new connector. Neither URL parameters nor cookies select a source.
- `postgres-supabase.ts` is server-only and reuses `CatalogReadSource` and `postgres-core.ts`. It never imports the test-only `postgres-local.ts`. Each read uses one `REPEATABLE READ READ ONLY` transaction; parameterized `pg` queries remain unnamed for transaction-pooler compatibility.
- The Admin page and Repository separately validate `catalog.read`. The database identity is a third boundary, not an Auth replacement. UUID detail, V2 HMAC cursor, four sorts and forward/backward keyset remain in their existing modules. Public SEO routes are unchanged.
- The connector's role has private Catalog SELECT only. Its `CatalogReadSource` public methods are **not** wired to a Public route and are not authorized for public views. Future Public wiring needs its own review and identity.

## Deployment configuration (blank until approved)

All variables below are server-only and must come from an environment-scoped secret manager. No connection URI is accepted or logged.

| Variable | Required value |
| --- | --- |
| `CATALOG_READ_SOURCE` | `supabase` only after approval; otherwise absent |
| `CATALOG_READ_SUPABASE_PROJECT_REF` | Approved 20-character project ref |
| `CATALOG_READ_SUPABASE_MODE` | `direct`, `session`, or `transaction`, chosen for the deployment topology |
| `CATALOG_READ_SUPABASE_HOST` | Direct: `db.<ref>.supabase.co`; shared pooler: exact host copied from the project's Connect panel |
| `CATALOG_READ_SUPABASE_PORT` | Direct/session: `5432`; transaction: `6543` |
| `CATALOG_READ_SUPABASE_DATABASE` | `postgres` |
| `CATALOG_READ_SUPABASE_USER` | Direct: `catalog_admin_reader_runtime`; shared pooler: `catalog_admin_reader_runtime.<ref>` |
| `CATALOG_READ_SUPABASE_PASSWORD` | Independently generated, server-held role password |
| `CATALOG_READ_SUPABASE_CA_PEM` | Project certificate authority PEM; verify certificate and host name |

The connector passes separate validated fields to `pg.Pool`, so query-string options cannot override TLS, host, port, user or database. A fixed pool is created lazily per Node process (one client in transaction mode; two otherwise), with connection, statement, query and idle timeouts. Budget total connections across all instances; avoid named prepared statements and session state in transaction-pooler mode. An unavailable source yields a safe error and never falls back to `service_role` or a writer role. The signing key remains separate from database credentials.

## Incremental migration draft

`20261020120000_add_catalog_admin_read_runtime.sql` requires the six private Catalog tables and their RLS-enabled foundation. It creates a LOGIN role with **no password**, no inheritance, no superuser or bypass rights; grants only database CONNECT, private-schema USAGE and six-table SELECT; and adds six SELECT-only RLS policies. It neither changes the six public views nor grants RFQ, Admin directory, import receipts or Catalog write privileges.

The initial draft used `REVOKE/GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA catalog_private`. That could give `catalog_admin` or `catalog_import` a receipt-maintenance function they never had permission to call. The F1 revision rejects any unreviewed function signature, grantee or effective caller, checks the seven foundation functions' existing effective writer permissions, and changes ACLs **only for those seven named signatures**. For each signature it records the existing effective permissions of the four known Catalog roles, revokes PUBLIC, and restores only permissions that already existed. It never changes receipt lookup or purge ACLs. If either receipt function exists, its reviewed owner, `SECURITY DEFINER` setting, `search_path` and caller permissions must match the draft receipt contract or the migration aborts. An unknown function or ACL blocks deployment for human review; the migration does not clean it up automatically.

The seven foundation functions inherited PostgreSQL's default PUBLIC EXECUTE. Their PUBLIC grants are revoked, and the reviewed roles retain only the effective EXECUTE they demonstrably held before this migration. PostgreSQL's global default PUBLIC EXECUTE cannot be cancelled by a per-schema default REVOKE. Every future Catalog function migration must revoke PUBLIC EXECUTE in its own transaction, or a separately reviewed change must address the creator's global defaults. A final effective-privilege check aborts the migration if inherited or PUBLIC grants allow CREATE, TEMP, Catalog writes, or private-function execution. In particular, a target whose database grants TEMP to PUBLIC requires a separate, reviewed strategy; **do not silently weaken this assertion or revoke database-wide PUBLIC rights**. No new `SECURITY DEFINER`, ownership transfer or FORCE RLS is introduced.

### Before any cloud deployment

1. Obtain separate authorization to inspect the target's migration history, role memberships, object owners, database/schema/table/function ACLs, default privileges and exposed API schemas. Snapshot **all** `catalog_private` function signatures, owners, `SECURITY DEFINER` flags, `search_path`, ACLs and legitimate callers before migration. SQL present in Git is not evidence it ran remotely.
2. Review the effect of revoking PUBLIC EXECUTE on the seven foundation functions for every active Catalog Import caller. Validate writer roles' explicit function grants, triggers, receipt lookup, receipt maintenance and RFQ isolation in an isolated replica. If the target contains any unknown private function or ACL, stop for review; do not loosen the assertion.
3. Run the additive migration only after approval. If its effective-privilege assertion fails, stop; do not relax it as a deployment workaround.
4. Provision the role password through a trusted administrator channel outside Git, independently in each environment. Verify custom-role authentication in the selected Supabase connection mode and TLS chain before enabling `CATALOG_READ_SOURCE`.
5. Test draft/published/retired Admin reads, public views, RFQ/Import rejection, role DML/DDL rejection, cursor tampering and connection failures. Keep production source disabled until these gates pass.

### Rollback design (requires separate approval)

First disable `CATALOG_READ_SOURCE` and drain its connection pool. Revoke or rotate the runtime credential. Drop the six added RLS policies, then revoke the role's six SELECT grants, schema USAGE and database CONNECT. Drop the role only after confirming it owns no object and has no active sessions. Restore the seven foundation function ACLs only from the **captured pre-migration ACL snapshot** after a separate compatibility review; never blindly restore PUBLIC EXECUTE. The migration is one transaction, so a failed assertion rolls back the entire attempt. None of these steps was performed against Supabase.

## Local evidence and remaining limits

The dedicated PostgreSQL 17.11 cluster accepted the original additive migration, and a temporary test credential established a real `catalog_admin_reader_runtime` connection. F1 additionally executed the revised migration body inside an outer transaction against that same isolated cluster, using temporary synthetic receipt functions with the reviewed ACL shape. It verified that an unknown function, unknown foundation grantee and unexpected purge grant abort before role creation; a PUBLIC TEMP grant fails the postcondition and rolls back role creation; the named grants preserve receipt permissions; and the outer rollback restores the original local state. This test does not claim a fresh cloud migration or production receipt deployment. The production TLS handshake, Supabase pooler authentication, live function inventory/default privileges and cloud role behavior remain **unverified**. Local `REPEATABLE READ` gives a snapshot per request; it does not promise a snapshot across separate page requests.
