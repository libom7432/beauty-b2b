# RFQ API role: supplemental security review

Run `supabase/verification/rfq_api_security_followup.sql` in the isolated
Supabase development project's SQL Editor as a privileged reviewer. It is one
read-only query. It does not switch roles, invoke extension or large-object
functions, inspect secret values, or change permissions. Save its full result
for human review; the last row is `OVERALL`.

This check follows, rather than replaces, the already separate
`RFQ_BUSINESS_PERMISSIONS` and `ROLE_SECURITY_AUDIT` checks. Do not enable
`rfq_api` LOGIN solely because the business check passed. A missing role is
`BLOCKED`; no empty inventory can turn that into approval.

## Reading the findings

- `ACCEPTABLE_DEFAULT`: the specific row found no reachable access, or only
  reports installation. It is not a blanket approval of the extension or
  future grants.
- `REVIEW_REQUIRED`: the role has a capability outside the RFQ write
  contract whose effect needs a human decision. A documented acceptance or
  separate hardening decision is necessary before LOGIN.
- `BLOCKED`: a current capability crosses the RFQ role boundary, or a
  configuration can bypass large-object ACLs. Investigate and resolve before
  LOGIN. The script intentionally makes no permission changes.

`OVERALL` is the most restrictive row verdict. An SQL error or missing
`OVERALL` means the follow-up did not complete; do not treat it as passed.
Run the query again after any role, extension, or privilege change.

## What each area measures

**TEMPORARY.** The query tests effective database TEMPORARY permission and
identifies a PUBLIC or direct ACL grant. TEMPORARY allows temporary tables for
the session and can consume storage, memory, and CPU. It does not grant
persistent database/schema CREATE, RFQ table access, or permission to read
other sessions' temporary tables. Effective TEMPORARY remains
`REVIEW_REQUIRED`; effective database CREATE is `BLOCKED`. A possible
hardening plan would revoke database TEMPORARY from PUBLIC and restore it
selectively, but this is a global Supabase change requiring separate approval
and platform dependency testing.

**Large objects.** Built-in `lo_*`, `loread`, and `lowrite` EXECUTE rights
are listed separately from access to existing large objects. The latter is
calculated from `pg_largeobject_metadata`, the correct large-object ACL type
`L`, PUBLIC/direct/inherited effective grants, and owner membership. The
script distinguishes SELECT, UPDATE, and DELETE/OWNERSHIP. Any accessible
existing large object is `BLOCKED` for this insert-only role. Merely being
able to execute a large-object function is `REVIEW_REQUIRED`: some functions
can create new objects, while access to existing ones is subject to further
checks. Reachable server-side `lo_import` or `lo_export` is `BLOCKED`
because it can involve server files.
The `lo_compat_privileges` setting, matching role/database defaults, and
ability to SET that parameter are checked because compatibility mode can
bypass large-object ACL checks. The query does not change or read any object
contents.

**Extensions.** An installed extension row by itself is
`ACCEPTABLE_DEFAULT`. Function rows show EXECUTE, schema USAGE, PUBLIC
EXECUTE, SECURITY DEFINER, owner, and search_path settings. Relation rows show
schema access and table or column permissions. The audit includes extension
members and Vault-schema functions/relations, which can be created outside
the extension's dependency list. Reachable Vault data objects or Vault
SECURITY DEFINER functions are `BLOCKED` pending inspection; other reachable
extension objects are `REVIEW_REQUIRED`. In particular, review
`vault.decrypted_secrets` access if present. The query never selects its
contents. PostgreSQL metadata cannot prove that a function body is safe or
that a view reveals no sensitive data, so human source and policy review is
still needed for reachable objects.

The query deliberately does not infer danger merely from the presence of
`pg_stat_statements`, `pgcrypto`, `uuid-ossp`, or `supabase_vault`. It also
does not call their functions as the target role. A privileged SQL Editor
session is required to see the catalog and ACL inventory; if the reviewer
cannot read required catalogs, the query must fail rather than claim success.

This file and the SQL are design-time artifacts. A PostgreSQL 17.11 execution
in the development project is required to validate the final query and its
actual findings. Do not run it against production for initial testing.
