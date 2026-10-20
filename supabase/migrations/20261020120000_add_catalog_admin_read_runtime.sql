-- B4-B2-A: additive Catalog Admin read identity. Draft only; never run against cloud in this stage.
-- Depends on 20261013120000_create_catalog_foundation.sql and its six private tables.
-- Credential provisioning is a separate trusted operation; this migration stores no password.
BEGIN;

DO $$
DECLARE
  function_name text;
  function_id oid;
  foundation_functions constant text[] := ARRAY[
    'catalog_private.normalized_variant_attributes(jsonb)',
    'catalog_private.product_row_guard()',
    'catalog_private.variant_row_guard()',
    'catalog_private.category_guard()',
    'catalog_private.touch_updated_at()',
    'catalog_private.check_product_publication(uuid)',
    'catalog_private.enforce_product_publication()'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_admin_reader_runtime') THEN
    RAISE EXCEPTION 'Catalog reader role already exists; audit it before continuing';
  END IF;
  IF to_regclass('catalog_private.products') IS NULL OR
     to_regclass('catalog_private.product_variants') IS NULL OR
     to_regclass('catalog_private.categories') IS NULL OR
     to_regclass('catalog_private.product_categories') IS NULL OR
     to_regclass('catalog_private.product_images') IS NULL OR
     to_regclass('catalog_private.product_translations') IS NULL THEN
    RAISE EXCEPTION 'Catalog foundation is missing';
  END IF;
  -- An unknown function or ACL must be reviewed, never swept into an ALL FUNCTIONS grant.
  SELECT format('%I.%I(%s)', n.nspname, p.proname,
    pg_get_function_identity_arguments(p.oid)) INTO function_name
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'catalog_private'
    AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY[
      to_regprocedure(foundation_functions[1]), to_regprocedure(foundation_functions[2]),
      to_regprocedure(foundation_functions[3]), to_regprocedure(foundation_functions[4]),
      to_regprocedure(foundation_functions[5]), to_regprocedure(foundation_functions[6]),
      to_regprocedure(foundation_functions[7]),
      to_regprocedure('catalog_private.lookup_catalog_import_receipt(text,text)'),
      to_regprocedure('catalog_private.purge_due_catalog_receipt_results(integer)')]) AS expected(id)
      WHERE expected.id = p.oid)
  LIMIT 1;
  IF function_name IS NOT NULL THEN
    RAISE EXCEPTION 'Unreviewed catalog_private function: %; audit ACL before deployment', function_name;
  END IF;
  FOREACH function_name IN ARRAY foundation_functions LOOP
    function_id := to_regprocedure(function_name);
    IF function_id IS NULL OR
       NOT has_function_privilege('catalog_admin', function_id, 'EXECUTE') OR
       NOT has_function_privilege('catalog_import', function_id, 'EXECUTE') THEN
      RAISE EXCEPTION 'Unreviewed foundation function ACL: %', function_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p,
      LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid = function_id AND a.privilege_type = 'EXECUTE'
        AND a.grantee <> 0 AND a.grantee <> p.proowner
        AND NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid = a.grantee
          AND r.rolname IN ('catalog_admin','catalog_import',
            'catalog_public_reader','catalog_receipt_maintenance'))) THEN
      RAISE EXCEPTION 'Unreviewed foundation function grantee: %', function_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper
      AND r.rolname NOT IN ('catalog_admin','catalog_import',
        'catalog_public_reader','catalog_receipt_maintenance')
      AND has_schema_privilege(r.oid, 'catalog_private', 'USAGE')
      AND has_function_privilege(r.oid, function_id, 'EXECUTE')) THEN
      RAISE EXCEPTION 'Unreviewed foundation function caller: %', function_name;
    END IF;
  END LOOP;
  function_id := to_regprocedure('catalog_private.lookup_catalog_import_receipt(text,text)');
  IF function_id IS NOT NULL AND (
    NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = function_id
      AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'catalog_receipt_lookup_owner'
      AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) OR
    NOT has_function_privilege('catalog_import', function_id, 'EXECUTE') OR
    has_function_privilege('catalog_admin', function_id, 'EXECUTE') OR
    EXISTS (SELECT 1 FROM pg_proc p,
      LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid = function_id AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Unreviewed receipt lookup ACL; audit before deployment';
  END IF;
  function_id := to_regprocedure('catalog_private.purge_due_catalog_receipt_results(integer)');
  IF function_id IS NOT NULL AND (
    NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = function_id
      AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'catalog_receipt_lifecycle_owner'
      AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) OR
    to_regrole('catalog_receipt_maintenance') IS NULL OR
    NOT has_function_privilege('catalog_receipt_maintenance', function_id, 'EXECUTE') OR
    has_function_privilege('catalog_admin', function_id, 'EXECUTE') OR
    has_function_privilege('catalog_import', function_id, 'EXECUTE') OR
    EXISTS (SELECT 1 FROM pg_proc p,
      LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid = function_id AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Unreviewed receipt maintenance ACL; audit before deployment';
  END IF;
END $$;

CREATE ROLE catalog_admin_reader_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOBYPASSRLS PASSWORD NULL;
ALTER ROLE catalog_admin_reader_runtime SET search_path = pg_catalog;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO catalog_admin_reader_runtime', current_database());
END $$;
GRANT USAGE ON SCHEMA catalog_private TO catalog_admin_reader_runtime;
GRANT SELECT ON
  catalog_private.products, catalog_private.product_variants,
  catalog_private.categories, catalog_private.product_categories,
  catalog_private.product_images, catalog_private.product_translations
TO catalog_admin_reader_runtime;

CREATE POLICY catalog_admin_reader_products ON catalog_private.products
  FOR SELECT TO catalog_admin_reader_runtime USING (true);
CREATE POLICY catalog_admin_reader_variants ON catalog_private.product_variants
  FOR SELECT TO catalog_admin_reader_runtime USING (true);
CREATE POLICY catalog_admin_reader_categories ON catalog_private.categories
  FOR SELECT TO catalog_admin_reader_runtime USING (true);
CREATE POLICY catalog_admin_reader_product_categories ON catalog_private.product_categories
  FOR SELECT TO catalog_admin_reader_runtime USING (true);
CREATE POLICY catalog_admin_reader_images ON catalog_private.product_images
  FOR SELECT TO catalog_admin_reader_runtime USING (true);
CREATE POLICY catalog_admin_reader_translations ON catalog_private.product_translations
  FOR SELECT TO catalog_admin_reader_runtime USING (true);

-- Only the seven reviewed signatures are touched. Record each reviewed role's
-- effective permission before revoking PUBLIC, then restore exactly that set.
-- Receipt functions and unknown functions are never changed.
DO $$
DECLARE function_name text;
DECLARE role_names constant text[] := ARRAY['catalog_admin','catalog_import',
  'catalog_public_reader','catalog_receipt_maintenance'];
DECLARE before_exec boolean[];
DECLARE i integer;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'catalog_private.normalized_variant_attributes(jsonb)',
    'catalog_private.product_row_guard()',
    'catalog_private.variant_row_guard()',
    'catalog_private.category_guard()',
    'catalog_private.touch_updated_at()',
    'catalog_private.check_product_publication(uuid)',
    'catalog_private.enforce_product_publication()'] LOOP
    before_exec := ARRAY[]::boolean[];
    FOR i IN 1..array_length(role_names, 1) LOOP
      before_exec := array_append(before_exec,
        CASE WHEN to_regrole(role_names[i]) IS NULL THEN false
          ELSE has_function_privilege(role_names[i], to_regprocedure(function_name), 'EXECUTE') END);
    END LOOP;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', function_name);
    FOR i IN 1..array_length(role_names, 1) LOOP
      IF before_exec[i] THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', function_name, role_names[i]);
      END IF;
    END LOOP;
  END LOOP;
END $$;
-- PostgreSQL's global default PUBLIC EXECUTE cannot be undone by a per-schema
-- default REVOKE. Every later Catalog function migration must revoke PUBLIC
-- EXECUTE within its own transaction and grant only the required callers.

-- No grant on catalog_public, admin_private, rfq_private, import receipts or sequences.
-- Fail atomically if deployment defaults or pre-existing grants undermine this reader.
DO $$
DECLARE object_name text;
BEGIN
  IF has_database_privilege('catalog_admin_reader_runtime', current_database(), 'CREATE') OR
     has_database_privilege('catalog_admin_reader_runtime', current_database(), 'TEMP') OR
     has_schema_privilege('catalog_admin_reader_runtime', 'catalog_private', 'CREATE') OR
     has_schema_privilege('catalog_admin_reader_runtime', 'public', 'CREATE') OR
     EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
       WHERE r.rolname = 'catalog_admin_reader_runtime') THEN
    RAISE EXCEPTION 'Catalog reader has unexpected effective privileges';
  END IF;
  IF (to_regnamespace('rfq_private') IS NOT NULL AND
      has_schema_privilege('catalog_admin_reader_runtime', 'rfq_private', 'USAGE')) OR
     (to_regnamespace('admin_private') IS NOT NULL AND
      has_schema_privilege('catalog_admin_reader_runtime', 'admin_private', 'USAGE')) OR
     (to_regclass('catalog_private.catalog_import_receipts') IS NOT NULL AND
      has_table_privilege('catalog_admin_reader_runtime',
        'catalog_private.catalog_import_receipts', 'SELECT')) THEN
    RAISE EXCEPTION 'Catalog reader can access unrelated private data';
  END IF;
  FOREACH object_name IN ARRAY ARRAY['products','product_variants','categories',
    'product_categories','product_images','product_translations'] LOOP
    IF has_table_privilege('catalog_admin_reader_runtime',
         format('catalog_private.%I', object_name), 'INSERT') OR
       has_table_privilege('catalog_admin_reader_runtime',
         format('catalog_private.%I', object_name), 'UPDATE') OR
       has_table_privilege('catalog_admin_reader_runtime',
         format('catalog_private.%I', object_name), 'DELETE') OR
       has_table_privilege('catalog_admin_reader_runtime',
         format('catalog_private.%I', object_name), 'TRUNCATE') THEN
      RAISE EXCEPTION 'Catalog reader has unexpected table write privileges';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'catalog_private'
      AND has_function_privilege('catalog_admin_reader_runtime', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'Catalog reader can execute private functions';
  END IF;
END $$;

-- A future object's creator may differ from this migration owner; audit default
-- privileges for every creator before deployment. Never expose this role via Data API.
COMMIT;
