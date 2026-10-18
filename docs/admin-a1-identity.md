# Sprint 2.6-A1 administrator identity boundary

This is local code and migration design only. No account, database role, schema,
or Supabase project has been provisioned by this change.

## Runtime

`/admin/login` uses Supabase Auth password login through `@supabase/ssr`. The
Next.js 16 Proxy refreshes cookies only for `/admin`; every protected server
page independently calls `getUser()` and queries `admin_private.admin_users`.
`getSession()` and user-modifiable metadata never authorize anything. The
directory maps a verified Auth user ID to an active internal administrator ID
and a server-side permission list. The existing singular
`catalog.import.receipt.read` permission remains supported; the plural form is
an additive alias. An unlisted Auth user has no admin access.

Server Actions require cookie writes for login and logout. A rejected login
attempt signs out the newly created Auth session and confirms local session
removal before reporting an ordinary credential failure. Logout distinguishes
provider errors, thrown exceptions, and a lingering local session from success.
These checks do not prove remote JWT revocation or real cookie behavior without
an isolated configured Supabase environment.

The Admin directory query uses only `ADMIN_DIRECTORY_DATABASE_URL`, a server-only
PostgreSQL login named `admin_directory_runtime`. Its connection must be
provisioned separately as non-owner, non-superuser, without BYPASSRLS, with
`SET ROLE admin_directory_reader` membership and no RFQ/catalog role membership.
The migration does **not** create a LOGIN or grant membership. It gives the
NOLOGIN reader column-limited SELECT under FORCE RLS. `anon`, `authenticated`,
and `service_role` have no directory schema/table grants. No private schema
should be added to Supabase exposed API schemas. The private provisioner role
has writes for a separately approved bootstrap and role-change process; it
must never be granted to the web runtime or browser users. No SECURITY DEFINER
function or browser RPC is used.

Set the real Supabase URL and publishable key plus the server-only directory
URL through deployment secrets. Do not use a service role key for this feature.
When these are absent, Admin login is unavailable and protected pages deny
access; the public site and RFQ route remain independent.

## Remaining deployment gates

- Review and execute the migration only in an approved target. Verify effective
  `authenticated`/`anon`/runtime grants, RLS, and API schema exposure there.
- Bootstrap Auth accounts and directory records through a separately approved
  trusted process. There is no open registration-to-admin path.
- Add a shared, enforced login rate limit (edge or Auth provider) before public
  exposure. The in-process five-attempt limit is only a local backstop and
  cannot coordinate separate workers or prevent distributed attacks.
- Confirm Supabase Auth password policy, MFA, JWT lifetime, sign-out and
  revocation semantics. Cookie removal blocks normal subsequent browser
  requests; a copied access JWT may remain valid until expiry after sign-out.
  Immediate revocation of stolen access tokens needs a separately designed
  server-side revocation check or sufficiently short token lifetime.
- Exercise configured Auth and directory access against an approved disposable
  environment; offline mocks and an unconfigured build cannot prove live login.
- Ensure Admin responses with refreshed cookies are never cached in a shared
  CDN. Maintain HTTPS and security logging without token or credential output.
