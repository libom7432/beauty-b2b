-- REVIEW DRAFT ONLY. Independent incremental repair after lifecycle migration.
-- Do not execute without a separately approved, identity-guarded local test.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('catalog_private.catalog_import_receipts') IS NULL
    OR to_regprocedure('catalog_private.purge_due_catalog_receipt_results(integer)') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS c
      WHERE c.oid = 'catalog_private.catalog_import_receipts'::regclass
        AND c.relrowsecurity AND c.relforcerowsecurity
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
      WHERE p.oid = 'catalog_private.purge_due_catalog_receipt_results(integer)'::regprocedure
        AND p.prosecdef AND r.rolname = 'catalog_receipt_lifecycle_owner'
        AND NOT r.rolsuper AND NOT r.rolbypassrls
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies AS p
      WHERE p.schemaname = 'catalog_private'
        AND p.tablename = 'catalog_import_receipts'
        AND p.policyname = 'catalog_receipt_lifecycle_owner_read'
        AND p.permissive = 'PERMISSIVE' AND p.cmd = 'SELECT'
        AND p.roles = ARRAY['catalog_receipt_lifecycle_owner']::name[]
        AND p.qual = '((status = ''committed''::text) AND (result_purge_after < statement_timestamp()))'
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies AS p
      WHERE p.schemaname = 'catalog_private'
        AND p.tablename = 'catalog_import_receipts'
        AND p.policyname = 'catalog_receipt_lifecycle_owner_expire'
        AND p.permissive = 'PERMISSIVE' AND p.cmd = 'UPDATE'
        AND p.roles = ARRAY['catalog_receipt_lifecycle_owner']::name[]
        AND p.qual = '((status = ''committed''::text) AND (result_purge_after < statement_timestamp()))'
        AND p.with_check = '((status = ''expired''::text) AND (expired_at > result_purge_after))'
    ) THEN
    RAISE EXCEPTION 'Catalog receipt lifecycle RLS repair preflight failed';
  END IF;
END;
$preflight$;

-- UPDATE ... RETURNING 1 also checks SELECT RLS on the post-update row.
-- Permit the definer to see only due receipt metadata in either lifecycle state.
-- The unchanged UPDATE USING still accepts only due committed source rows;
-- the unchanged WITH CHECK still accepts only expired target rows.
ALTER POLICY catalog_receipt_lifecycle_owner_read
  ON catalog_private.catalog_import_receipts
  USING (
    result_purge_after < pg_catalog.statement_timestamp()
    AND status IN ('committed', 'expired')
  );

-- Do not change the update policy, column grants, function, or caller rights.
ALTER TABLE catalog_private.catalog_import_receipts FORCE ROW LEVEL SECURITY;
COMMIT;
