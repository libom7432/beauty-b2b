-- REVIEW DRAFT ONLY: Sprint 2.5-B4.5-D1. Never picked up by Supabase migrations.
-- D2-A aligns the adapter name and lifecycle contract, but does not execute this SQL.
-- Do not execute until D2-B approves the deployment target, role provisioning,
-- retention worker, local boundary tests, and rollback plan.
BEGIN;

DO $preflight$
BEGIN
  IF to_regnamespace('catalog_private') IS NULL
    OR to_regclass('catalog_private.products') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_import')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_admin') THEN
    RAISE EXCEPTION 'Catalog foundation and server roles are required';
  END IF;
END;
$preflight$;

CREATE ROLE catalog_receipt_maintenance NOLOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE catalog_receipt_maintenance SET search_path = pg_catalog;
GRANT USAGE ON SCHEMA catalog_private TO catalog_receipt_maintenance;

CREATE TABLE catalog_private.catalog_import_receipts (
  actor_id text NOT NULL CHECK (actor_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{1,200}$'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'committed' CHECK (status IN ('committed', 'expired')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL,
  retry_until timestamptz NOT NULL,
  result_purge_after timestamptz NOT NULL,
  expired_at timestamptz,
  PRIMARY KEY (actor_id, idempotency_key),
  CHECK (retry_until = completed_at + interval '30 days'),
  CHECK (result_purge_after = completed_at + interval '90 days'),
  CHECK (
    (status = 'committed' AND result IS NOT NULL AND jsonb_typeof(result) = 'object' AND expired_at IS NULL)
    OR (status = 'expired' AND result IS NULL AND expired_at IS NOT NULL
      AND expired_at >= result_purge_after)
  ),
  CHECK (result IS NULL OR octet_length(result::text) <= 65536)
);
CREATE INDEX catalog_import_receipts_purge_due_idx
  ON catalog_private.catalog_import_receipts (result_purge_after, actor_id, idempotency_key)
  WHERE status = 'committed';

REVOKE ALL ON catalog_private.catalog_import_receipts FROM PUBLIC, anon, catalog_public_reader;
GRANT SELECT, INSERT ON catalog_private.catalog_import_receipts TO catalog_import;
GRANT SELECT ON catalog_private.catalog_import_receipts TO catalog_admin;
GRANT SELECT (actor_id, idempotency_key, status, result_purge_after)
  ON catalog_private.catalog_import_receipts TO catalog_receipt_maintenance;
GRANT UPDATE (status, result, expired_at)
  ON catalog_private.catalog_import_receipts TO catalog_receipt_maintenance;

-- These roles exist on Supabase, but a standalone catalog test database may omit them.
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
CREATE POLICY catalog_import_receipts_read ON catalog_private.catalog_import_receipts
  FOR SELECT TO catalog_import USING (true);
CREATE POLICY catalog_import_receipts_insert ON catalog_private.catalog_import_receipts
  FOR INSERT TO catalog_import WITH CHECK (status = 'committed' AND result IS NOT NULL);
CREATE POLICY catalog_admin_receipts_read ON catalog_private.catalog_import_receipts
  FOR SELECT TO catalog_admin USING (true);
CREATE POLICY catalog_receipt_maintenance_read ON catalog_private.catalog_import_receipts
  FOR SELECT TO catalog_receipt_maintenance USING (status = 'committed' AND result_purge_after <= now());
CREATE POLICY catalog_receipt_maintenance_expire ON catalog_private.catalog_import_receipts
  FOR UPDATE TO catalog_receipt_maintenance
  USING (status = 'committed' AND result_purge_after <= now())
  WITH CHECK (status = 'expired' AND result IS NULL AND expired_at IS NOT NULL);

-- PostgreSQL GRANT and RLS both apply. This draft grants no DELETE to any role,
-- no RFQ privilege, no PUBLIC access, and defines no SECURITY DEFINER function.
COMMIT;
