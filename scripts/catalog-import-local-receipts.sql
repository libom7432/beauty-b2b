-- Local B4.5-B2 test fixture only. Not a production migration.
-- Apply solely after checking catalog_import_test on 127.0.0.1:55439 and its physical data_directory.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'catalog_import_test'
    OR host(inet_server_addr()) <> '127.0.0.1'
    OR inet_server_port() <> 55439
    OR current_user <> 'catalog_test_owner'
    OR current_setting('listen_addresses') <> '127.0.0.1'
    OR current_setting('data_directory') <> '/Users/mima0000/Documents/Codex/2026-10-13/sprint-2-5-a-beauty-b2b/work/catalog-postgres-b1-55439/data'
    OR (SELECT system_identifier::text FROM pg_control_system()) <> '7696341689079925702'
    OR to_regnamespace('rfq_private') IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing non-isolated catalog test database';
  END IF;
END $$;
CREATE TABLE catalog_private.product_import_receipts (
  actor_id text NOT NULL CHECK (actor_id = btrim(actor_id) AND actor_id <> ''),
  idempotency_key text NOT NULL CHECK (idempotency_key = btrim(idempotency_key) AND idempotency_key <> ''),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status = 'committed'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (actor_id, idempotency_key)
);
ALTER TABLE catalog_private.product_import_receipts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON catalog_private.product_import_receipts TO catalog_import, catalog_admin;
CREATE POLICY catalog_import_receipts ON catalog_private.product_import_receipts TO catalog_import
  USING (true) WITH CHECK (true);
CREATE POLICY catalog_admin_receipts ON catalog_private.product_import_receipts TO catalog_admin
  USING (true) WITH CHECK (true);
COMMIT;
