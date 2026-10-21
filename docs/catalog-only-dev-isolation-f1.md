# Catalog-only development project: local release and snapshot gates

Status: **local tooling and offline fixtures only**. The Supabase project `beauty-b2b-catalog-dev` has not been created or contacted. The existing `beauty-b2b-rfq-dev` project must remain unchanged. A project display name is not a Project Ref.

## Migration release workspace

The repository's `supabase/migrations/` contains RFQ and Catalog migrations. Never run an unselected `supabase db push` against the Catalog-only project. `docs/sql/*.draft.sql` are not migrations. The local `prepare-catalog-only-migrations.mjs` tool copies unchanged bytes and original versioned filenames into a **new, empty, outside-repository** workspace and writes a SHA-256 manifest. It does not link to Supabase, provision roles, or modify migration history.

| Local release stage | Exact migration whitelist, in order |
| --- | --- |
| `foundation` | `20261013120000_create_catalog_foundation.sql` |
| `admin-read` | Foundation, then `20261020120000_add_catalog_admin_read_runtime.sql` |
| `admin-login` | Foundation, then `20261018120000_create_admin_identity_foundation.sql`, then Admin Read |

`admin-read` is a database-read baseline, not proof that an administrator can log in. The Admin Identity migration is an independent, separately approved step for login integration. Its runtime directory role and administrator provisioning need their own review.

Local preparation: `node scripts/prepare-catalog-only-migrations.mjs <stage> <catalog-ref> <rfq-ref> <new-absolute-directory>`. Use a canonical absolute path with an existing, privately owned parent directory outside the Git repository. The tool rejects path aliases, symlink ancestors and existing targets; it creates the destination exclusively and writes the manifest last. A failed preparation without a verified manifest is invalid and must not be deployed. Both refs must be read independently from approved project records. Before any later release, repeat with `verify <directory> <catalog-ref> <rfq-ref>`; the verifier rejects changed bytes, extra files, wrong refs and versions. The manifest says cloud execution is **not approved**. The operator must separately confirm that the connected target Ref matches the manifest Catalog Ref, differs from the RFQ Ref, and that the CLI in use applies **only this isolated workspace**. Do not mark skipped RFQ migrations as applied. Use a reviewed migration mechanism that records exactly the executed versions in `supabase_migrations.schema_migrations`; do not use ad hoc SQL Editor execution without a reviewed migration-history procedure.

## Strict snapshot baseline

`catalog-supabase-permission-snapshot.sql` remains metadata-only. It now includes non-platform schemas, non-extension objects in `public`, and the optional Admin Identity table. The version-only history query is separate. Unknown platform-looking roles or schemas also block until explicitly classified; do not silently expand the allowlist. The checker retains its original mixed-project `<snapshot> <pre|post> [history]` invocation. Catalog-only requires the explicit command:

`node scripts/check-catalog-supabase-snapshot.mjs catalog-only <snapshot.jsonl> <empty|foundation|admin-read> <versions.txt> <absent|present>`

The last argument states whether the **Admin Identity migration and structure** are expected. For `empty`, it must be `absent`. The checker deliberately rejects missing, duplicate, malformed or unexpected migration versions, and any RFQ business schema, RFQ migration, or unknown prefixed business role/object. All three stages require the permission-inventory marker, matching ACL and membership counts, anonymous/authenticated effective database permissions and public-schema CREATE denial. PUBLIC database CREATE/TEMP and unexpected anonymous or business-role inheritance block even at `empty`. Missing permission rows block. For Foundation and Admin Read, all existing Catalog relation, public-view, function, ACL, RLS and effective-permission checks remain active. `present` checks Admin Identity schema, table, FORCE RLS, roles and policies. It does **not** prove a working Auth login, directory runtime identity, or provisioned admin user.

| Baseline | Exact expected versions | Objects and role state |
| --- | --- | --- |
| `empty absent` | None | No Catalog, RFQ or Admin business schema, prefixed role, relation, function or policy. Supabase-managed platform schemas may exist. |
| `foundation absent` | `20261013120000` | Six private tables, six public views, seven functions, foundation roles and RLS; Admin Read and Admin Identity absent. |
| `foundation present` | Foundation plus `20261018120000` | Foundation plus Admin Identity structure, but no Admin Read role. |
| `admin-read absent` | Foundation plus `20261020120000` | Six SELECT-only reader policies and effective read-only permissions; Admin Identity absent. |
| `admin-read present` | Foundation, Admin Identity, Admin Read | Both database structures; Admin login still needs separate runtime and account validation. |

The checker verifies View columns, ownership, published references and policy features, but these features cannot prove semantic equivalence of arbitrary SQL expressions. Compare `view_definition_md5` and policy expression hashes with a reviewed baseline and manually inspect full View and RLS definitions before a cloud gate. Never treat a local fixture PASS as cloud acceptance.

The local fixture defines a deliberately strict, synthetic permission baseline; it is not evidence of Supabase platform defaults. Until the target project's platform membership graph is independently reviewed and encoded, the Catalog-only checker blocks **all** membership edges, including platform-to-platform edges. Before accepting a new project's `empty` snapshot, review its actual platform roles, database and public-schema ACLs, effective permissions and memberships against an approved Supabase baseline. Unknown or unverifiable critical grants must remain blocked pending that review; do not widen the checker allowlist merely to obtain PASS.

## Cloud gates and stop conditions

1. Obtain separate human approval to create the new development project. Record Catalog and RFQ Project Refs, environment classification, database version, direct/pooler host and TLS chain. Never reuse RFQ credentials.
2. With a separately approved read-only audit identity, collect the metadata snapshot and version-only history outside the Git worktree. Redact credentials and never export customer, product or RFQ rows. Run `empty absent`; unexpected platform defaults or business objects block.
3. Approve the exact `foundation` workspace, hashes, target Ref and backup/recovery plan. Apply only that migration via the reviewed migration mechanism. Verify recorded history and run `foundation absent`.
4. For Admin login, separately approve Admin Identity, its runtime directory identity and Auth configuration. The Admin Auth URL, directory connection and Catalog reader connection must all identify the same approved Catalog project; none may point to RFQ.
5. Capture Foundation ACL/owner/function baseline. Separately approve and apply Admin Read; provision its password outside Git; verify `admin-read absent` or `admin-read present` as appropriate. Check database SELECT and denial of writes, TEMP/DDL, function execution, and RFQ/Admin directory access.
6. Only after these gates, separately approve server connector activation and test the list, UUID detail and signed cursor. The connector remains disabled by default.

Stop on identity mismatch, unknown function/ACL/policy, missing history, privilege assertion failure, unexpected role inheritance, or any RFQ business object. A failed transactional migration requires an actual post-failure object and history audit; do not assume rollback from the error message alone. If a migration succeeded, first disable the data source and rotate/revoke its credential; restore reviewed privileges through a separately approved corrective migration based on the pre-migration snapshot. Do not delete migration history or broadly restore PUBLIC EXECUTE. The current work made no cloud changes, so it needs no cloud rollback.
