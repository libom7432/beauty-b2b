# Catalog × RFQ CLI deployment candidates

`migrations/` is the only candidate source for the initial nonproduction Catalog × RFQ deployment and contains exactly four approved migrations. Each file retains its original version and filename, but its SHA-256 differs from the corresponding file in `supabase/migrations/`: its only byte-level change is removal of the outer `BEGIN;` and `COMMIT;` lines. Run `python3 scripts/verify-supabase-integration-candidates.py` from the repository root and verify all SHA-256 values before packaging or execution.

This directory is the tracked source for a future **isolated CLI project**. Copy only these four files into a new, empty, repository-external `supabase/migrations/` directory after the verifier passes. Review the generated directory and its configuration before any CLI command. Never run an overall `db push` for the initial deployment from the repository's original `supabase/migrations/` directory: that directory also contains Admin migrations and the transaction-bearing originals. Do not mix files from both directories in one CLI project.

Exclude Admin Identity, Catalog Admin Reader, Seed, `roles.sql` or other Roles deployment, Vault updates, other SQL, hooks, data imports, and automated deployment actions. If the CLI displays any additional action, stop before execution.

The candidate files are not yet approved for remote execution. Local PostgreSQL tests do not prove Supabase's actual role, view-owner, TLS, or CLI login-role behavior. Remote identity, permissions, history, backup or rebuild plan, and separate Owner authorization remain required.

Once a version is deployed, keep its bytes immutable. Put later schema or permission changes in a new numbered migration in the same tracked deployment source; do not edit an applied version or mark an unexecuted version as applied. Coordinate any later Admin deployment separately so its exact files and history are reviewed before execution.

If any migration errors, times out, loses its connection, or leaves an unclear result, stop immediately. Do not retry automatically or assume the transaction fully rolled back. Before the next migration, use read-only checks of actual schemas, tables, views, owners, ACLs, RLS, and migration history. Any fix or recovery plan requires separate Owner approval.

Never run `migration repair` automatically. Do not register unexecuted migrations or mark Admin migrations as applied. Consider history coordination only after proving the corresponding SQL actually succeeded; it is a remote write requiring separate Owner approval. Never alter history to conceal a mismatch between objects and recorded versions.
