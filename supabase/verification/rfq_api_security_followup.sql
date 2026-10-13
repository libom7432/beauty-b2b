-- Sprint 2.4.3-B1: read-only follow-up for PostgreSQL 17 / Supabase DEV.
-- Run as a privileged reviewer. Do not SET ROLE, call audited functions,
-- read Vault secrets or large-object contents, or change any privileges.
-- Inspect every row. ACCEPTABLE_DEFAULT describes only the stated evidence;
-- REVIEW_REQUIRED is not approval to enable LOGIN.

WITH target_role AS (
  SELECT oid, rolname FROM pg_roles WHERE rolname = 'rfq_api'
),
db_temp AS (
  SELECT d.datname, has_database_privilege(r.oid, d.oid, 'TEMPORARY') AS effective,
    EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
      WHERE a.grantee = 0 AND a.privilege_type = 'TEMPORARY'
    ) AS granted_to_public,
    EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
      WHERE a.grantee = r.oid AND a.privilege_type = 'TEMPORARY'
    ) AS granted_directly,
    has_database_privilege(r.oid, d.oid, 'CREATE') AS can_create_schema,
    d.datdba = r.oid AS database_owner
  FROM pg_database d CROSS JOIN target_role r
  WHERE d.datname = current_database()
),
lo_acl AS (
  SELECT m.oid AS loid, m.lomowner, p.privilege,
    EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(m.lomacl, acldefault('L', m.lomowner))) a
      LEFT JOIN pg_roles grantee ON grantee.oid = a.grantee
      CROSS JOIN target_role r
      WHERE a.privilege_type = p.privilege
        AND (a.grantee = 0 OR grantee.oid = r.oid
          OR (grantee.oid IS NOT NULL AND pg_has_role(r.oid, grantee.oid, 'USAGE')))
    ) AS effective
  FROM pg_largeobject_metadata m
  CROSS JOIN (VALUES ('SELECT'), ('UPDATE')) p(privilege)
),
lo_rights AS (
  SELECT loid, privilege AS capability, 'ACL'::text AS source
  FROM lo_acl WHERE effective
  UNION ALL
  SELECT m.oid, 'DELETE / OWNERSHIP', 'OWNER'
  FROM pg_largeobject_metadata m CROSS JOIN target_role r
  WHERE pg_has_role(r.oid, m.lomowner, 'USAGE')
),
lo_functions AS (
  SELECT p.oid, p.proname, format('%I.%I(%s)', n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid)) AS identity,
    p.prosecdef, has_function_privilege(r.oid, p.oid, 'EXECUTE') AS executable,
    has_schema_privilege(r.oid, n.oid, 'USAGE') AS schema_usable
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN target_role r
  WHERE n.nspname = 'pg_catalog'
    AND (left(p.proname, 3) = 'lo_'
      OR p.proname IN ('loread', 'lowrite', 'loimport', 'loexport'))
),
lo_compat_overrides AS (
  SELECT s.setdatabase, s.setrole, setting
  FROM pg_db_role_setting s CROSS JOIN target_role r
  CROSS JOIN LATERAL unnest(s.setconfig) AS cfg(setting)
  WHERE s.setdatabase IN (0, (SELECT oid FROM pg_database
                           WHERE datname = current_database()))
    AND s.setrole IN (0, r.oid)
    AND setting LIKE 'lo_compat_privileges=%'
),
extension_objects AS (
  SELECT e.extname, e.oid AS ext_oid, n.nspname AS installation_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname IN ('supabase_vault', 'pgcrypto', 'uuid-ossp',
                      'pg_stat_statements')
),
extension_functions AS (
  SELECT e.extname, p.oid,
    format('%I.%I(%s)', n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid)) AS identity,
    n.nspname, p.prosecdef, p.proconfig,
    pg_get_userbyid(p.proowner) AS owner_name,
    has_schema_privilege(r.oid, n.oid, 'USAGE') AS schema_usable,
    has_function_privilege(r.oid, p.oid, 'EXECUTE') AS executable,
    EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) AS public_execute
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN target_role r
  LEFT JOIN pg_depend dep ON dep.classid = 'pg_proc'::regclass
    AND dep.objid = p.oid AND dep.refclassid = 'pg_extension'::regclass
    AND dep.deptype = 'e'
  LEFT JOIN extension_objects member_ext ON member_ext.ext_oid = dep.refobjid
  LEFT JOIN extension_objects vault_ext
    ON vault_ext.extname = 'supabase_vault' AND n.nspname = 'vault'
  JOIN extension_objects e ON e.ext_oid = COALESCE(member_ext.ext_oid, vault_ext.ext_oid)
),
extension_relations AS (
  SELECT e.extname, c.oid,
    format('%I.%I', n.nspname, c.relname) AS identity,
    c.relkind, pg_get_userbyid(c.relowner) AS owner_name,
    has_schema_privilege(r.oid, n.oid, 'USAGE') AS schema_usable,
    p.privilege,
    has_table_privilege(r.oid, c.oid, p.privilege)
      OR CASE WHEN p.privilege = 'DELETE' THEN false ELSE EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          AND has_column_privilege(r.oid, c.oid, a.attnum, p.privilege)
      ) END AS granted
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN target_role r
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(privilege)
  LEFT JOIN pg_depend dep ON dep.classid = 'pg_class'::regclass
    AND dep.objid = c.oid AND dep.refclassid = 'pg_extension'::regclass
    AND dep.deptype = 'e'
  LEFT JOIN extension_objects member_ext ON member_ext.ext_oid = dep.refobjid
  LEFT JOIN extension_objects vault_ext
    ON vault_ext.extname = 'supabase_vault' AND n.nspname = 'vault'
  JOIN extension_objects e ON e.ext_oid = COALESCE(member_ext.ext_oid, vault_ext.ext_oid)
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
),
assessments AS (
  SELECT 'ROLE'::text AS area, 'rfq_api exists'::text AS object_name,
    CASE WHEN EXISTS (SELECT 1 FROM target_role)
      THEN 'ACCEPTABLE_DEFAULT' ELSE 'BLOCKED' END AS verdict,
    'Missing role makes every empty inventory inconclusive.'::text AS reason,
    jsonb_build_object('exists', EXISTS (SELECT 1 FROM target_role)) AS evidence
  UNION ALL
  SELECT 'TEMPORARY', datname,
    CASE WHEN can_create_schema THEN 'BLOCKED'
         WHEN effective THEN 'REVIEW_REQUIRED'
         ELSE 'ACCEPTABLE_DEFAULT' END,
    CASE WHEN can_create_schema THEN 'Database CREATE is outside the RFQ role boundary.'
         WHEN effective THEN 'TEMP permits session temporary tables and resource use; it does not grant persistent CREATE or RFQ table access.'
         ELSE 'No effective database TEMPORARY privilege.' END,
    jsonb_build_object('effective', effective, 'public_grant', granted_to_public,
      'direct_grant', granted_directly, 'database_owner', database_owner,
      'other_effective_source', effective AND NOT granted_to_public
        AND NOT granted_directly AND NOT database_owner,
      'database_create', can_create_schema)
  FROM db_temp
  UNION ALL
  SELECT 'LARGE_OBJECT_ACL', loid::text || ' ' || capability, 'BLOCKED',
    'Existing large-object read/write privilege or ownership exceeds RFQ insert-only scope.',
    jsonb_build_object('loid', loid, 'capability', capability, 'source', source)
  FROM lo_rights
  UNION ALL
  SELECT 'LARGE_OBJECT_ACL', 'existing objects with no effective rights',
    'ACCEPTABLE_DEFAULT',
    'ACL and ownership scan found no accessible existing large objects; function access is assessed separately.',
    jsonb_build_object('large_object_count',
      (SELECT count(*) FROM pg_largeobject_metadata))
  WHERE NOT EXISTS (SELECT 1 FROM lo_rights)
  UNION ALL
  SELECT 'LARGE_OBJECT_FUNCTION', identity,
    CASE WHEN executable AND schema_usable
                AND proname IN ('lo_import', 'lo_export', 'loimport', 'loexport')
           THEN 'BLOCKED'
         WHEN executable AND schema_usable THEN 'REVIEW_REQUIRED'
         ELSE 'ACCEPTABLE_DEFAULT' END,
    CASE WHEN executable AND schema_usable
                AND proname IN ('lo_import', 'lo_export', 'loimport', 'loexport')
           THEN 'Server-side import/export may access server files; resolve before LOGIN.'
         ELSE 'EXECUTE permits calling this function; it does not itself prove access to an existing large object.' END,
    jsonb_build_object('execute', executable, 'schema_usage', schema_usable,
      'security_definer', prosecdef)
  FROM lo_functions
  UNION ALL
  SELECT 'LARGE_OBJECT_CONFIGURATION', 'lo_compat_privileges',
    CASE WHEN current_setting('lo_compat_privileges') = 'on'
           OR EXISTS (SELECT 1 FROM lo_compat_overrides
                      WHERE lower(btrim(split_part(setting, '=', 2)))
                        IN ('on', 'true', '1', 'yes', 't', 'y'))
           OR EXISTS (SELECT 1 FROM target_role r
                      WHERE has_parameter_privilege(r.oid, 'lo_compat_privileges', 'SET'))
      THEN 'BLOCKED'
      WHEN EXISTS (SELECT 1 FROM lo_compat_overrides
                   WHERE lower(btrim(split_part(setting, '=', 2)))
                     NOT IN ('off', 'false', '0', 'no', 'f', 'n'))
        THEN 'REVIEW_REQUIRED'
      ELSE 'ACCEPTABLE_DEFAULT' END,
    'An enabled compatibility setting bypasses large-object ACL checks; review session, role/database defaults and SET permission.',
    jsonb_build_object('reviewer_session_value', current_setting('lo_compat_privileges'),
      'role_can_set', (SELECT has_parameter_privilege(r.oid,
        'lo_compat_privileges', 'SET') FROM target_role r),
      'matching_defaults', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'database_oid', setdatabase, 'role_oid', setrole, 'setting', setting))
        FROM lo_compat_overrides), '[]'::jsonb))
  UNION ALL
  SELECT 'EXTENSION_INSTALLED', extname, 'ACCEPTABLE_DEFAULT',
    'Installation alone grants no object access; inspect the separate function and relation rows.',
    jsonb_build_object('installation_schema', installation_schema)
  FROM extension_objects
  UNION ALL
  SELECT 'EXTENSION_FUNCTION', extname || ': ' || identity,
    CASE WHEN executable AND schema_usable AND extname = 'supabase_vault'
                AND prosecdef THEN 'BLOCKED'
         WHEN executable AND schema_usable THEN 'REVIEW_REQUIRED'
         ELSE 'ACCEPTABLE_DEFAULT' END,
    CASE WHEN executable AND schema_usable AND extname = 'supabase_vault'
                AND prosecdef THEN 'Reachable Vault SECURITY DEFINER function requires code-level clearance before LOGIN.'
         WHEN executable AND schema_usable THEN 'Reachable extension function needs capability review; metadata does not prove its body is safe.'
         ELSE 'Function is not callable by rfq_api with current schema/function grants.' END,
    jsonb_build_object('execute', executable, 'schema_usage', schema_usable,
      'public_execute', public_execute, 'security_definer', prosecdef,
      'owner', owner_name,
      'search_path_settings', COALESCE((SELECT jsonb_agg(cfg.setting)
        FROM unnest(proconfig) AS cfg(setting)
        WHERE cfg.setting LIKE 'search_path=%'), '[]'::jsonb))
  FROM extension_functions
  UNION ALL
  SELECT 'EXTENSION_RELATION', extname || ': ' || identity || ' ' || privilege,
    CASE WHEN schema_usable AND granted AND extname = 'supabase_vault'
                THEN 'BLOCKED'
         WHEN schema_usable AND granted THEN 'REVIEW_REQUIRED'
         ELSE 'ACCEPTABLE_DEFAULT' END,
    CASE WHEN schema_usable AND granted AND extname = 'supabase_vault'
                THEN 'Reachable Vault data object exceeds RFQ role scope; decrypted views are especially sensitive.'
         WHEN schema_usable AND granted THEN 'Reachable extension data object requires human review.'
         ELSE 'No effective access through both schema and relation/column grants.' END,
    jsonb_build_object('relation_kind', relkind, 'owner', owner_name,
      'schema_usage', schema_usable, 'granted', granted, 'privilege', privilege)
  FROM extension_relations
),
final_rows AS (
  SELECT area, object_name, verdict, reason, evidence FROM assessments
  UNION ALL
  SELECT 'OVERALL', 'RFQ_API_SECURITY_FOLLOWUP',
    CASE WHEN bool_or(verdict = 'BLOCKED') THEN 'BLOCKED'
         WHEN bool_or(verdict = 'REVIEW_REQUIRED') THEN 'REVIEW_REQUIRED'
         ELSE 'ACCEPTABLE_DEFAULT' END,
    'Review all rows; this read-only inventory cannot prove extension function behavior or future grants.',
    jsonb_build_object('blocked_count', count(*) FILTER (WHERE verdict = 'BLOCKED'),
      'review_count', count(*) FILTER (WHERE verdict = 'REVIEW_REQUIRED'),
      'assessed_count', count(*))
  FROM assessments
)
SELECT area, object_name, verdict, reason, evidence
FROM final_rows
ORDER BY CASE WHEN area = 'OVERALL' THEN 1 ELSE 0 END, area, object_name;
