-- Catalog Public reader for the server-side RFQ lookup.
-- Depends on 20261013120000_create_catalog_foundation.sql only. Admin migrations
-- are not prerequisites. Apply this file explicitly after the three approved
-- RFQ/Catalog migrations; do not use an unfiltered db push on a fresh project.
-- A separate, approved operation must provision a server login and TLS connection.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('catalog_public.products') IS NULL
     OR to_regclass('catalog_public.product_variants') IS NULL
     OR to_regclass('catalog_public.product_translations') IS NULL THEN
    RAISE EXCEPTION 'Catalog Foundation public views are required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_database d, aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
    WHERE d.datname = current_database() AND a.grantee = 0 AND a.privilege_type = 'CREATE'
  ) OR EXISTS (
    SELECT 1 FROM pg_namespace n, aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
    WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'
  ) THEN
    RAISE EXCEPTION 'Unexpected PUBLIC persistent CREATE privilege';
  END IF;
END;
$preflight$;

CREATE ROLE rfq_catalog_public_reader_runtime NOLOGIN PASSWORD NULL NOINHERIT
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Database name is an identifier, so quote the current target explicitly.
DO $grant_connect$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO rfq_catalog_public_reader_runtime', current_database());
END;
$grant_connect$;

GRANT USAGE ON SCHEMA catalog_public TO rfq_catalog_public_reader_runtime;
GRANT SELECT (id, slug) ON catalog_public.products TO rfq_catalog_public_reader_runtime;
GRANT SELECT (id, product_id, sku, attributes, moq_quantity, moq_unit)
  ON catalog_public.product_variants TO rfq_catalog_public_reader_runtime;
GRANT SELECT (product_id, locale, name)
  ON catalog_public.product_translations TO rfq_catalog_public_reader_runtime;

DO $audit$
DECLARE
  v_role oid := 'rfq_catalog_public_reader_runtime'::regrole::oid;
  v_schema oid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE oid = v_role AND
      (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication
       OR rolbypassrls OR rolinherit)
  ) OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = v_role OR roleid = v_role) THEN
    RAISE EXCEPTION 'Runtime reader has unexpected role attributes or membership';
  END IF;
  IF NOT has_database_privilege(v_role, current_database(), 'CONNECT')
     OR has_database_privilege(v_role, current_database(), 'CREATE')
     OR NOT has_schema_privilege(v_role, 'catalog_public', 'USAGE')
     OR has_schema_privilege(v_role, 'catalog_private', 'USAGE') THEN
    RAISE EXCEPTION 'Runtime reader database or schema privilege mismatch';
  END IF;
  IF to_regnamespace('rfq_private') IS NOT NULL
     AND has_schema_privilege(v_role, 'rfq_private', 'USAGE') THEN
    RAISE EXCEPTION 'Runtime reader can use RFQ private schema';
  END IF;
  FOR v_schema IN SELECT oid FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'
  LOOP
    IF has_schema_privilege(v_role, v_schema, 'CREATE') THEN
      RAISE EXCEPTION 'Runtime reader has persistent schema CREATE';
    END IF;
  END LOOP;
  IF has_table_privilege(v_role, 'catalog_public.products', 'SELECT')
     OR has_table_privilege(v_role, 'catalog_public.product_variants', 'SELECT')
     OR has_table_privilege(v_role, 'catalog_public.product_translations', 'SELECT')
     OR NOT has_column_privilege(v_role, 'catalog_public.products', 'id', 'SELECT')
     OR NOT has_column_privilege(v_role, 'catalog_public.products', 'slug', 'SELECT')
     OR NOT has_column_privilege(v_role, 'catalog_public.product_variants', 'moq_quantity', 'SELECT')
     OR NOT has_column_privilege(v_role, 'catalog_public.product_translations', 'name', 'SELECT')
     OR has_column_privilege(v_role, 'catalog_public.products', 'product_code', 'SELECT') THEN
    RAISE EXCEPTION 'Runtime reader public view column grants mismatch';
  END IF;
END;
$audit$;

COMMIT;
