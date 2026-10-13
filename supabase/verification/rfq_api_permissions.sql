-- Sprint 2.4.3-B1 permission acceptance. Run in the DEV Supabase SQL Editor
-- after both RFQ migrations, as a role permitted to SET ROLE rfq_api and
-- anon/authenticated/service_role. Run the whole file once. All data is fake.
-- Every test insert is rolled back. An unexpected failure aborts the script;
-- RFQ_BUSINESS_PERMISSIONS = PASS appears only if every business assertion succeeds.
-- Role-wide PUBLIC and extension rights are audited separately by
-- rfq_api_effective_privileges.sql; business PASS does not authorize LOGIN.
BEGIN;

DO $preflight$
DECLARE
  v_role oid := 'rfq_api'::regrole::oid;
  v_policy_count integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE oid = v_role AND
      (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)
  ) THEN RAISE EXCEPTION 'FAIL role attributes'; END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = v_role)
     OR EXISTS (
       SELECT 1 FROM pg_class WHERE oid IN (
         'rfq_private.rfq_requests'::regclass,
         'rfq_private.rfq_items'::regclass,
         'rfq_private.rfq_notification_jobs'::regclass
       ) AND relowner = v_role
     ) THEN RAISE EXCEPTION 'FAIL role membership or ownership'; END IF;
  RAISE NOTICE 'PASS role attributes, membership, and ownership';

  IF has_database_privilege(v_role, current_database(), 'CREATE')
     OR EXISTS (
       SELECT 1 FROM pg_namespace
       WHERE nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'
         AND has_schema_privilege(v_role, oid, 'CREATE')
     ) THEN RAISE EXCEPTION 'FAIL persistent object CREATE privilege'; END IF;
  RAISE NOTICE 'PASS no persistent database or schema CREATE privilege';

  IF NOT has_schema_privilege(v_role, 'rfq_private', 'USAGE')
     OR has_schema_privilege(v_role, 'rfq_private', 'CREATE')
     OR NOT has_column_privilege(v_role, 'rfq_private.rfq_requests', 'idempotency_key', 'SELECT')
     OR NOT has_column_privilege(v_role, 'rfq_private.rfq_requests', 'id', 'SELECT')
     OR EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = 'rfq_private.rfq_requests'::regclass
         AND attnum > 0 AND NOT attisdropped
         AND attname <> ALL (ARRAY[
           'id', 'rfq_number', 'idempotency_key', 'request_fingerprint',
           'status', 'created_at'
         ])
         AND has_column_privilege(v_role, attrelid, attnum, 'SELECT')
     )
     OR has_table_privilege(v_role, 'rfq_private.rfq_requests', 'UPDATE')
     OR has_table_privilege(v_role, 'rfq_private.rfq_requests', 'DELETE')
     OR has_table_privilege(v_role, 'rfq_private.rfq_items', 'UPDATE')
     OR has_table_privilege(v_role, 'rfq_private.rfq_items', 'DELETE')
     OR has_table_privilege(v_role, 'rfq_private.rfq_notification_jobs', 'UPDATE')
     OR has_table_privilege(v_role, 'rfq_private.rfq_notification_jobs', 'DELETE')
  THEN RAISE EXCEPTION 'FAIL RFQ grants'; END IF;
  RAISE NOTICE 'PASS scoped grants and denied contact/UPDATE/DELETE privileges';

  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rfq_private' AND c.relname IN
        ('rfq_requests', 'rfq_items', 'rfq_notification_jobs') AND c.relrowsecurity) <> 3
  THEN RAISE EXCEPTION 'FAIL RLS disabled'; END IF;
  SELECT count(*) INTO v_policy_count
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'rfq_private';
  IF v_policy_count <> 4 OR EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'rfq_private' AND p.polroles <> ARRAY[v_role]::oid[]
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid = 'rfq_private.rfq_requests'::regclass
      AND polname = 'rfq_api_select_request_metadata' AND polcmd = 'r'
  ) THEN RAISE EXCEPTION 'FAIL RFQ policy scope'; END IF;
  RAISE NOTICE 'PASS RLS enabled and four rfq_api-only policies';

  IF EXISTS (
    SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(name)
    WHERE has_schema_privilege(name, 'rfq_private', 'USAGE')
       OR has_schema_privilege(name, 'rfq_private', 'CREATE')
       OR has_table_privilege(name, 'rfq_private.rfq_requests', 'SELECT')
       OR has_table_privilege(name, 'rfq_private.rfq_requests', 'INSERT')
       OR has_table_privilege(name, 'rfq_private.rfq_requests', 'UPDATE')
       OR has_table_privilege(name, 'rfq_private.rfq_requests', 'DELETE')
       OR has_table_privilege(name, 'rfq_private.rfq_items', 'SELECT')
       OR has_table_privilege(name, 'rfq_private.rfq_items', 'INSERT')
       OR has_table_privilege(name, 'rfq_private.rfq_items', 'UPDATE')
       OR has_table_privilege(name, 'rfq_private.rfq_items', 'DELETE')
       OR has_table_privilege(name, 'rfq_private.rfq_notification_jobs', 'SELECT')
       OR has_table_privilege(name, 'rfq_private.rfq_notification_jobs', 'INSERT')
       OR has_table_privilege(name, 'rfq_private.rfq_notification_jobs', 'UPDATE')
       OR has_table_privilege(name, 'rfq_private.rfq_notification_jobs', 'DELETE')
  ) THEN RAISE EXCEPTION 'FAIL client role privileges'; END IF;
  RAISE NOTICE 'PASS anon/authenticated/service_role effective RFQ grants denied';
END;
$preflight$;

-- Exercise the exact B1 API transaction shape, including explicit arbiter and
-- RETURNING columns. No SELECT grant is needed on items or jobs.
SET LOCAL ROLE rfq_api;
DO $write_path$
DECLARE
  v_token text := replace(gen_random_uuid()::text, '-', '');
  v_key text;
  v_number text;
  v_id uuid;
  v_existing_id uuid;
  v_returned_id uuid;
  v_status text;
  v_fingerprint text;
  v_created timestamptz;
BEGIN
  IF current_user <> 'rfq_api' THEN RAISE EXCEPTION 'FAIL role switch to rfq_api'; END IF;
  v_key := 'rfq-b1-test-' || v_token;
  v_number := 'RFQ-B1-' || upper(substr(v_token, 1, 16));
  PERFORM set_config('rfq_b1_test.key', v_key, true);

  INSERT INTO rfq_private.rfq_requests (
    rfq_number, idempotency_key, request_fingerprint,
    full_name, email, company_name, country, requirements
  ) VALUES (
    v_number, v_key, repeat('a', 64), 'Fictional Buyer',
    'fictional@example.invalid', 'Fictional Nail Company', 'US',
    'Fictional requirement for database permission testing.'
  ) ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id, rfq_number, status, created_at
    INTO v_id, v_number, v_status, v_created;
  IF v_id IS NULL OR v_status <> 'received' OR v_created IS NULL THEN
    RAISE EXCEPTION 'FAIL request INSERT RETURNING';
  END IF;
  RAISE NOTICE 'PASS request INSERT ON CONFLICT RETURNING';

  -- The second request must not replace the first one or create an item/job.
  INSERT INTO rfq_private.rfq_requests (
    rfq_number, idempotency_key, request_fingerprint,
    full_name, email, company_name, country, requirements
  ) VALUES (
    v_number || '-RETRY', v_key, repeat('a', 64), 'Fictional Buyer',
    'fictional@example.invalid', 'Fictional Nail Company', 'US',
    'Fictional requirement for database permission testing.'
  ) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_returned_id;
  IF v_returned_id IS NOT NULL THEN RAISE EXCEPTION 'FAIL duplicate key inserted a request'; END IF;

  SELECT id, request_fingerprint INTO v_existing_id, v_fingerprint
    FROM rfq_private.rfq_requests WHERE idempotency_key = v_key;
  IF v_existing_id IS DISTINCT FROM v_id OR v_fingerprint <> repeat('a', 64) THEN
    RAISE EXCEPTION 'FAIL permitted idempotency metadata SELECT';
  END IF;
  RAISE NOTICE 'PASS duplicate-key replay lookup';

  INSERT INTO rfq_private.rfq_items
    (rfq_request_id, product_id, sku, quantity, product_snapshot)
  VALUES (v_id, 'fictional-product', 'FICTIONAL-SKU', 100,
    jsonb_build_object(
      'productName', jsonb_build_object('en', 'Fictional Tips', 'zh', '虚构甲片'),
      'productSlug', 'fictional-tips',
      'selectedVariant', jsonb_build_object('id', 'fictional-variant', 'attributes', '{}'::jsonb)
    ));
  INSERT INTO rfq_private.rfq_notification_jobs (rfq_request_id) VALUES (v_id);
  RAISE NOTICE 'PASS all three tables inserted in one transaction as rfq_api';

  BEGIN
    EXECUTE 'SELECT email FROM rfq_private.rfq_requests LIMIT 1';
    RAISE EXCEPTION 'FAIL rfq_api read buyer email';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS buyer email SELECT denied';
  END;
  BEGIN
    EXECUTE 'SELECT full_name FROM rfq_private.rfq_requests LIMIT 1';
    RAISE EXCEPTION 'FAIL rfq_api read buyer name';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS buyer name SELECT denied';
  END;
  BEGIN
    EXECUTE $sql$INSERT INTO rfq_private.rfq_requests
      (rfq_number, idempotency_key, request_fingerprint,
       full_name, email, company_name, country, requirements)
      VALUES ('RFQ-B1-DENIED', 'rfq-b1-denied-returning', repeat('a', 64),
              'Fictional Buyer', 'fictional@example.invalid',
              'Fictional Nail Company', 'US', 'Fictional denial test request.')
      RETURNING email$sql$;
    RAISE EXCEPTION 'FAIL rfq_api returned buyer email';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS INSERT RETURNING buyer email denied';
  END;
  BEGIN
    EXECUTE $sql$INSERT INTO rfq_private.rfq_requests
      (rfq_number, idempotency_key, request_fingerprint,
       full_name, email, company_name, country, requirements)
      VALUES ('RFQ-B1-DENIED', 'rfq-b1-denied-upsert', repeat('a', 64),
              'Fictional Buyer', 'fictional@example.invalid',
              'Fictional Nail Company', 'US', 'Fictional denial test request.')
      ON CONFLICT (idempotency_key) DO UPDATE SET requirements = excluded.requirements$sql$;
    RAISE EXCEPTION 'FAIL rfq_api used ON CONFLICT DO UPDATE';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS ON CONFLICT DO UPDATE denied';
  END;
  BEGIN
    EXECUTE 'UPDATE rfq_private.rfq_requests SET requirements = requirements WHERE id = $1' USING v_id;
    RAISE EXCEPTION 'FAIL rfq_api UPDATE succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS request UPDATE denied';
  END;
  BEGIN
    EXECUTE 'DELETE FROM rfq_private.rfq_requests WHERE id = $1' USING v_id;
    RAISE EXCEPTION 'FAIL rfq_api DELETE succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS request DELETE denied';
  END;
  BEGIN
    EXECUTE 'SELECT id FROM rfq_private.rfq_items LIMIT 1';
    RAISE EXCEPTION 'FAIL rfq_api read items';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS item SELECT denied';
  END;
  BEGIN
    EXECUTE 'UPDATE rfq_private.rfq_items SET quantity = quantity WHERE rfq_request_id = $1' USING v_id;
    RAISE EXCEPTION 'FAIL rfq_api item UPDATE succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS item UPDATE denied';
  END;
  BEGIN
    EXECUTE 'DELETE FROM rfq_private.rfq_items WHERE rfq_request_id = $1' USING v_id;
    RAISE EXCEPTION 'FAIL rfq_api item DELETE succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS item DELETE denied';
  END;
  BEGIN
    EXECUTE 'UPDATE rfq_private.rfq_notification_jobs SET attempt_count = 1 WHERE rfq_request_id = $1' USING v_id;
    RAISE EXCEPTION 'FAIL rfq_api job UPDATE succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS job UPDATE denied';
  END;
  BEGIN
    EXECUTE 'DELETE FROM rfq_private.rfq_notification_jobs WHERE rfq_request_id = $1' USING v_id;
    RAISE EXCEPTION 'FAIL rfq_api job DELETE succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS job DELETE denied';
  END;
  BEGIN
    EXECUTE 'CREATE TABLE rfq_private.rfq_b1_forbidden (id integer)';
    RAISE EXCEPTION 'FAIL rfq_api created a private-schema table';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS private-schema object CREATE denied';
  END;
  BEGIN
    EXECUTE 'CREATE SCHEMA rfq_b1_forbidden';
    RAISE EXCEPTION 'FAIL rfq_api created a schema';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS schema CREATE denied';
  END;
END;
$write_path$;
RESET ROLE;

-- The privileged test runner may inspect inserted fixture rows; this is not
-- a grant to rfq_api. A failed assertion aborts the transaction before PASS.
DO $verify_write$
DECLARE
  v_id uuid;
  v_key text := current_setting('rfq_b1_test.key', true);
BEGIN
  IF v_key IS NULL OR v_key = '' THEN RAISE EXCEPTION 'FAIL fixture key missing'; END IF;
  SELECT id INTO v_id FROM rfq_private.rfq_requests WHERE idempotency_key = v_key;
  IF v_id IS NULL
     OR (SELECT count(*) FROM rfq_private.rfq_requests WHERE idempotency_key = v_key) <> 1
     OR (SELECT count(*) FROM rfq_private.rfq_items WHERE rfq_request_id = v_id) <> 1
     OR (SELECT count(*) FROM rfq_private.rfq_notification_jobs WHERE rfq_request_id = v_id) <> 1
  THEN RAISE EXCEPTION 'FAIL atomic fixture shape'; END IF;
  RAISE NOTICE 'PASS one request, one item and one job';
END;
$verify_write$;

SET LOCAL ROLE anon;
DO $anon$
BEGIN
  IF current_user <> 'anon' THEN RAISE EXCEPTION 'FAIL role switch to anon'; END IF;
  BEGIN
    EXECUTE 'SELECT id FROM rfq_private.rfq_requests LIMIT 1';
    RAISE EXCEPTION 'FAIL anon SELECT succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'PASS anon SELECT denied'; END;
  BEGIN
    EXECUTE 'INSERT INTO rfq_private.rfq_notification_jobs (rfq_request_id) VALUES (gen_random_uuid())';
    RAISE EXCEPTION 'FAIL anon INSERT succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'PASS anon INSERT denied'; END;
END;
$anon$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $authenticated$
BEGIN
  IF current_user <> 'authenticated' THEN RAISE EXCEPTION 'FAIL role switch to authenticated'; END IF;
  BEGIN
    EXECUTE 'SELECT id FROM rfq_private.rfq_requests LIMIT 1';
    RAISE EXCEPTION 'FAIL authenticated SELECT succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'PASS authenticated SELECT denied'; END;
  BEGIN
    EXECUTE 'INSERT INTO rfq_private.rfq_notification_jobs (rfq_request_id) VALUES (gen_random_uuid())';
    RAISE EXCEPTION 'FAIL authenticated INSERT succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'PASS authenticated INSERT denied'; END;
END;
$authenticated$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $service_role$
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'FAIL role switch to service_role'; END IF;
  BEGIN
    EXECUTE 'SELECT id FROM rfq_private.rfq_requests LIMIT 1';
    RAISE EXCEPTION 'FAIL service_role SELECT succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'PASS service_role SELECT denied'; END;
  BEGIN
    EXECUTE 'INSERT INTO rfq_private.rfq_notification_jobs (rfq_request_id) VALUES (gen_random_uuid())';
    RAISE EXCEPTION 'FAIL service_role INSERT succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'PASS service_role INSERT denied'; END;
END;
$service_role$;
RESET ROLE;

SELECT 'PASS' AS "RFQ_BUSINESS_PERMISSIONS";

ROLLBACK;
