-- Sprint 2.4.3-A manual acceptance script for the Supabase SQL Editor.
-- Run ONLY after 20261010112952_create_rfq_schema.sql succeeds in a dev/test project.
-- Run the WHOLE file in one SQL Editor execution as a privileged database role.
-- All buyer/product values are fictional. No client grants or policies are changed.
-- The SELECT before ROLLBACK is the result table; the transaction leaves no rows.
-- PL/pgSQL EXCEPTION blocks act as savepoints for deliberately failing statements.

BEGIN;

CREATE TEMP TABLE rfq_acceptance_results (
  seq integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  test_name text NOT NULL,
  result text NOT NULL CHECK (result IN ('PASS', 'FAIL')),
  detail text NOT NULL
) ON COMMIT DROP;

DO $acceptance$
DECLARE
  v_token text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  v_number text;
  v_key text;
  v_product text;
  v_variantless_product text;
  v_sku text;
  v_request uuid;
  v_job_only_request uuid;
  v_schedule_request uuid;
  v_item uuid;
  v_variantless_item uuid;
  v_job uuid;
  v_snapshot jsonb;
  v_second_snapshot jsonb;
  v_variantless_snapshot jsonb;
  v_status text;
  v_attempts integer;
  v_next_attempt timestamptz;
  v_updated timestamptz;
  v_count integer;
  v_role text;
  v_table record;
  v_case record;
  v_state text;
  v_constraint text;
  v_message text;
BEGIN
  v_number := 'RFQ-DEMO-' || v_token;
  v_key := 'rfq-demo-' || lower(v_token);
  v_product := 'demo-product-' || lower(v_token);
  v_variantless_product := 'demo-kit-' || lower(v_token);
  v_sku := 'DEMO-SKU-' || v_token;
  v_snapshot := jsonb_build_object(
    'productName', jsonb_build_object('en', 'Demo Nail Tips', 'zh', '测试甲片'),
    'productSlug', 'demo-nail-tips',
    'selectedVariant', jsonb_build_object('id', 'demo-variant-a', 'attributes', '{}'::jsonb)
  );
  v_second_snapshot := jsonb_build_object(
    'productName', jsonb_build_object('en', 'Demo Nail Tips', 'zh', '测试甲片'),
    'productSlug', 'demo-nail-tips',
    'selectedVariant', jsonb_build_object('id', 'demo-variant-b', 'attributes', '{}'::jsonb)
  );
  v_variantless_snapshot := jsonb_build_object(
    'productName', jsonb_build_object('en', 'Demo Kit', 'zh', '测试套装'),
    'productSlug', 'demo-kit',
    'selectedVariant', 'null'::jsonb
  );

  SELECT count(*) INTO v_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'rfq_private' AND c.relkind = 'r'
    AND c.relname IN ('rfq_requests', 'rfq_items', 'rfq_notification_jobs');
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'Expected three RFQ tables, found %', v_count;
  END IF;
  INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
  VALUES ('schema/tables', 'PASS', 'All three required tables exist');

  SELECT count(*) INTO v_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'rfq_private' AND c.relname IN ('rfq_requests', 'rfq_items', 'rfq_notification_jobs')
    AND c.relrowsecurity;
  IF v_count <> 3 OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'rfq_private') THEN
    RAISE EXCEPTION 'Expected RLS on all three tables and no RFQ policies';
  END IF;
  INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
  VALUES ('RLS', 'PASS', 'RLS enabled on all three tables; no policies');

  FOR v_role IN SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) LOOP
    IF has_schema_privilege(v_role, 'rfq_private', 'USAGE')
       OR has_schema_privilege(v_role, 'rfq_private', 'CREATE')
       OR has_function_privilege(v_role, 'rfq_private.set_updated_at()', 'EXECUTE') THEN
      RAISE EXCEPTION 'Unexpected schema or function privilege for %', v_role;
    END IF;
    FOR v_table IN
      SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'rfq_private'
        AND c.relname IN ('rfq_requests', 'rfq_items', 'rfq_notification_jobs')
    LOOP
      IF has_table_privilege(v_role, v_table.oid, 'SELECT')
         OR has_table_privilege(v_role, v_table.oid, 'INSERT')
         OR has_table_privilege(v_role, v_table.oid, 'UPDATE')
         OR has_table_privilege(v_role, v_table.oid, 'DELETE')
         OR has_table_privilege(v_role, v_table.oid, 'TRUNCATE') THEN
        RAISE EXCEPTION 'Unexpected table privilege for % on %', v_role, v_table.oid::regclass;
      END IF;
    END LOOP;
  END LOOP;
  INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
  VALUES ('client privileges', 'PASS', 'anon/authenticated/service_role lack schema, table and function access; PUBLIC grants would also appear as effective access');

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'rfq_private' AND p.proname = 'set_updated_at'
      AND NOT p.prosecdef AND 'search_path=pg_catalog' = ANY (p.proconfig)
  ) THEN
    RAISE EXCEPTION 'Updated-at function is missing, SECURITY DEFINER, or has an unsafe search_path';
  END IF;
  SELECT count(*) INTO v_count
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'rfq_private' AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')
    AND t.tgname IN ('rfq_requests_updated_at', 'rfq_items_updated_at', 'rfq_notification_jobs_updated_at');
  IF v_count <> 3 THEN RAISE EXCEPTION 'Expected three enabled updated_at triggers, found %', v_count; END IF;
  INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
  VALUES ('trigger definition', 'PASS', 'Three enabled triggers; function uses invoker permissions and pg_catalog search_path');

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'rfq_private.rfq_notification_jobs'::regclass
      AND conname = 'rfq_notification_status_value' AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'Notification status CHECK constraint is missing';
  END IF;
  INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
  VALUES ('notification status definition', 'PASS', 'Notification status CHECK constraint exists');

  INSERT INTO rfq_private.rfq_requests (
    rfq_number, idempotency_key, request_fingerprint, full_name, email,
    company_name, country, buyer_type, requirements, customization, purchase_timeline
  ) VALUES (
    v_number, v_key, repeat('a', 64), 'Demo Buyer', 'rfq-test@example.invalid',
    'Demo Beauty Company', 'US', 'wholesaler', 'Fictional wholesale inquiry for testing.',
    '["oem", "custom_packaging"]'::jsonb, 'planning'
  ) RETURNING id, status INTO v_request, v_status;
  IF v_request IS NULL OR v_status <> 'received' THEN
    RAISE EXCEPTION 'Normal RFQ insert returned an invalid ID or status';
  END IF;
  INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
  VALUES ('request insert', 'PASS', 'Fictional request inserted with received status and UUID');

  INSERT INTO rfq_private.rfq_items (rfq_request_id, product_id, sku, quantity, product_snapshot)
  VALUES (v_request, v_product, v_sku, 100, v_snapshot) RETURNING id INTO v_item;
  INSERT INTO rfq_private.rfq_items (rfq_request_id, product_id, sku, quantity, product_snapshot)
  VALUES (v_request, v_variantless_product, NULL, 25, v_variantless_snapshot)
  RETURNING id INTO v_variantless_item;
  IF v_item IS NULL OR v_variantless_item IS NULL THEN RAISE EXCEPTION 'Normal item insert failed'; END IF;
  INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
  VALUES ('item inserts', 'PASS', 'Variant SKU and variantless product both inserted with snapshots');

  -- A separate exception block is a subtransaction, equivalent to a SAVEPOINT.
  BEGIN
    DELETE FROM rfq_private.rfq_requests WHERE id = v_request;
    RAISE EXCEPTION 'Item FK failed to restrict request deletion';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'rfq_items_rfq_request_id_fkey' THEN
      RAISE EXCEPTION 'Wrong FK blocked item-parent deletion: %', v_constraint;
    END IF;
    INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
    VALUES ('item FK RESTRICT', 'PASS', 'Request with items cannot be deleted');
  END;

  INSERT INTO rfq_private.rfq_notification_jobs (rfq_request_id)
  VALUES (v_request) RETURNING id, status, attempt_count, next_attempt_at
  INTO v_job, v_status, v_attempts, v_next_attempt;
  IF v_job IS NULL OR v_status <> 'pending' OR v_attempts <> 0 OR v_next_attempt IS NULL THEN
    RAISE EXCEPTION 'Normal notification job defaults are incorrect';
  END IF;
  INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
  VALUES ('notification insert', 'PASS', 'Job inserted with pending status, zero attempts and retry time');

  -- A second request with only a job isolates the job FK from the item FK.
  INSERT INTO rfq_private.rfq_requests (
    rfq_number, idempotency_key, request_fingerprint, full_name, email,
    company_name, country, requirements
  ) VALUES (
    v_number || '-JOB', v_key || '-job', repeat('b', 64), 'Demo Buyer',
    'rfq-test@example.invalid', 'Demo Beauty Company', 'US',
    'Fictional notification foreign-key test.'
  ) RETURNING id INTO v_job_only_request;
  INSERT INTO rfq_private.rfq_notification_jobs (rfq_request_id) VALUES (v_job_only_request);
  BEGIN
    DELETE FROM rfq_private.rfq_requests WHERE id = v_job_only_request;
    RAISE EXCEPTION 'Job FK failed to restrict request deletion';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'rfq_notification_jobs_rfq_request_id_fkey' THEN
      RAISE EXCEPTION 'Wrong FK blocked job-parent deletion: %', v_constraint;
    END IF;
  INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
  VALUES ('job FK RESTRICT', 'PASS', 'Request with notification job cannot be deleted');
  END;

  -- Keep this request job-free so a schedule CHECK test cannot be masked by the
  -- one-job-per-request unique constraint.
  INSERT INTO rfq_private.rfq_requests (
    rfq_number, idempotency_key, request_fingerprint, full_name, email,
    company_name, country, requirements
  ) VALUES (
    v_number || '-SCHEDULE', v_key || '-schedule', repeat('c', 64), 'Demo Buyer',
    'rfq-test@example.invalid', 'Demo Beauty Company', 'US',
    'Fictional notification schedule test.'
  ) RETURNING id INTO v_schedule_request;

  -- A second SKU of the same product is valid; only the same product/SKU pair is a duplicate.
  INSERT INTO rfq_private.rfq_items (rfq_request_id, product_id, sku, quantity, product_snapshot)
  VALUES (v_request, v_product, v_sku || '-B', 50, v_second_snapshot);
  INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
  VALUES ('different SKU', 'PASS', 'Second SKU under one product is allowed');

  -- Force a known old timestamp; the trigger must replace it on every table.
  UPDATE rfq_private.rfq_requests SET updated_at = '2000-01-01'::timestamptz
  WHERE id = v_request RETURNING updated_at INTO v_updated;
  IF v_updated IS DISTINCT FROM transaction_timestamp() THEN RAISE EXCEPTION 'Request updated_at trigger failed'; END IF;
  UPDATE rfq_private.rfq_items SET updated_at = '2000-01-01'::timestamptz
  WHERE id = v_item RETURNING updated_at INTO v_updated;
  IF v_updated IS DISTINCT FROM transaction_timestamp() THEN RAISE EXCEPTION 'Item updated_at trigger failed'; END IF;
  UPDATE rfq_private.rfq_notification_jobs SET updated_at = '2000-01-01'::timestamptz
  WHERE id = v_job RETURNING updated_at INTO v_updated;
  IF v_updated IS DISTINCT FROM transaction_timestamp() THEN RAISE EXCEPTION 'Job updated_at trigger failed'; END IF;
  INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
  VALUES ('updated_at triggers', 'PASS', 'All three tables replace a supplied old updated_at value');

  -- Dynamic statements use only local fictional fixture values. Compare both SQLSTATE
  -- and the exact constraint/index name; a different failure is a suite FAIL.
  FOR v_case IN
    SELECT * FROM (VALUES
      ('RFQ number unique', $sql$INSERT INTO rfq_private.rfq_requests
        (rfq_number,idempotency_key,request_fingerprint,full_name,email,company_name,country,requirements)
        VALUES ($2,$3 || '-other',repeat('a',64),'Demo Buyer','rfq-test@example.invalid',
          'Demo Beauty Company','US','Fictional duplicate number test.')$sql$,
        '23505', 'rfq_requests_rfq_number_key'),
      ('idempotency key unique', $sql$INSERT INTO rfq_private.rfq_requests
        (rfq_number,idempotency_key,request_fingerprint,full_name,email,company_name,country,requirements)
        VALUES ($2 || '-OTHER',$3,repeat('a',64),'Demo Buyer','rfq-test@example.invalid',
          'Demo Beauty Company','US','Fictional duplicate idempotency test.')$sql$,
        '23505', 'rfq_requests_idempotency_key_key'),
      ('fingerprint CHECK', $sql$INSERT INTO rfq_private.rfq_requests
        (rfq_number,idempotency_key,request_fingerprint,full_name,email,company_name,country,requirements)
        VALUES ($2 || '-HASH',$3 || '-hash','invalid','Demo Buyer','rfq-test@example.invalid',
          'Demo Beauty Company','US','Fictional fingerprint test.')$sql$,
        '23514', 'rfq_fingerprint_format'),
      ('request status CHECK', $sql$UPDATE rfq_private.rfq_requests SET status = 'draft' WHERE id = $1$sql$,
        '23514', 'rfq_status_value'),
      ('customization CHECK', $sql$UPDATE rfq_private.rfq_requests
        SET customization = '["not_an_option"]'::jsonb WHERE id = $1$sql$,
        '23514', 'rfq_customization_values'),
      ('duplicate product/SKU', $sql$INSERT INTO rfq_private.rfq_items
        (rfq_request_id,product_id,sku,quantity,product_snapshot)
        VALUES ($1,$4,$5,100,$6)$sql$,
        '23505', 'rfq_items_request_product_sku_unique_idx'),
      ('duplicate variantless product', $sql$INSERT INTO rfq_private.rfq_items
        (rfq_request_id,product_id,sku,quantity,product_snapshot)
        VALUES ($1,$7,NULL,25,$8)$sql$,
        '23505', 'rfq_items_request_variantless_product_unique_idx'),
      ('zero quantity CHECK', $sql$INSERT INTO rfq_private.rfq_items
        (rfq_request_id,product_id,sku,quantity,product_snapshot)
        VALUES ($1,$4,$5 || '-ZERO',0,$6)$sql$,
        '23514', 'rfq_item_quantity_positive'),
      ('negative quantity CHECK', $sql$INSERT INTO rfq_private.rfq_items
        (rfq_request_id,product_id,sku,quantity,product_snapshot)
        VALUES ($1,$4,$5 || '-NEG',-1,$6)$sql$,
        '23514', 'rfq_item_quantity_positive'),
      ('unsafe quantity CHECK', $sql$INSERT INTO rfq_private.rfq_items
        (rfq_request_id,product_id,sku,quantity,product_snapshot)
        VALUES ($1,$4,$5 || '-LARGE',9007199254740992,$6)$sql$,
        '23514', 'rfq_item_quantity_positive'),
      ('snapshot CHECK', $sql$INSERT INTO rfq_private.rfq_items
        (rfq_request_id,product_id,sku,quantity,product_snapshot)
        VALUES ($1,$4,$5 || '-EMPTY',1,'{}'::jsonb)$sql$,
        '23514', 'rfq_item_snapshot_shape'),
      ('orphan item FK', $sql$INSERT INTO rfq_private.rfq_items
        (rfq_request_id,product_id,sku,quantity,product_snapshot)
        VALUES (gen_random_uuid(),$4,$5 || '-ORPHAN',1,$6)$sql$,
        '23503', 'rfq_items_rfq_request_id_fkey'),
      ('one notification job per RFQ', $sql$INSERT INTO rfq_private.rfq_notification_jobs
        (rfq_request_id) VALUES ($1)$sql$,
        '23505', 'rfq_notification_jobs_rfq_request_id_key'),
      ('job schedule CHECK', $sql$INSERT INTO rfq_private.rfq_notification_jobs
        (rfq_request_id,status) VALUES ($9,'processing')$sql$,
        '23514', 'rfq_notification_schedule'),
      ('job invalid status CHECK', $sql$INSERT INTO rfq_private.rfq_notification_jobs
        (rfq_request_id,status) VALUES ($9,'unknown')$sql$,
        '23514', 'rfq_notification_schedule|rfq_notification_status_value'),
      ('orphan notification FK', $sql$INSERT INTO rfq_private.rfq_notification_jobs
        (rfq_request_id) VALUES (gen_random_uuid())$sql$,
        '23503', 'rfq_notification_jobs_rfq_request_id_fkey')
    ) AS cases(test_name, statement, expected_state, expected_constraint)
  LOOP
    BEGIN
      EXECUTE v_case.statement USING
        v_request, v_number, v_key, v_product, v_sku, v_snapshot,
        v_variantless_product, v_variantless_snapshot, v_schedule_request;
      RAISE EXCEPTION 'Expected rejection, but statement succeeded';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_message = MESSAGE_TEXT;
      IF v_state IS DISTINCT FROM v_case.expected_state OR v_constraint IS NULL
         OR NOT (v_constraint = ANY (string_to_array(v_case.expected_constraint, '|'))) THEN
        RAISE EXCEPTION 'FAIL %: expected % / %, got % / %: %',
          v_case.test_name, v_case.expected_state, v_case.expected_constraint,
          v_state, v_constraint, v_message;
      END IF;
      INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
      VALUES (v_case.test_name, 'PASS', v_state || ' / ' || v_constraint);
    END;
  END LOOP;

  INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
  VALUES ('SUITE_COMPLETE', 'PASS', 'All planned checks completed; ROLLBACK follows');
  RAISE NOTICE 'PASS: RFQ acceptance suite completed; review result rows below';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
  -- The exception subtransaction discards earlier fixture rows and PASS entries.
  INSERT INTO pg_temp.rfq_acceptance_results (test_name, result, detail)
  VALUES ('SUITE_COMPLETE', 'FAIL', v_state || ': ' || v_message);
  RAISE NOTICE 'FAIL: RFQ acceptance suite: %: %', v_state, v_message;
END
$acceptance$;

-- SQL Editor output can emphasize the final command. Notices repeat the table results.
DO $report$
DECLARE v_row record;
BEGIN
  FOR v_row IN
    SELECT test_name, result, detail FROM pg_temp.rfq_acceptance_results ORDER BY seq
  LOOP
    RAISE NOTICE '%: % - %', v_row.result, v_row.test_name, v_row.detail;
  END LOOP;
END
$report$;

SELECT test_name, result, detail
FROM (
  SELECT seq, test_name, result, detail FROM pg_temp.rfq_acceptance_results
  UNION ALL
  SELECT 2147483647, 'OVERALL',
    CASE WHEN EXISTS (SELECT 1 FROM pg_temp.rfq_acceptance_results WHERE result = 'FAIL')
           OR NOT EXISTS (SELECT 1 FROM pg_temp.rfq_acceptance_results
                          WHERE test_name = 'SUITE_COMPLETE' AND result = 'PASS')
         THEN 'FAIL' ELSE 'PASS' END,
    'All fixture writes are rolled back by the next statement'
) AS report
ORDER BY seq;

ROLLBACK;
