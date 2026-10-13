\set ON_ERROR_STOP on
-- Run only after both local passwords have been set interactively.
-- Read-only assertions. A failure stops the staged setup before test execution.
DO $audit$
DECLARE
  v_role text;
  v_table text;
  v_column text;
BEGIN
  IF current_user <> 'mima0000'
     OR current_database() <> 'rfq_integration_test'
     OR current_setting('server_version') NOT LIKE '17.11%'
     OR current_setting('data_directory') <> '/Users/mima0000/Library/Application Support/Postgres/var-17'
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR inet_server_port() <> 5432 THEN
    RAISE EXCEPTION 'not the approved local test database/administrator';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database
             WHERE datname NOT IN ('postgres', 'template0', 'template1',
                                   'rfq_integration_test')) THEN
    RAISE EXCEPTION 'another business database exists in the cluster';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_database d
    CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
    WHERE d.datname = current_database() AND a.grantee = 0
      AND a.privilege_type IN ('CONNECT', 'TEMPORARY', 'CREATE')
  ) THEN
    RAISE EXCEPTION 'test database has PUBLIC privileges';
  END IF;
  IF (SELECT count(*) FROM pg_authid
      WHERE rolname IN ('anon', 'authenticated', 'service_role')
        AND NOT rolcanlogin AND rolpassword IS NULL AND NOT rolsuper
        AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
        AND NOT rolbypassrls AND NOT rolinherit) <> 3 THEN
    RAISE EXCEPTION 'local Migration stand-in roles differ from plan';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members
             WHERE member IN ('rfq_api'::regrole, 'rfq_test_auditor'::regrole)
                OR roleid IN ('rfq_api'::regrole, 'rfq_test_auditor'::regrole)) THEN
    RAISE EXCEPTION 'test role membership unexpectedly expands permissions';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c
             WHERE c.oid IN ('rfq_private.rfq_requests'::regclass,
                             'rfq_private.rfq_items'::regclass,
                             'rfq_private.rfq_notification_jobs'::regclass)
               AND (NOT c.relrowsecurity OR c.relowner <> 'mima0000'::regrole))
     OR (SELECT count(*) FROM pg_class c
         WHERE c.oid IN ('rfq_private.rfq_requests'::regclass,
                         'rfq_private.rfq_items'::regclass,
                         'rfq_private.rfq_notification_jobs'::regclass)) <> 3 THEN
    RAISE EXCEPTION 'RFQ table owner or RLS differs from plan';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
    WHERE c.oid IN ('rfq_private.rfq_requests'::regclass,
                    'rfq_private.rfq_items'::regclass,
                    'rfq_private.rfq_notification_jobs'::regclass)
      AND a.grantee = 0
  ) OR EXISTS (
    SELECT 1 FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
    WHERE n.nspname = 'rfq_private' AND a.grantee = 0
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute att
    JOIN pg_class c ON c.oid = att.attrelid
    CROSS JOIN LATERAL aclexplode(att.attacl) a
    WHERE c.oid IN ('rfq_private.rfq_requests'::regclass,
                    'rfq_private.rfq_items'::regclass,
                    'rfq_private.rfq_notification_jobs'::regclass)
      AND att.attnum > 0 AND NOT att.attisdropped AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'RFQ objects have PUBLIC grants';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'rfq_private') <> 7
     OR (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'rfq_private'
        AND policyname IN ('rfq_api_insert_requests',
          'rfq_api_select_request_metadata', 'rfq_api_insert_items',
          'rfq_api_insert_notification_jobs', 'rfq_test_auditor_read_requests',
          'rfq_test_auditor_read_items', 'rfq_test_auditor_read_jobs')) <> 7 THEN
    RAISE EXCEPTION 'expected RLS policies are missing';
  END IF;
  FOR v_role IN SELECT unnest(ARRAY['rfq_api', 'rfq_test_auditor']) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_authid WHERE rolname = v_role
        AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
        AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
        AND NOT rolinherit AND rolpassword LIKE 'SCRAM-SHA-256$%'
    ) THEN
      RAISE EXCEPTION 'test role attributes or SCRAM verifier differ from plan: %', v_role;
    END IF;
    IF NOT has_database_privilege(v_role, current_database(), 'CONNECT')
       OR has_database_privilege(v_role, current_database(), 'CREATE')
       OR has_database_privilege(v_role, current_database(), 'TEMPORARY')
       OR NOT has_schema_privilege(v_role, 'rfq_private', 'USAGE')
       OR has_schema_privilege(v_role, 'rfq_private', 'CREATE')
       OR has_schema_privilege(v_role, 'public', 'CREATE')
       OR EXISTS (SELECT 1 FROM pg_namespace n
                  WHERE n.nspname NOT LIKE 'pg_temp_%'
                    AND n.nspname NOT LIKE 'pg_toast_temp_%'
                    AND has_schema_privilege(v_role, n.oid, 'CREATE'))
       OR has_function_privilege(v_role, 'rfq_private.set_updated_at()', 'EXECUTE') THEN
      RAISE EXCEPTION 'test role database/schema/function privileges differ: %', v_role;
    END IF;
    FOREACH v_table IN ARRAY ARRAY['rfq_requests', 'rfq_items', 'rfq_notification_jobs'] LOOP
      IF has_table_privilege(v_role, 'rfq_private.' || v_table,
                             'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN') THEN
        -- Column-level grants are expected; table-wide grants are not.
        RAISE EXCEPTION 'test role has table-wide privilege: %', v_role;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_attribute att
    JOIN pg_class c ON c.oid = att.attrelid
    WHERE c.oid IN ('rfq_private.rfq_requests'::regclass,
                    'rfq_private.rfq_items'::regclass,
                    'rfq_private.rfq_notification_jobs'::regclass)
      AND att.attnum > 0 AND NOT att.attisdropped
      AND (
        has_column_privilege('rfq_test_auditor', c.oid, att.attnum,
                             'INSERT, UPDATE, REFERENCES')
        OR has_column_privilege('rfq_api', c.oid, att.attnum,
                                'UPDATE, REFERENCES')
        OR (has_column_privilege('rfq_api', c.oid, att.attnum, 'INSERT')
            AND NOT ((c.relname = 'rfq_requests' AND att.attname = ANY(ARRAY[
              'rfq_number', 'idempotency_key', 'request_fingerprint',
              'full_name', 'email', 'company_name', 'country', 'whatsapp',
              'website', 'buyer_type', 'requirements', 'customization',
              'purchase_timeline']))
              OR (c.relname = 'rfq_items' AND att.attname = ANY(ARRAY[
                'rfq_request_id', 'product_id', 'sku', 'quantity',
                'product_snapshot']))
              OR (c.relname = 'rfq_notification_jobs'
                  AND att.attname = 'rfq_request_id')))
        OR (has_column_privilege('rfq_api', c.oid, att.attnum, 'SELECT')
            AND NOT (c.relname = 'rfq_requests' AND att.attname = ANY(ARRAY[
              'id', 'rfq_number', 'idempotency_key', 'request_fingerprint',
              'status', 'created_at'])))
        OR (has_column_privilege('rfq_test_auditor', c.oid, att.attnum, 'SELECT')
            AND NOT ((c.relname = 'rfq_requests'
                      AND att.attname = ANY(ARRAY['id', 'idempotency_key']))
                     OR (c.relname IN ('rfq_items', 'rfq_notification_jobs')
                         AND att.attname = 'rfq_request_id')))
      )
  ) THEN
    RAISE EXCEPTION 'test role has an unexpected column grant';
  END IF;
  FOREACH v_column IN ARRAY ARRAY['id', 'rfq_number', 'idempotency_key',
       'request_fingerprint', 'status', 'created_at'] LOOP
    IF NOT has_column_privilege('rfq_api', 'rfq_private.rfq_requests', v_column, 'SELECT') THEN
      RAISE EXCEPTION 'rfq_api metadata SELECT grant is missing';
    END IF;
  END LOOP;
  FOREACH v_column IN ARRAY ARRAY['rfq_number', 'idempotency_key',
       'request_fingerprint', 'full_name', 'email', 'company_name', 'country',
       'whatsapp', 'website', 'buyer_type', 'requirements', 'customization',
       'purchase_timeline'] LOOP
    IF NOT has_column_privilege('rfq_api', 'rfq_private.rfq_requests', v_column, 'INSERT') THEN
      RAISE EXCEPTION 'rfq_api request INSERT grant is missing';
    END IF;
  END LOOP;
  FOREACH v_column IN ARRAY ARRAY['rfq_request_id', 'product_id', 'sku',
       'quantity', 'product_snapshot'] LOOP
    IF NOT has_column_privilege('rfq_api', 'rfq_private.rfq_items', v_column, 'INSERT') THEN
      RAISE EXCEPTION 'rfq_api item INSERT grant is missing';
    END IF;
  END LOOP;
  IF NOT has_column_privilege('rfq_api', 'rfq_private.rfq_requests', 'id', 'SELECT')
     OR NOT has_column_privilege('rfq_api', 'rfq_private.rfq_requests', 'idempotency_key', 'SELECT')
     OR NOT has_column_privilege('rfq_api', 'rfq_private.rfq_requests', 'rfq_number', 'INSERT')
     OR NOT has_column_privilege('rfq_api', 'rfq_private.rfq_items', 'rfq_request_id', 'INSERT')
     OR NOT has_column_privilege('rfq_api', 'rfq_private.rfq_notification_jobs', 'rfq_request_id', 'INSERT') THEN
    RAISE EXCEPTION 'rfq_api required column grants are missing';
  END IF;
  FOREACH v_column IN ARRAY ARRAY['full_name', 'email', 'company_name',
                                   'whatsapp', 'website', 'requirements'] LOOP
    IF has_column_privilege('rfq_api', 'rfq_private.rfq_requests', v_column, 'SELECT')
       OR has_column_privilege('rfq_test_auditor', 'rfq_private.rfq_requests', v_column, 'SELECT') THEN
      RAISE EXCEPTION 'contact/requirements SELECT grant is too broad';
    END IF;
  END LOOP;
  IF NOT has_column_privilege('rfq_test_auditor', 'rfq_private.rfq_requests', 'id', 'SELECT')
     OR NOT has_column_privilege('rfq_test_auditor', 'rfq_private.rfq_requests', 'idempotency_key', 'SELECT')
     OR NOT has_column_privilege('rfq_test_auditor', 'rfq_private.rfq_items', 'rfq_request_id', 'SELECT')
     OR NOT has_column_privilege('rfq_test_auditor', 'rfq_private.rfq_notification_jobs', 'rfq_request_id', 'SELECT')
     OR has_column_privilege('rfq_test_auditor', 'rfq_private.rfq_items', 'product_snapshot', 'SELECT')
     OR has_column_privilege('rfq_test_auditor', 'rfq_private.rfq_notification_jobs', 'last_error', 'SELECT') THEN
    RAISE EXCEPTION 'auditor SELECT columns differ from plan';
  END IF;
END;
$audit$;

-- Confirm the audit role's actual count query needs no extra grants.
BEGIN;
SET LOCAL ROLE rfq_test_auditor;
SELECT count(*) FROM rfq_private.rfq_requests;
SELECT count(*) FROM rfq_private.rfq_items;
SELECT count(*) FROM rfq_private.rfq_notification_jobs;
ROLLBACK;
