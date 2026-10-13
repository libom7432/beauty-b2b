-- Sprint 2.4.3-B1: private, insert-only RFQ API role.
-- Apply only after 20261010112952_create_rfq_schema.sql.
-- No credential is stored here. Keep the role NOLOGIN until its password is
-- provisioned out of band and the permission acceptance script passes.
BEGIN;

CREATE ROLE rfq_api NOLOGIN PASSWORD NULL NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Application SQL must qualify rfq_private objects. This is defense in depth,
-- not a substitute for grants or parameterized queries.
ALTER ROLE rfq_api SET search_path = pg_catalog;

GRANT USAGE ON SCHEMA rfq_private TO rfq_api;

-- The API supplies only these request fields. UUID, status and timestamps use
-- database defaults. The role cannot insert an arbitrary status or ID.
GRANT INSERT (
  rfq_number, idempotency_key, request_fingerprint,
  full_name, email, company_name, country, whatsapp, website,
  buyer_type, requirements, customization, purchase_timeline
) ON rfq_private.rfq_requests TO rfq_api;

-- INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING ... needs
-- SELECT on the arbiter and RETURNING columns. A subsequent replay lookup
-- needs the same columns. Do not grant SELECT on contact or requirements.
GRANT SELECT (
  id, rfq_number, idempotency_key, request_fingerprint, status, created_at
) ON rfq_private.rfq_requests TO rfq_api;

GRANT INSERT (
  rfq_request_id, product_id, sku, quantity, product_snapshot
) ON rfq_private.rfq_items TO rfq_api;

-- Defaults create a pending notification job. The API cannot alter its state.
GRANT INSERT (rfq_request_id)
  ON rfq_private.rfq_notification_jobs TO rfq_api;

-- RLS remains enabled. INSERT/SELECT are separate and limited to this role.
-- The SELECT policy covers rows only; column grants still deny buyer details.
CREATE POLICY rfq_api_insert_requests ON rfq_private.rfq_requests
  FOR INSERT TO rfq_api WITH CHECK (true);
CREATE POLICY rfq_api_select_request_metadata ON rfq_private.rfq_requests
  FOR SELECT TO rfq_api USING (true);
CREATE POLICY rfq_api_insert_items ON rfq_private.rfq_items
  FOR INSERT TO rfq_api WITH CHECK (true);
CREATE POLICY rfq_api_insert_notification_jobs ON rfq_private.rfq_notification_jobs
  FOR INSERT TO rfq_api WITH CHECK (true);

-- Fail deployment if this role unexpectedly acquired powerful membership,
-- owner status, database/schema CREATE, or RLS bypass. PUBLIC grants are
-- effective even with NOINHERIT; do not silently change project-wide grants.
DO $audit$
DECLARE
  v_role oid := 'rfq_api'::regrole::oid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE oid = v_role AND (rolsuper OR rolcreatedb OR rolcreaterole
      OR rolreplication OR rolbypassrls OR rolinherit OR rolcanlogin)
  ) THEN
    RAISE EXCEPTION 'rfq_api has an unexpected role attribute';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = v_role)
     OR EXISTS (
       SELECT 1 FROM pg_class
       WHERE oid IN (
         'rfq_private.rfq_requests'::regclass,
         'rfq_private.rfq_items'::regclass,
         'rfq_private.rfq_notification_jobs'::regclass
       ) AND relowner = v_role
     ) THEN
    RAISE EXCEPTION 'rfq_api must have no role membership or RFQ table ownership';
  END IF;
  IF has_database_privilege(v_role, current_database(), 'CREATE')
     OR EXISTS (
       SELECT 1 FROM pg_namespace
       WHERE nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'
         AND has_schema_privilege(v_role, oid, 'CREATE')
     ) THEN
    RAISE EXCEPTION 'rfq_api has effective persistent-object CREATE privilege; inspect PUBLIC grants';
  END IF;
END;
$audit$;

COMMIT;
