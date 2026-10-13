-- Sprint 2.4.3-B1: READ-ONLY effective-privilege audit for rfq_api.
-- Run in the isolated DEV project as a privileged reviewer, separately from
-- rfq_api_permissions.sql. No SET ROLE, fixture data, GRANT, or REVOKE occurs.
-- Read BOTH the decision and the inventory. REVIEW_REQUIRED is never PASS.
-- PostgreSQL built-in pg_catalog execution is summarized; dangerous built-ins
-- and all installed-extension functions are listed individually.

WITH role_info AS (
  SELECT oid, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
         rolreplication, rolbypassrls, rolinherit
  FROM pg_roles WHERE rolname = 'rfq_api'
),
memberships AS (
  SELECT parent.rolname::text AS inherited_role
  FROM pg_auth_members m JOIN pg_roles parent ON parent.oid = m.roleid
  JOIN role_info r ON r.oid = m.member
),
database_rights AS (
  SELECT 'DATABASE'::text AS object_kind, d.datname::text AS object_name,
    p.privilege::text AS privilege,
    CASE WHEN EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
      WHERE a.grantee = 0 AND a.privilege_type = p.privilege
    ) THEN 'PUBLIC' ELSE 'DIRECT_OR_OTHER' END AS grant_origin,
    CASE WHEN p.privilege = 'CREATE' THEN 'PROHIBITED'
         WHEN p.privilege = 'TEMPORARY' THEN 'REVIEW_REQUIRED'
         ELSE 'PLATFORM_DEFAULT' END AS risk_class
  FROM pg_database d CROSS JOIN role_info r
  CROSS JOIN (VALUES ('CONNECT'), ('CREATE'), ('TEMPORARY')) p(privilege)
  WHERE d.datname = current_database()
    AND has_database_privilege(r.oid, d.oid, p.privilege)
),
schema_rights AS (
  SELECT 'SCHEMA'::text AS object_kind, n.nspname::text AS object_name,
    p.privilege::text AS privilege,
    CASE WHEN EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
      WHERE a.grantee = 0 AND a.privilege_type = p.privilege
    ) THEN 'PUBLIC' ELSE 'DIRECT_OR_OTHER' END AS grant_origin,
    CASE WHEN p.privilege = 'CREATE' THEN 'PROHIBITED'
         WHEN n.nspname = 'rfq_private' THEN 'EXPECTED_RFQ'
         WHEN n.nspname IN ('pg_catalog', 'information_schema', 'public') THEN 'PLATFORM_DEFAULT'
         ELSE 'REVIEW_REQUIRED' END AS risk_class
  FROM pg_namespace n CROSS JOIN role_info r
  CROSS JOIN (VALUES ('USAGE'), ('CREATE')) p(privilege)
  WHERE n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
    AND has_schema_privilege(r.oid, n.oid, p.privilege)
),
relation_rights AS (
  SELECT 'TABLE_OR_VIEW'::text AS object_kind,
    format('%I.%I%s', n.nspname, c.relname,
      COALESCE(' [extension ' || e.extname || ']', '')) AS object_name,
    p.privilege::text AS privilege,
    CASE WHEN EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
      WHERE a.grantee = 0 AND a.privilege_type = p.privilege
    ) THEN 'PUBLIC' ELSE 'DIRECT_OR_OTHER' END AS grant_origin,
    CASE WHEN n.nspname = 'rfq_private' AND c.relname = 'rfq_requests'
           AND p.privilege IN ('INSERT', 'SELECT')
           THEN 'EXPECTED_RFQ'
         WHEN n.nspname = 'rfq_private' AND c.relname IN
           ('rfq_items', 'rfq_notification_jobs') AND p.privilege = 'INSERT'
           THEN 'EXPECTED_RFQ'
         WHEN n.nspname = 'rfq_private' THEN 'PROHIBITED'
         ELSE 'REVIEW_REQUIRED' END AS risk_class
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN role_info r
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                     ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(privilege)
  LEFT JOIN pg_depend dep ON dep.classid = 'pg_class'::regclass
    AND dep.objid = c.oid AND dep.refclassid = 'pg_extension'::regclass
    AND dep.deptype = 'e'
  LEFT JOIN pg_extension e ON e.oid = dep.refobjid
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
    AND has_schema_privilege(r.oid, n.oid, 'USAGE')
    AND has_table_privilege(r.oid, c.oid, p.privilege)
),
column_rights AS (
  SELECT 'COLUMN'::text AS object_kind,
    format('%I.%I.%I', n.nspname, c.relname, a.attname) AS object_name,
    p.privilege::text AS privilege,
    CASE WHEN EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(a.attacl, '{}'::aclitem[])) acl
      WHERE acl.grantee = 0 AND acl.privilege_type = p.privilege
    ) OR EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
      WHERE acl.grantee = 0 AND acl.privilege_type = p.privilege
    ) THEN 'PUBLIC' ELSE 'DIRECT_OR_OTHER' END AS grant_origin,
    CASE
      WHEN n.nspname = 'rfq_private' AND c.relname = 'rfq_requests'
        AND ((p.privilege = 'SELECT' AND a.attname = ANY (ARRAY[
          'id', 'rfq_number', 'idempotency_key', 'request_fingerprint',
          'status', 'created_at'
        ])) OR (p.privilege = 'INSERT' AND a.attname = ANY (ARRAY[
          'rfq_number', 'idempotency_key', 'request_fingerprint',
          'full_name', 'email', 'company_name', 'country', 'whatsapp', 'website',
          'buyer_type', 'requirements', 'customization', 'purchase_timeline'
        ]))) THEN 'EXPECTED_RFQ'
      WHEN n.nspname = 'rfq_private' AND c.relname = 'rfq_items'
        AND p.privilege = 'INSERT' AND a.attname = ANY (ARRAY[
          'rfq_request_id', 'product_id', 'sku', 'quantity', 'product_snapshot'
        ]) THEN 'EXPECTED_RFQ'
      WHEN n.nspname = 'rfq_private' AND c.relname = 'rfq_notification_jobs'
        AND p.privilege = 'INSERT' AND a.attname = 'rfq_request_id'
        THEN 'EXPECTED_RFQ'
      WHEN n.nspname = 'rfq_private' THEN 'PROHIBITED'
      ELSE 'REVIEW_REQUIRED'
    END AS risk_class
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  CROSS JOIN role_info r
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(privilege)
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
    AND has_schema_privilege(r.oid, n.oid, 'USAGE')
    AND has_column_privilege(r.oid, c.oid, a.attnum, p.privilege)
),
sequence_rights AS (
  SELECT 'SEQUENCE'::text AS object_kind,
    format('%I.%I%s', n.nspname, c.relname,
      COALESCE(' [extension ' || e.extname || ']', '')) AS object_name,
    p.privilege::text AS privilege,
    CASE WHEN EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('s', c.relowner))) a
      WHERE a.grantee = 0 AND a.privilege_type = p.privilege
    ) THEN 'PUBLIC' ELSE 'DIRECT_OR_OTHER' END AS grant_origin,
    CASE WHEN n.nspname = 'rfq_private' THEN 'PROHIBITED'
         ELSE 'REVIEW_REQUIRED' END AS risk_class
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN role_info r
  CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) p(privilege)
  LEFT JOIN pg_depend dep ON dep.classid = 'pg_class'::regclass
    AND dep.objid = c.oid AND dep.refclassid = 'pg_extension'::regclass
    AND dep.deptype = 'e'
  LEFT JOIN pg_extension e ON e.oid = dep.refobjid
  WHERE c.relkind = 'S' AND n.nspname NOT LIKE 'pg_%'
    AND has_schema_privilege(r.oid, n.oid, 'USAGE')
    AND has_sequence_privilege(r.oid, c.oid, p.privilege)
),
large_object_rights AS (
  SELECT 'LARGE_OBJECT'::text AS object_kind, m.oid::text AS object_name,
    p.privilege::text AS privilege,
    CASE WHEN EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(m.lomacl, acldefault('L', m.lomowner))) a
      WHERE a.grantee = 0 AND a.privilege_type = p.privilege
    ) THEN 'PUBLIC' ELSE 'DIRECT_OR_OTHER' END AS grant_origin,
    'REVIEW_REQUIRED'::text AS risk_class
  FROM pg_largeobject_metadata m CROSS JOIN role_info r
  CROSS JOIN (VALUES ('SELECT'), ('UPDATE')) p(privilege)
  -- PostgreSQL 17 has no has_largeobject_privilege(). The effective ACL
  -- includes the default owner grant, PUBLIC, and usable role grants.
  WHERE EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(m.lomacl, acldefault('L', m.lomowner))) a
      LEFT JOIN pg_roles grantee ON grantee.oid = a.grantee
      WHERE a.privilege_type = p.privilege
        AND (a.grantee = 0 OR grantee.oid = r.oid
          OR (grantee.oid IS NOT NULL AND pg_has_role(r.oid, grantee.oid, 'USAGE')))
    )
),
function_rights AS (
  SELECT 'FUNCTION'::text AS object_kind,
    format('%I.%I(%s)%s', n.nspname, p.proname,
      pg_get_function_identity_arguments(p.oid),
      COALESCE(' [extension ' || e.extname || ']', '')) AS object_name,
    'EXECUTE'::text AS privilege,
    CASE WHEN EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN 'PUBLIC' ELSE 'DIRECT_OR_OTHER' END AS grant_origin,
    CASE WHEN n.nspname = 'rfq_private' THEN 'PROHIBITED'
         WHEN e.extname = 'plpgsql' AND n.nspname = 'pg_catalog'
           THEN 'PLATFORM_DEFAULT'
         ELSE 'REVIEW_REQUIRED' END AS risk_class
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN role_info r
  LEFT JOIN pg_depend dep ON dep.classid = 'pg_proc'::regclass
    AND dep.objid = p.oid AND dep.refclassid = 'pg_extension'::regclass
    AND dep.deptype = 'e'
  LEFT JOIN pg_extension e ON e.oid = dep.refobjid
  WHERE has_function_privilege(r.oid, p.oid, 'EXECUTE')
    AND has_schema_privilege(r.oid, n.oid, 'USAGE')
    AND (n.nspname NOT IN ('pg_catalog', 'information_schema')
      OR e.oid IS NOT NULL
      OR p.proname ~ '^lo_'
      OR p.proname IN ('loread', 'lowrite', 'pg_read_file',
        'pg_read_binary_file', 'pg_ls_dir'))
),
inventory AS (
  SELECT * FROM database_rights UNION ALL SELECT * FROM schema_rights
  UNION ALL SELECT * FROM relation_rights UNION ALL SELECT * FROM column_rights
  UNION ALL SELECT * FROM sequence_rights UNION ALL SELECT * FROM large_object_rights
  UNION ALL SELECT * FROM function_rights
),
facts AS (
  SELECT
    NOT EXISTS (SELECT 1 FROM role_info) AS role_missing,
    EXISTS (SELECT 1 FROM role_info WHERE rolsuper OR rolcreatedb OR rolcreaterole
      OR rolreplication OR rolbypassrls OR rolinherit) AS dangerous_attribute,
    EXISTS (SELECT 1 FROM memberships) AS unexpected_membership,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN role_info r WHERE n.nspname = 'rfq_private' AND c.relowner = r.oid)
      AS owns_rfq_object,
    EXISTS (SELECT 1 FROM inventory WHERE risk_class = 'PROHIBITED') AS prohibited_right,
    EXISTS (SELECT 1 FROM inventory WHERE risk_class = 'REVIEW_REQUIRED') AS review_right,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql') AS extension_review,
    EXISTS (SELECT 1 FROM role_info WHERE rolcanlogin) AS login_enabled
)
SELECT 'ROLE_SECURITY_AUDIT' AS audit_name,
  CASE WHEN role_missing OR dangerous_attribute OR unexpected_membership
       OR owns_rfq_object OR prohibited_right THEN 'FAIL'
       WHEN review_right OR extension_review OR login_enabled THEN 'REVIEW_REQUIRED'
       ELSE 'PASS' END AS result,
  jsonb_build_object(
    'login_enabled', login_enabled,
    'dangerous_role_attribute', dangerous_attribute,
    'role_memberships', COALESCE((SELECT jsonb_agg(inherited_role ORDER BY inherited_role)
      FROM memberships), '[]'::jsonb),
    'owns_rfq_object', owns_rfq_object,
    'prohibited_effective_right', prohibited_right,
    'review_required_right', review_right,
    'installed_extension_review', extension_review,
    'installed_extensions', COALESCE((SELECT jsonb_agg(extname ORDER BY extname)
      FROM pg_extension), '[]'::jsonb),
    'effective_rights', COALESCE((SELECT jsonb_agg(to_jsonb(i)
      ORDER BY i.risk_class, i.object_kind, i.object_name, i.privilege)
      FROM inventory i), '[]'::jsonb),
    'pg_catalog_builtin_execute_count', (SELECT count(*) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace CROSS JOIN role_info r
      WHERE n.nspname = 'pg_catalog'
        AND has_function_privilege(r.oid, p.oid, 'EXECUTE')),
    'pg_catalog_table_select_count', (SELECT count(*) FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN role_info r
      WHERE n.nspname = 'pg_catalog' AND c.relkind IN ('r', 'v', 'm')
        AND has_table_privilege(r.oid, c.oid, 'SELECT'))
  ) AS details
FROM facts;
