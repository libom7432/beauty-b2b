\set ON_ERROR_STOP on
-- Run as mima0000 against local postgres on 127.0.0.1:5432.
-- CREATE DATABASE cannot be inside a transaction. A second run fails closed.
DO $preflight$
BEGIN
  IF current_user <> 'mima0000'
     OR current_database() <> 'postgres'
     OR current_setting('server_version') NOT LIKE '17.11%'
     OR current_setting('data_directory') <> '/Users/mima0000/Library/Application Support/Postgres/var-17'
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR inet_server_port() <> 5432 THEN
    RAISE EXCEPTION 'not the approved local PostgreSQL administrator/instance';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user
                 AND rolsuper AND rolcreatedb AND rolcreaterole) THEN
    RAISE EXCEPTION 'administrator lacks required local initialization privileges';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = 'rfq_integration_test') THEN
    RAISE EXCEPTION 'target test database already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database
             WHERE datname NOT IN ('postgres', 'template0', 'template1')) THEN
    RAISE EXCEPTION 'another non-system database exists in this cluster';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles
             WHERE rolname IN ('anon', 'authenticated', 'service_role',
                               'rfq_api', 'rfq_test_auditor')) THEN
    RAISE EXCEPTION 'a migration or test role already exists';
  END IF;
END;
$preflight$;

CREATE DATABASE rfq_integration_test TEMPLATE template0 ALLOW_CONNECTIONS false;
-- PostgreSQL normally gives PUBLIC CONNECT and TEMPORARY on a new database.
-- Change only the newly created dedicated test database.
REVOKE ALL ON DATABASE rfq_integration_test FROM PUBLIC;
ALTER DATABASE rfq_integration_test ALLOW_CONNECTIONS true;
