-- REVIEW DRAFT ONLY. Independent incremental migration after catalog-import-receipts.draft.sql.
-- DO NOT execute in the current isolated database or add to an automatic migrations directory.
-- The migration operator must be separately approved to create roles and alter these grants.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('catalog_private.catalog_import_receipts') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_import' AND NOT rolcanlogin AND NOT rolbypassrls)
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_admin' AND NOT rolcanlogin AND NOT rolbypassrls)
    OR to_regprocedure('catalog_private.lookup_catalog_import_receipt(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Catalog receipt hardening preflight failed';
  END IF;
END;
$preflight$;

CREATE ROLE catalog_receipt_lookup_owner NOLOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE catalog_receipt_lookup_owner SET search_path = pg_catalog;
GRANT USAGE ON SCHEMA catalog_private TO catalog_receipt_lookup_owner;
GRANT SELECT (actor_id, idempotency_key, request_fingerprint, status, result, retry_until)
  ON catalog_private.catalog_import_receipts TO catalog_receipt_lookup_owner;

-- Keep FORCE RLS. This policy is for the dedicated function owner only; its
-- caller can still pass an arbitrary actor_id while the DB login is shared.
CREATE POLICY catalog_receipt_lookup_owner_read ON catalog_private.catalog_import_receipts
  FOR SELECT TO catalog_receipt_lookup_owner USING (true);

-- ALTER FUNCTION OWNER requires SET ROLE membership and CREATE on the schema.
-- Both grants are temporary within this migration transaction.
GRANT CREATE ON SCHEMA catalog_private TO catalog_receipt_lookup_owner;
GRANT catalog_receipt_lookup_owner TO CURRENT_USER WITH SET TRUE;

CREATE FUNCTION catalog_private.lookup_catalog_import_receipt(p_actor_id text, p_idempotency_key text)
RETURNS TABLE (request_fingerprint text, status text, result jsonb, within_retry_window boolean)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT r.request_fingerprint, r.status,
    CASE WHEN r.result IS NULL THEN NULL::jsonb ELSE pg_catalog.jsonb_build_object(
      'status', r.result -> 'status',
      'import_batch_id', r.result -> 'import_batch_id',
      'snapshot_version', r.result -> 'snapshot_version',
      'product_count', r.result -> 'product_count',
      'identity_map', r.result -> 'identity_map') END,
    pg_catalog.clock_timestamp() <= r.retry_until
  FROM catalog_private.catalog_import_receipts AS r
  WHERE r.actor_id = p_actor_id AND r.idempotency_key = p_idempotency_key
    AND p_actor_id ~ '^[A-Za-z0-9_-]{1,200}$'
    AND p_idempotency_key ~ '^[A-Za-z0-9_-]{1,200}$'
  LIMIT 1
$function$;
REVOKE ALL ON FUNCTION catalog_private.lookup_catalog_import_receipt(text,text) FROM PUBLIC;
ALTER FUNCTION catalog_private.lookup_catalog_import_receipt(text,text) OWNER TO catalog_receipt_lookup_owner;
REVOKE CREATE ON SCHEMA catalog_private FROM catalog_receipt_lookup_owner;
REVOKE catalog_receipt_lookup_owner FROM CURRENT_USER;
GRANT EXECUTE ON FUNCTION catalog_private.lookup_catalog_import_receipt(text,text) TO catalog_import;

-- Remove broad direct reads, including the policies that used USING (true).
REVOKE SELECT ON catalog_private.catalog_import_receipts FROM catalog_import, catalog_admin;
DROP POLICY catalog_import_receipts_read ON catalog_private.catalog_import_receipts;
DROP POLICY catalog_admin_receipts_read ON catalog_private.catalog_import_receipts;

-- Retain only columns required for atomic receipt insertion. The existing
-- INSERT RLS policy and composite primary key remain unchanged.
REVOKE INSERT ON catalog_private.catalog_import_receipts FROM catalog_import;
GRANT INSERT (actor_id, idempotency_key, request_fingerprint, status, result,
  completed_at, retry_until, result_purge_after)
  ON catalog_private.catalog_import_receipts TO catalog_import;

REVOKE ALL ON catalog_private.catalog_import_receipts FROM PUBLIC, anon, catalog_public_reader;
DO $revoke_optional$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON catalog_private.catalog_import_receipts FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON catalog_private.catalog_import_receipts FROM service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rfq_api') THEN
    EXECUTE 'REVOKE ALL ON catalog_private.catalog_import_receipts FROM rfq_api';
  END IF;
END;
$revoke_optional$;
ALTER TABLE catalog_private.catalog_import_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_private.catalog_import_receipts FORCE ROW LEVEL SECURITY;

-- No DELETE grant or policy. Existing maintenance grants/policies, 30/90-day
-- constraints and permanent (actor_id,idempotency_key) tombstones are untouched.
COMMIT;
