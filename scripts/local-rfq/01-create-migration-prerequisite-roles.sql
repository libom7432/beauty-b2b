\set ON_ERROR_STOP on
-- Run as local mima0000 against rfq_integration_test, before either Migration.
BEGIN;
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
  IF EXISTS (SELECT 1 FROM pg_roles
             WHERE rolname IN ('anon', 'authenticated', 'service_role',
                               'rfq_api', 'rfq_test_auditor'))
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'rfq_private') THEN
    RAISE EXCEPTION 'prerequisite roles or RFQ schema already exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_database d
    CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
    WHERE d.datname = current_database() AND a.grantee = 0
      AND a.privilege_type IN ('CONNECT', 'TEMPORARY', 'CREATE')
  ) THEN
    RAISE EXCEPTION 'test database still grants privileges to PUBLIC';
  END IF;
END;
$preflight$;

-- The unchanged schema Migration names these Supabase roles in REVOKE.
-- Local stand-ins have no login, password, membership, or object grants.
CREATE ROLE anon NOLOGIN PASSWORD NULL NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN PASSWORD NULL NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN PASSWORD NULL NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
COMMIT;
