# B4-B2-B-F2: Catalog target permission snapshot preparation

Status: **implemented and validated only against the dedicated local PostgreSQL 17.11 cluster**. No real Supabase project was contacted. This document is a request package for a later, separately approved read-only cloud inspection; it is not migration approval.

## 1. Snapshot SQL

- `scripts/catalog-supabase-permission-snapshot.sql` is a single metadata-only `WITH ... SELECT`. It emits one JSON object per row with `section`, `item`, and `data`.
- `scripts/catalog-supabase-migration-history.sql` selects **version only** from `supabase_migrations.schema_migrations`. Run it only if the first snapshot reports that registry exists and the audit identity has SELECT permission. Never select migration statements or secrets.
- `scripts/check-catalog-supabase-snapshot.mjs` compares a saved JSONL snapshot with the checked-in Catalog Foundation and F1 migration contract. It has no database client and cannot modify a target. The `pre` stage expects the new role and migration to be absent; `post` expects the role and six SELECT policies to exist.

## 2. Snapshot field definitions

| Section | Selected metadata |
| --- | --- |
| `database`, `migration_registry` | Database name, owner, encoding, PostgreSQL version; existence of the migration registry. Migration versions are a separate version-only read. |
| `schema`, `relation` | Expected schema/table/view presence, optional receipt table presence, kind, owner, RLS flags, column names, view options and a hash of the view definition. The view SQL text is not exported. |
| `policy` | Policy name, command, role names, permissive flag, boolean checks and expression hashes. Policy expression text is not exported. |
| `role`, `membership` | Role flags and role-to-role membership. Password hashes are not selected. |
| `database_acl`, `schema_acl`, `relation_acl`, `default_acl` | Grantee, privilege and grant option, including PUBLIC and schema-specific default ACLs. |
| `function`, `function_acl`, `function_effective`, `rfq_function_effective` | Complete Catalog identity signature and canonical type signature; owner, SECURITY DEFINER flag, search_path only, ACL and effective EXECUTE plus schema USAGE for relevant callers. RFQ function accessibility is recorded without bodies. |
| `effective_database`, `effective_schema`, `effective_relation` | Effective CONNECT/CREATE/TEMP, USAGE/CREATE and SELECT/INSERT/UPDATE/DELETE/TRUNCATE for the audited roles. |

The registry query does not prove which Supabase project is connected. Record the approved Project Ref, environment (`development`, `staging`, `production`), exact direct/pooler host, connection mode, database, approved role and PostgreSQL version in a separate signed environment manifest. Compare the host and pooler username/project suffix against the trusted Supabase project inventory. **Do not infer identity from `NODE_ENV` or from the connection's own claims alone.**

## 3. Expected baseline

The repository's `20261013120000_create_catalog_foundation.sql` defines six private tables, six public views owned by `catalog_public_reader`, seven named `catalog_private` functions, RLS on all six private tables, and three baseline policy families per table. The four earlier migrations expected in the version-only registry are `20261010112952`, `20261011120000`, `20261013120000`, and `20261018120000`. The F1 migration `20261020120000` should be **absent before** deployment and **present after** deployment. File existence in Git is not evidence of cloud execution.

The checker requires a separately collected, nonempty list of unique 14-digit migration versions in **both** stages. `pre` blocks if any foundation version is missing or `20261020120000` is present. `post` blocks if any foundation version or `20261020120000` is missing. Missing, malformed or duplicate history blocks the result; omitting the history file cannot produce a complete `PASS`.

The two receipt functions are optional because they currently appear as draft SQL, not formal migrations. If present, their identity, owner, SECURITY DEFINER setting, search_path, effective callers and ACL must match the reviewed receipt design. A missing receipt function is not interpreted as proof of Import readiness; it must be reconciled with the target's actual Import deployment.

The comparator checks public-view column order, owner, security barrier and presence of the published predicate; the view-definition hash supports manual drift comparison. Because it intentionally does not export view or policy expressions, a human must still compare the hashes and inspect any mismatch under a separately approved read-only session. Hash/keyword checks alone do not prove semantic equivalence.

An automated `PASS` is only a complete structural gate after the version-only history has been supplied and all findings are empty. It is **not** approval to deploy: a human must still verify the target project identity, View and RLS expression semantics, and function privileges against the approved baseline. Local PostgreSQL tests cannot establish real Supabase behavior.

## 4. Difference detection rules

`BLOCKED` is returned for a missing table, view, schema, migration or Foundation function; unexpected function, function grantee or effective caller; unexpected role membership; missing or broadened RLS policy; reader write/DDL/TEMP/function permissions; unexpected receipt caller; changed public-view columns/owner/security barrier; and pre-existing read-runtime role at the pre-migration gate. The checker never repairs a database.

`PUBLIC` database CREATE/TEMP and explicit PUBLIC function defaults are reported as blockers because they may invalidate F1's effective-privilege assertions. PostgreSQL's *built-in* default PUBLIC EXECUTE on newly created functions is not represented by `pg_default_acl` when no explicit default ACL row exists; migration authors must continue to revoke it when adding functions. Unexpected owners or function ACLs require manual review before accepting a target snapshot.

The local test cluster deliberately contains a synthetic function, local-only policies and no Supabase migration registry. Its snapshot must therefore be **BLOCKED** by the cloud comparator; a local fixture is never treated as a cloud deployment pass.

## 5. Sensitive data review

The SQL does not select business table rows, RFQ records, customer data, private `storage_key`, role password hashes, Auth data, tokens, API keys, function bodies, policy expression text, or complete view SQL. The checker reports structural finding codes and object names only. Snapshot metadata still reveals role/schema topology: store it in a restricted location outside Git with minimal retention, redact it before sharing, and never log a connection URI or password. Use a secret manager for any later audit credential.

## 6. Cloud read-only execution plan — not performed

1. Obtain a signed target manifest and explicit approval for **read-only** access to one named Supabase project and environment. Verify its Project Ref, host, mode and PostgreSQL version independently from the connection configuration.
2. Use a dedicated audit identity and verified TLS. Set the connection read-only and run the metadata SQL in an explicit `BEGIN READ ONLY` transaction with error-stop enabled. Save JSONL to a protected path **outside this repository**; do not print the connection URI.
3. If the snapshot confirms the migration registry and the audit role can read it, run the version-only history query separately. Do not query migration SQL statements.
4. Run the offline checker with `pre` and the version-only file. Review every `BLOCK` finding and compare public-view/policy hashes to the approved baseline. Confirm role, function and receipt ACLs against a human-reviewed matrix.
5. Stop after the read-only report. Migration execution, password provisioning and enabling `CATALOG_READ_SOURCE` require **separate** authorization and a new deployment gate.

## 7. Required human approvals

- Project owner approval of the exact Project Ref, environment, host, pooler/direct mode and audit identity.
- Database/security owner approval of metadata access scope and protected snapshot location.
- Independent review of function inventory, grants, memberships, RLS and all checker findings.
- Separate future approval for any migration, role password, connection secret or production data-source enablement.

## 8. Stop conditions

Stop for mismatched project identity; unexpected host/role; missing migration registry or versions; unknown private function/ACL/caller; receipt permission drift; unexpected membership; missing object or disabled/broadened RLS; PUBLIC TEMP/CREATE; inability to verify TLS; or any attempt to read business data. Do not auto-fix or weaken the migration assertions.

## 9. Rollback requirements

This snapshot changes no database state, so no database rollback is needed. Abort the read-only transaction on any error and securely remove incomplete local snapshot output according to retention policy. For a later migration, capture exact pre-migration ACLs and owners first; rollback must disable the data source, revoke/rotate its credential, reverse only reviewed role grants/policies and restore function ACLs from that snapshot. Never blindly restore PUBLIC EXECUTE.

## 10. Final decision scope

The local SQL execution and mutation-based checker tests validate this **preparation tool**, not the cloud target. A clean target comparison plus human review is required before requesting migration approval.
