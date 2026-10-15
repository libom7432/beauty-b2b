-- Local B4.5-B2 test fixture only. Not a production migration.
-- D2-B2 target lock: only the independently confirmed isolated 55440 cluster.
-- This file is NOT approved for execution in D2-B2-B1.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'catalog_receipts_d2b_test'
    OR host(inet_server_addr()) <> '127.0.0.1'
    OR inet_server_port() <> 55440
    OR session_user <> 'catalog_d2b_owner'
    OR current_user <> 'catalog_d2b_owner'
    OR current_setting('server_version_num')::integer <> 170011
    OR current_setting('listen_addresses') <> '127.0.0.1'
    -- Pin the exact approved local directory without publishing its user-specific path.
    OR md5(current_setting('data_directory')) <> 'ac947071ffca8478e27c3ef44ff50c1a'
    OR (SELECT system_identifier::text FROM pg_control_system()) <> '7696419892593432091'
    OR to_regnamespace('rfq_private') IS NOT NULL
    OR to_regnamespace('catalog_private') IS NULL
    OR to_regclass('catalog_private.products') IS NULL
    OR to_regclass('catalog_private.catalog_import_receipts') IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_import')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_admin')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_public_reader') THEN
    RAISE EXCEPTION 'Refusing non-isolated catalog test database';
  END IF;
END $$;
-- Fresh isolated fixture only. Requires the unchanged B2 catalog foundation first.
-- It must not run against the old 55439 cluster or any production database.
CREATE ROLE catalog_receipt_maintenance NOLOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE catalog_receipt_maintenance SET search_path = pg_catalog;
GRANT USAGE ON SCHEMA catalog_private TO catalog_receipt_maintenance;
CREATE TABLE catalog_private.catalog_import_receipts (
  actor_id text NOT NULL CHECK (actor_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{1,200}$'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'committed' CHECK (status IN ('committed','expired')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL,
  retry_until timestamptz NOT NULL,
  result_purge_after timestamptz NOT NULL,
  expired_at timestamptz,
  PRIMARY KEY (actor_id, idempotency_key),
  CHECK (retry_until = completed_at + interval '30 days'),
  CHECK (result_purge_after = completed_at + interval '90 days'),
  CHECK ((status = 'committed' AND result IS NOT NULL AND jsonb_typeof(result) = 'object' AND expired_at IS NULL)
    OR (status = 'expired' AND result IS NULL AND expired_at IS NOT NULL AND expired_at >= result_purge_after)),
  CHECK (result IS NULL OR octet_length(result::text) <= 65536)
);
CREATE INDEX catalog_import_receipts_purge_due_idx ON catalog_private.catalog_import_receipts
  (result_purge_after,actor_id,idempotency_key) WHERE status = 'committed';
REVOKE ALL ON catalog_private.catalog_import_receipts FROM PUBLIC, anon, catalog_public_reader;
DO $optional_rfq_role$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rfq_api') THEN
    EXECUTE 'REVOKE ALL ON catalog_private.catalog_import_receipts FROM rfq_api';
    RAISE NOTICE 'rfq_api exists; catalog receipt access revoked';
  ELSE
    RAISE NOTICE 'rfq_api absent; receipt-role check skipped (no RFQ table-level audit)';
  END IF;
END $optional_rfq_role$;
GRANT SELECT, INSERT ON catalog_private.catalog_import_receipts TO catalog_import;
GRANT SELECT ON catalog_private.catalog_import_receipts TO catalog_admin;
GRANT SELECT (actor_id,idempotency_key,status,result_purge_after)
  ON catalog_private.catalog_import_receipts TO catalog_receipt_maintenance;
GRANT UPDATE (status,result,expired_at)
  ON catalog_private.catalog_import_receipts TO catalog_receipt_maintenance;
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
COMMIT;
