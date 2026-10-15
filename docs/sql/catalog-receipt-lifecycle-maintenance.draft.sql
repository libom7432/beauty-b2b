-- REVIEW DRAFT ONLY. Independent incremental migration after receipt access hardening.
-- Do not place in an automatic migrations directory or execute in this sprint.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('catalog_private.catalog_import_receipts') IS NULL
    OR to_regprocedure('catalog_private.lookup_catalog_import_receipt(text,text)') IS NULL
    OR to_regprocedure('catalog_private.purge_due_catalog_receipt_results(integer)') IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='catalog_receipt_maintenance'
      AND NOT rolcanlogin AND NOT rolbypassrls)
    OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='catalog_private.catalog_import_receipts'::regclass
      AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION 'Catalog receipt maintenance preflight failed';
  END IF;
END;
$preflight$;

CREATE ROLE catalog_receipt_lifecycle_owner NOLOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE catalog_receipt_lifecycle_owner SET search_path = pg_catalog;
GRANT USAGE ON SCHEMA catalog_private TO catalog_receipt_lifecycle_owner;
GRANT SELECT (actor_id,idempotency_key,status,result_purge_after)
  ON catalog_private.catalog_import_receipts TO catalog_receipt_lifecycle_owner;
GRANT UPDATE (status,result,expired_at)
  ON catalog_private.catalog_import_receipts TO catalog_receipt_lifecycle_owner;

CREATE POLICY catalog_receipt_lifecycle_owner_read ON catalog_private.catalog_import_receipts
  FOR SELECT TO catalog_receipt_lifecycle_owner
  USING (status='committed' AND result_purge_after < pg_catalog.statement_timestamp());
CREATE POLICY catalog_receipt_lifecycle_owner_expire ON catalog_private.catalog_import_receipts
  FOR UPDATE TO catalog_receipt_lifecycle_owner
  USING (status='committed' AND result_purge_after < pg_catalog.statement_timestamp())
  -- The table CHECK constraint separately requires result IS NULL for expired rows.
  WITH CHECK (status='expired' AND expired_at > result_purge_after);

-- Temporary DDL ownership grants are revoked before COMMIT.
GRANT CREATE ON SCHEMA catalog_private TO catalog_receipt_lifecycle_owner;
GRANT catalog_receipt_lifecycle_owner TO CURRENT_USER WITH SET TRUE;

CREATE FUNCTION catalog_private.purge_due_catalog_receipt_results(p_limit integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  purged integer;
  v_cutoff timestamptz;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Invalid maintenance batch limit' USING ERRCODE='22023';
  END IF;
  -- Same transaction-level lock as catalog import, acquired before any receipt row lock.
  -- 55P03 is PostgreSQL lock_not_available; a busy lock is not an empty batch.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(725604510131::bigint) THEN
    RAISE EXCEPTION 'Catalog receipt maintenance busy' USING ERRCODE='55P03';
  END IF;
  -- The stored deadline is completed_at + 90 days. The RLS policies use this
  -- same PostgreSQL statement timestamp; one assignment governs this batch.
  v_cutoff := pg_catalog.statement_timestamp();
  WITH due AS MATERIALIZED (
    SELECT r.actor_id,r.idempotency_key
    FROM catalog_private.catalog_import_receipts AS r
    WHERE r.status='committed' AND r.result_purge_after < v_cutoff
    ORDER BY r.result_purge_after,r.actor_id,r.idempotency_key
    LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), changed AS (
    UPDATE catalog_private.catalog_import_receipts AS r
       SET status='expired',result=NULL,expired_at=v_cutoff
      FROM due
     WHERE r.actor_id=due.actor_id AND r.idempotency_key=due.idempotency_key
       AND r.status='committed' AND r.result_purge_after < v_cutoff
    RETURNING 1
  ) SELECT count(*)::integer INTO purged FROM changed;
  RETURN purged;
END;
$function$;

REVOKE ALL ON FUNCTION catalog_private.purge_due_catalog_receipt_results(integer) FROM PUBLIC;
ALTER FUNCTION catalog_private.purge_due_catalog_receipt_results(integer) OWNER TO catalog_receipt_lifecycle_owner;
REVOKE CREATE ON SCHEMA catalog_private FROM catalog_receipt_lifecycle_owner;
REVOKE catalog_receipt_lifecycle_owner FROM CURRENT_USER;

-- The caller receives only a bounded count. It cannot directly read result or update rows.
REVOKE SELECT (actor_id,idempotency_key,status,result_purge_after)
  ON catalog_private.catalog_import_receipts FROM catalog_receipt_maintenance;
REVOKE UPDATE (status,result,expired_at)
  ON catalog_private.catalog_import_receipts FROM catalog_receipt_maintenance;
DROP POLICY catalog_receipt_maintenance_read ON catalog_private.catalog_import_receipts;
DROP POLICY catalog_receipt_maintenance_expire ON catalog_private.catalog_import_receipts;
GRANT EXECUTE ON FUNCTION catalog_private.purge_due_catalog_receipt_results(integer)
  TO catalog_receipt_maintenance;
ALTER TABLE catalog_private.catalog_import_receipts FORCE ROW LEVEL SECURITY;
COMMIT;
