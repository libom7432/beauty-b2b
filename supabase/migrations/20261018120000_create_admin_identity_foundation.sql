-- A1: private administrator directory. This file does not provision an admin.
-- A separately reviewed infrastructure step creates the non-owner LOGIN role
-- admin_directory_runtime and grants it SET ROLE admin_directory_reader.
BEGIN;

CREATE SCHEMA admin_private;
REVOKE ALL ON SCHEMA admin_private FROM PUBLIC, anon, authenticated, service_role;

CREATE ROLE admin_directory_reader NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
ALTER ROLE admin_directory_reader SET search_path = pg_catalog;
GRANT USAGE ON SCHEMA admin_private TO admin_directory_reader;
CREATE ROLE admin_directory_provisioner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
ALTER ROLE admin_directory_provisioner SET search_path = pg_catalog;
GRANT USAGE ON SCHEMA admin_private TO admin_directory_provisioner;

CREATE TABLE admin_private.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'disabled' CHECK (status IN ('active', 'disabled')),
  role text NOT NULL CHECK (role IN ('super_admin', 'catalog_editor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz DEFAULT now(),
  CHECK ((status = 'disabled' AND disabled_at IS NOT NULL) OR
         (status = 'active' AND disabled_at IS NULL))
);
CREATE INDEX admin_users_status_idx ON admin_private.admin_users(status, id);

ALTER TABLE admin_private.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_private.admin_users FORCE ROW LEVEL SECURITY;
REVOKE ALL ON admin_private.admin_users FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id, auth_user_id, status, role, created_at, disabled_at)
  ON admin_private.admin_users TO admin_directory_reader;
CREATE POLICY admin_directory_reader_select ON admin_private.admin_users
  FOR SELECT TO admin_directory_reader USING (true);
GRANT SELECT, INSERT, UPDATE ON admin_private.admin_users TO admin_directory_provisioner;
CREATE POLICY admin_directory_provisioner_all ON admin_private.admin_users
  TO admin_directory_provisioner USING (true) WITH CHECK (true);

-- No write grants or policies for application roles. Bootstrap and role changes
-- require a separately approved trusted process with provisioner membership.
-- No SECURITY DEFINER function and no browser-visible RPC are created.
COMMIT;
