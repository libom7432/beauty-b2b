\set ON_ERROR_STOP on
-- Run as local mima0000 against rfq_integration_test.
-- Paths are relative to this script; the original Migration files are unchanged.
DO $preflight$
BEGIN
  IF current_user <> 'mima0000'
     OR current_database() <> 'rfq_integration_test'
     OR current_setting('server_version') NOT LIKE '17.11%'
     OR current_setting('data_directory') <> '/Users/mima0000/Library/Application Support/Postgres/var-17'
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR inet_server_port() <> 5432 THEN
    RAISE EXCEPTION 'not the approved local test database/administrator';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'rfq_private')
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('rfq_api', 'rfq_test_auditor')) THEN
    RAISE EXCEPTION 'RFQ schema or test roles already exist';
  END IF;
  IF (SELECT count(*) FROM pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'service_role') AND NOT rolcanlogin) <> 3 THEN
    RAISE EXCEPTION 'local-only Migration prerequisite roles are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_database d
    CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
    WHERE d.datname = current_database() AND a.grantee = 0
      AND a.privilege_type IN ('CONNECT', 'TEMPORARY', 'CREATE')
  ) THEN
    RAISE EXCEPTION 'test database grants privileges to PUBLIC';
  END IF;
END;
$preflight$;

\ir ../../supabase/migrations/20261010112952_create_rfq_schema.sql
\ir ../../supabase/migrations/20261011120000_grant_rfq_api_role.sql
