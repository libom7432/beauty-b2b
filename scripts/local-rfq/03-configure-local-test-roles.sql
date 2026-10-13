\set ON_ERROR_STOP on
-- Run as local mima0000 against rfq_integration_test after both Migrations.
-- Passwords are set separately, interactively; this file contains none.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rfq_api'
                 AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
                 AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
                 AND NOT rolinherit)
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rfq_test_auditor')
     OR EXISTS (SELECT 1 FROM pg_auth_members
                WHERE member = 'rfq_api'::regrole) THEN
    RAISE EXCEPTION 'unexpected RFQ role state';
  END IF;
  IF (SELECT count(*) FROM pg_class
      WHERE oid IN ('rfq_private.rfq_requests'::regclass,
                    'rfq_private.rfq_items'::regclass,
                    'rfq_private.rfq_notification_jobs'::regclass)
        AND relrowsecurity) <> 3 THEN
    RAISE EXCEPTION 'RFQ RLS is not enabled on all three tables';
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

-- Preserve the Migration's column grants and four RLS policies.
-- LOGIN is local-only; PASSWORD NULL remains unusable until interactive setup.
ALTER ROLE rfq_api LOGIN;
CREATE ROLE rfq_test_auditor LOGIN PASSWORD NULL NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE rfq_test_auditor SET search_path = pg_catalog;

-- PUBLIC has no rights on this dedicated database. Neither role gets CREATE
-- or TEMPORARY; neither role owns any object or receives role membership.
GRANT CONNECT ON DATABASE rfq_integration_test TO rfq_api, rfq_test_auditor;

GRANT USAGE ON SCHEMA rfq_private TO rfq_test_auditor;
-- The existing integration runner needs only the idempotency key and join keys
-- to count synthetic rows. No contact, requirement, snapshot, or job details.
GRANT SELECT (id, idempotency_key)
  ON rfq_private.rfq_requests TO rfq_test_auditor;
GRANT SELECT (rfq_request_id)
  ON rfq_private.rfq_items TO rfq_test_auditor;
GRANT SELECT (rfq_request_id)
  ON rfq_private.rfq_notification_jobs TO rfq_test_auditor;

CREATE POLICY rfq_test_auditor_read_requests ON rfq_private.rfq_requests
  FOR SELECT TO rfq_test_auditor USING (true);
CREATE POLICY rfq_test_auditor_read_items ON rfq_private.rfq_items
  FOR SELECT TO rfq_test_auditor USING (true);
CREATE POLICY rfq_test_auditor_read_jobs ON rfq_private.rfq_notification_jobs
  FOR SELECT TO rfq_test_auditor USING (true);
COMMIT;
