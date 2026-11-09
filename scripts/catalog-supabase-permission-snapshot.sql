-- A6 Scheme B metadata-only snapshot candidate; local implementation, NOT approved for execution.
-- Project Ref and execution provenance require independent SQL Editor evidence outside this SQL.
-- The UTC statement timestamp and database/session identity below are self-reported metadata only.
-- No business rows, password hashes, connection strings or function bodies are selected.
WITH
expected_relations(schema_name, object_name, object_kind) AS (
  VALUES
    ('catalog_private','products','table'),
    ('catalog_private','product_variants','table'),
    ('catalog_private','categories','table'),
    ('catalog_private','product_categories','table'),
    ('catalog_private','product_images','table'),
    ('catalog_private','product_translations','table'),
    ('catalog_private','catalog_import_receipts','optional_table'),
    ('admin_private','admin_users','optional_table'),
    ('catalog_public','products','view'),
    ('catalog_public','product_variants','view'),
    ('catalog_public','categories','view'),
    ('catalog_public','product_categories','view'),
    ('catalog_public','product_images','view'),
    ('catalog_public','product_translations','view')
),
subjects(role_name) AS (
  VALUES ('catalog_admin_reader_runtime'),('catalog_admin'),('catalog_import'),
    ('catalog_public_reader'),('catalog_receipt_maintenance'),('anon'),
    ('authenticated'),('service_role')
),
audit_subjects AS (
  SELECT r.rolname AS role_name,r.oid AS role_oid
  FROM pg_catalog.pg_roles r
  UNION ALL
  SELECT s.role_name,NULL::oid
  FROM subjects s
  WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=s.role_name)
),
relations AS (
  SELECT e.*, c.oid, c.relkind, c.relowner, c.relacl, c.relrowsecurity,
    c.relforcerowsecurity
  FROM expected_relations e
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=e.schema_name
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.object_name
),
schemas AS (
  SELECT x.schema_name, n.oid, n.nspowner, n.nspacl
  FROM (SELECT v.schema_name FROM (VALUES ('catalog_private'),('catalog_public'),
    ('rfq_private'),('admin_private'),('public'),('supabase_migrations')) v(schema_name)
    UNION SELECT n.nspname FROM pg_catalog.pg_namespace n
    WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
      AND n.nspname <> 'information_schema') x(schema_name)
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=x.schema_name
),
private_functions AS (
  SELECT p.*, n.nspname,
    pg_catalog.format('%I.%I(%s)',n.nspname,p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)) AS signature
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='catalog_private'
),
rows AS (
  SELECT 'database'::text section, pg_catalog.current_database()::text item,
    pg_catalog.jsonb_build_object('name',pg_catalog.current_database(),
      'server_version',pg_catalog.current_setting('server_version'),
      'database_oid',d.oid::text,
      'current_user',CURRENT_USER::text,'session_user',SESSION_USER::text,
      'captured_at_utc',pg_catalog.to_char(pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'owner',pg_catalog.pg_get_userbyid(d.datdba),
      'owner_oid',d.datdba::text,
      'encoding',pg_catalog.pg_encoding_to_char(d.encoding)) data
  FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database()
  UNION ALL
  SELECT 'business_inventory','catalog-rfq-admin-prefixes',
    pg_catalog.jsonb_build_object('complete',true)
  UNION ALL
  SELECT 'permission_inventory','database-acl-and-membership',
    pg_catalog.jsonb_build_object('complete',true,
      'membership_count',(SELECT pg_catalog.count(*) FROM pg_catalog.pg_auth_members),
      'database_acl_count',(SELECT pg_catalog.count(*) FROM pg_catalog.pg_database d,
        LATERAL pg_catalog.aclexplode(COALESCE(d.datacl,
          pg_catalog.acldefault('d',d.datdba))) a
        WHERE d.datname=pg_catalog.current_database()),
      'public_schema_acl_count',(SELECT pg_catalog.count(*) FROM pg_catalog.pg_namespace n,
        LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl,
          pg_catalog.acldefault('n',n.nspowner))) a
        WHERE n.nspname='public'))
  UNION ALL
  SELECT 'business_object','schema:'||n.nspname,
    pg_catalog.jsonb_build_object('kind','schema')
  FROM pg_catalog.pg_namespace n
  WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND
    n.nspname NOT IN ('information_schema','public','auth','storage','extensions',
      'graphql','graphql_public','realtime','vault','supabase_migrations',
      'supabase_functions','net','cron','_analytics','_realtime')
  UNION ALL
  SELECT 'business_object','relation:'||n.nspname||'.'||c.relname,
    pg_catalog.jsonb_build_object('kind','relation','actual_kind',c.relkind)
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','v','m','p','f','S') AND
    (n.nspname LIKE 'catalog\_%' ESCAPE '\' OR n.nspname LIKE 'rfq\_%' ESCAPE '\'
    OR n.nspname LIKE 'admin\_%' ESCAPE '\' OR n.nspname = 'public')
    AND (n.nspname <> 'public' OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
      WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
        AND d.objid = c.oid AND d.deptype = 'e'))
  UNION ALL
  SELECT 'business_object','function:'||pg_catalog.format('%I.%I(%s)',n.nspname,p.proname,
      pg_catalog.oidvectortypes(p.proargtypes)),
    pg_catalog.jsonb_build_object('kind','function')
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname LIKE 'catalog\_%' ESCAPE '\' OR n.nspname LIKE 'rfq\_%' ESCAPE '\'
    OR n.nspname LIKE 'admin\_%' ESCAPE '\' OR
      (n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
        WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
          AND d.objid = p.oid AND d.deptype = 'e'))
  UNION ALL
  SELECT 'migration_registry', 'supabase_migrations.schema_migrations',
    pg_catalog.jsonb_build_object('exists',
      pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL)
  UNION ALL
  SELECT 'schema',s.schema_name,
    pg_catalog.jsonb_build_object('exists',s.oid IS NOT NULL,
      'schema_oid',s.oid::text,'owner_oid',s.nspowner::text,
      'owner',CASE WHEN s.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_userbyid(s.nspowner) END)
  FROM schemas s
  UNION ALL
  SELECT 'relation',r.schema_name||'.'||r.object_name,
    pg_catalog.jsonb_build_object('expected_kind',r.object_kind,'exists',r.oid IS NOT NULL,
      'actual_kind',r.relkind,'owner',CASE WHEN r.oid IS NULL THEN NULL
        ELSE pg_catalog.pg_get_userbyid(r.relowner) END,
      'rls_enabled',r.relrowsecurity,'rls_forced',r.relforcerowsecurity,
      'options',CASE WHEN r.oid IS NULL THEN NULL ELSE
        (SELECT pg_catalog.to_jsonb(c.reloptions) FROM pg_catalog.pg_class c WHERE c.oid=r.oid) END,
      'columns',CASE WHEN r.relkind NOT IN ('v','r') THEN NULL ELSE
        (SELECT pg_catalog.jsonb_agg(a.attname ORDER BY a.attnum)
          FROM pg_catalog.pg_attribute a WHERE a.attrelid=r.oid
            AND a.attnum>0 AND NOT a.attisdropped) END,
      'view_definition_md5',CASE WHEN r.relkind='v' THEN
        pg_catalog.md5(pg_catalog.pg_get_viewdef(r.oid,true)) ELSE NULL END,
      'view_mentions_published',CASE WHEN r.relkind='v' THEN
        pg_catalog.strpos(pg_catalog.pg_get_viewdef(r.oid,true),'published')>0 ELSE NULL END,
      'view_mentions_storage_key',CASE WHEN r.relkind='v' THEN
        pg_catalog.strpos(pg_catalog.pg_get_viewdef(r.oid,true),'storage_key')>0 ELSE NULL END)
  FROM relations r
  UNION ALL
  SELECT 'policy',n.nspname||'.'||c.relname||'.'||p.polname,
    pg_catalog.jsonb_build_object('command',p.polcmd,
      'permissive',p.polpermissive,
      'roles',(SELECT pg_catalog.jsonb_agg(CASE WHEN role_oid=0 THEN 'PUBLIC'
        ELSE (SELECT rolname FROM pg_catalog.pg_roles WHERE oid=role_oid) END ORDER BY role_oid)
        FROM pg_catalog.unnest(p.polroles) role_oid),
      'using_true',pg_catalog.pg_get_expr(p.polqual,p.polrelid)='true',
      'using_mentions_published',pg_catalog.strpos(COALESCE(
        pg_catalog.pg_get_expr(p.polqual,p.polrelid),''),'published')>0,
      'check_true',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)='true',
      'using_md5',pg_catalog.md5(COALESCE(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'')),
      'check_md5',pg_catalog.md5(COALESCE(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),'')))
  FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('catalog_private','catalog_public','rfq_private','admin_private')
  UNION ALL
  SELECT 'role',r.rolname,
    pg_catalog.jsonb_build_object('role_name',r.rolname,'role_oid',r.oid::text,
      'connection_limit',r.rolconnlimit,
      'login',r.rolcanlogin,'inherit',r.rolinherit,
      'superuser',r.rolsuper,'bypass_rls',r.rolbypassrls,
      'create_db',r.rolcreatedb,'create_role',r.rolcreaterole,
      'replication',r.rolreplication)
  FROM pg_catalog.pg_roles r
  UNION ALL
  SELECT 'membership',m.oid::text,
    pg_catalog.jsonb_build_object('membership_oid',m.oid::text,
      'member',member.rolname,'member_oid',m.member::text,
      'parent',parent.rolname,'parent_oid',m.roleid::text,
      'grantor',grantor.rolname,'grantor_oid',m.grantor::text,
      'member_name_resolved',member.oid IS NOT NULL,
      'parent_name_resolved',parent.oid IS NOT NULL,
      'grantor_name_resolved',grantor.oid IS NOT NULL,
      'admin_option',m.admin_option,'inherit_option',m.inherit_option,
      'set_option',m.set_option)
  FROM pg_catalog.pg_auth_members m
  LEFT JOIN pg_catalog.pg_roles member ON member.oid=m.member
  LEFT JOIN pg_catalog.pg_roles parent ON parent.oid=m.roleid
  LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=m.grantor
  UNION ALL
  SELECT 'database_acl_state',d.oid::text,
    pg_catalog.jsonb_build_object('database',d.datname,'database_oid',d.oid::text,
      'owner_oid',d.datdba::text,'acl_is_null',d.datacl IS NULL,
      'acl_source',CASE WHEN d.datacl IS NULL THEN 'BUILTIN_DEFAULT' ELSE 'EXPLICIT' END,
      'explicit_acl_entry_count',(SELECT pg_catalog.count(*) FROM pg_catalog.aclexplode(d.datacl)))
  FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database()
  UNION ALL
  SELECT 'database_acl',d.oid::text||':'||a.grantee::text||':'||
      a.grantor::text||':'||a.privilege_type,
    pg_catalog.jsonb_build_object('database',d.datname,'database_oid',d.oid::text,
      'owner',pg_catalog.pg_get_userbyid(d.datdba),'owner_oid',d.datdba::text,
      'acl_source',CASE WHEN d.datacl IS NULL THEN 'BUILTIN_DEFAULT' ELSE 'EXPLICIT' END,
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,
      'grantee_oid',a.grantee::text,'grantor',grantor.rolname,
      'grantor_oid',a.grantor::text,'privilege',a.privilege_type,
      'grantable',a.is_grantable)
  FROM pg_catalog.pg_database d,
    LATERAL pg_catalog.aclexplode(COALESCE(d.datacl,
      pg_catalog.acldefault('d',d.datdba))) a
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=a.grantee
  LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=a.grantor
  WHERE d.datname=pg_catalog.current_database()
  UNION ALL
  SELECT 'database_builtin_acl',d.oid::text||':'||a.grantee::text||':'||
      a.grantor::text||':'||a.privilege_type,
    pg_catalog.jsonb_build_object('database',d.datname,'database_oid',d.oid::text,
      'acl_source','BUILTIN_REFERENCE','grantee',CASE WHEN a.grantee=0
        THEN 'PUBLIC' ELSE grantee.rolname END,'grantee_oid',a.grantee::text,
      'grantor',grantor.rolname,'grantor_oid',a.grantor::text,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
  FROM pg_catalog.pg_database d,
    LATERAL pg_catalog.aclexplode(pg_catalog.acldefault('d',d.datdba)) a
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=a.grantee
  LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=a.grantor
  WHERE d.datname=pg_catalog.current_database()
  UNION ALL
  SELECT 'public_database_privilege',d.oid::text,
    pg_catalog.jsonb_build_object('database',d.datname,'database_oid',d.oid::text,
      'acl_source',CASE WHEN d.datacl IS NULL THEN 'BUILTIN_DEFAULT' ELSE 'EXPLICIT' END,
      'connect',EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(d.datacl,
        pg_catalog.acldefault('d',d.datdba))) a WHERE a.grantee=0 AND a.privilege_type='CONNECT'),
      'create',EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(d.datacl,
        pg_catalog.acldefault('d',d.datdba))) a WHERE a.grantee=0 AND a.privilege_type='CREATE'),
      'temp',EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(d.datacl,
        pg_catalog.acldefault('d',d.datdba))) a WHERE a.grantee=0 AND a.privilege_type='TEMPORARY'))
  FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database()
  UNION ALL
  SELECT 'schema_acl_state',s.schema_name,
    pg_catalog.jsonb_build_object('schema',s.schema_name,'schema_oid',s.oid::text,
      'exists',s.oid IS NOT NULL,'owner_oid',s.nspowner::text,
      'acl_is_null',CASE WHEN s.oid IS NULL THEN NULL ELSE s.nspacl IS NULL END,
      'acl_source',CASE WHEN s.oid IS NULL THEN 'ABSENT'
        WHEN s.nspacl IS NULL THEN 'BUILTIN_DEFAULT' ELSE 'EXPLICIT' END,
      'explicit_acl_entry_count',CASE WHEN s.oid IS NULL THEN NULL ELSE
        (SELECT pg_catalog.count(*) FROM pg_catalog.aclexplode(s.nspacl)) END)
  FROM schemas s
  UNION ALL
  SELECT 'schema_acl',s.oid::text||':'||a.grantee::text||':'||
      a.grantor::text||':'||a.privilege_type,
    pg_catalog.jsonb_build_object('schema',s.schema_name,'schema_oid',s.oid::text,
      'owner',pg_catalog.pg_get_userbyid(s.nspowner),'owner_oid',s.nspowner::text,
      'acl_source',CASE WHEN s.nspacl IS NULL THEN 'BUILTIN_DEFAULT' ELSE 'EXPLICIT' END,
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,
      'grantee_oid',a.grantee::text,'grantor',grantor.rolname,
      'grantor_oid',a.grantor::text,'privilege',a.privilege_type,
      'grantable',a.is_grantable)
  FROM schemas s,
    LATERAL pg_catalog.aclexplode(COALESCE(s.nspacl,
      pg_catalog.acldefault('n',s.nspowner))) a
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=a.grantee
  LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=a.grantor
  WHERE s.oid IS NOT NULL
  UNION ALL
  SELECT 'schema_builtin_acl',s.oid::text||':'||a.grantee::text||':'||
      a.grantor::text||':'||a.privilege_type,
    pg_catalog.jsonb_build_object('schema',s.schema_name,'schema_oid',s.oid::text,
      'acl_source','BUILTIN_REFERENCE','grantee',CASE WHEN a.grantee=0
        THEN 'PUBLIC' ELSE grantee.rolname END,'grantee_oid',a.grantee::text,
      'grantor',grantor.rolname,'grantor_oid',a.grantor::text,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
  FROM schemas s,
    LATERAL pg_catalog.aclexplode(pg_catalog.acldefault('n',s.nspowner)) a
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=a.grantee
  LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=a.grantor
  WHERE s.oid IS NOT NULL
  UNION ALL
  SELECT 'public_schema_privilege',s.schema_name,
    pg_catalog.jsonb_build_object('schema',s.schema_name,'schema_oid',s.oid::text,
      'exists',s.oid IS NOT NULL,
      'acl_source',CASE WHEN s.oid IS NULL THEN 'ABSENT'
        WHEN s.nspacl IS NULL THEN 'BUILTIN_DEFAULT' ELSE 'EXPLICIT' END,
      'usage',CASE WHEN s.oid IS NULL THEN NULL ELSE EXISTS
        (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(s.nspacl,
          pg_catalog.acldefault('n',s.nspowner))) a
          WHERE a.grantee=0 AND a.privilege_type='USAGE') END,
      'create',CASE WHEN s.oid IS NULL THEN NULL ELSE EXISTS
        (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(s.nspacl,
          pg_catalog.acldefault('n',s.nspowner))) a
          WHERE a.grantee=0 AND a.privilege_type='CREATE') END)
  FROM schemas s
  UNION ALL
  SELECT 'relation_acl',r.oid::text||':'||a.grantee::text||':'||
    a.grantor::text||':'||a.privilege_type,
    pg_catalog.jsonb_build_object('relation',r.schema_name||'.'||r.object_name,
      'relation_oid',r.oid::text,
      'acl_source',CASE WHEN r.relacl IS NULL THEN 'BUILTIN_DEFAULT' ELSE 'EXPLICIT' END,
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,
      'grantee_oid',a.grantee::text,'grantor',grantor.rolname,
      'grantor_oid',a.grantor::text,'privilege',a.privilege_type,
      'grantable',a.is_grantable)
  FROM relations r,
    LATERAL pg_catalog.aclexplode(COALESCE(r.relacl,
      pg_catalog.acldefault((CASE WHEN r.relkind='S' THEN 's' ELSE 'r' END)::"char",r.relowner))) a
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=a.grantee
  LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=a.grantor
  WHERE r.oid IS NOT NULL
  UNION ALL
  SELECT 'default_acl_state',pg_catalog.current_database(),
    pg_catalog.jsonb_build_object('explicit_default_acl_record_count',
      (SELECT pg_catalog.count(*) FROM pg_catalog.pg_default_acl),
      'explicit_default_acl_entry_count',
      (SELECT pg_catalog.count(*) FROM pg_catalog.pg_default_acl d
        CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a),
      'zero_entries_mean_builtin_rules_still_apply',true)
  UNION ALL
  SELECT 'default_acl',d.oid::text||':'||a.grantee::text||':'||
    a.grantor::text||':'||a.privilege_type,
    pg_catalog.jsonb_build_object('default_acl_oid',d.oid::text,
      'creator',pg_catalog.pg_get_userbyid(d.defaclrole),
      'creator_oid',d.defaclrole::text,
      'schema',n.nspname,'schema_oid',d.defaclnamespace::text,
      'scope',CASE WHEN d.defaclnamespace=0 THEN 'ALL_SCHEMAS' ELSE 'SCHEMA' END,
      'object_type',d.defaclobjtype::text,'acl_source','EXPLICIT_DEFAULT_ACL',
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,
      'grantee_oid',a.grantee::text,'grantor',grantor.rolname,
      'grantor_oid',a.grantor::text,'privilege',a.privilege_type,
      'grantable',a.is_grantable)
  FROM pg_catalog.pg_default_acl d
  LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace,
    LATERAL pg_catalog.aclexplode(d.defaclacl) a
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=a.grantee
  LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=a.grantor
  UNION ALL
  SELECT 'default_acl_builtin',creator.oid::text||':'||kind.object_type::text||':'||
    a.grantee::text||':'||a.grantor::text||':'||a.privilege_type,
    pg_catalog.jsonb_build_object('creator',creator.rolname,
      'creator_oid',creator.oid::text,'schema',NULL,
      'scope','ALL_SCHEMAS','object_type',kind.object_type,
      'acl_source','BUILTIN_REFERENCE_NOT_EFFECTIVE_DEFAULT',
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,
      'grantee_oid',a.grantee::text,'grantor',grantor.rolname,
      'grantor_oid',a.grantor::text,'privilege',a.privilege_type,
      'grantable',a.is_grantable)
  FROM pg_catalog.pg_roles creator
  CROSS JOIN (VALUES ('r'::"char",'r'::"char"),
    ('S'::"char",'s'::"char"),('f'::"char",'f'::"char"),
    ('n'::"char",'n'::"char")) kind(object_type,acl_code)
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    pg_catalog.acldefault(kind.acl_code,creator.oid)) a
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=a.grantee
  LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=a.grantor
  UNION ALL
  SELECT 'function',f.signature,
    pg_catalog.jsonb_build_object('canonical_signature',f.oid::regprocedure::text,
      'owner',pg_catalog.pg_get_userbyid(f.proowner),
      'security_definer',f.prosecdef,
      'search_path',(SELECT pg_catalog.jsonb_agg(setting)
        FROM pg_catalog.unnest(f.proconfig) setting WHERE setting LIKE 'search_path=%'),
      'kind',f.prokind)
  FROM private_functions f
  UNION ALL
  SELECT 'function_acl',f.oid::text||':'||a.grantee::text||':'||
    a.grantor::text||':'||a.privilege_type,
    pg_catalog.jsonb_build_object('signature',f.signature,
      'function_oid',f.oid::text,
      'acl_source',CASE WHEN f.proacl IS NULL THEN 'BUILTIN_DEFAULT' ELSE 'EXPLICIT' END,
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,
      'grantee_oid',a.grantee::text,'grantor',grantor.rolname,
      'grantor_oid',a.grantor::text,'privilege',a.privilege_type,
      'grantable',a.is_grantable)
  FROM private_functions f,
    LATERAL pg_catalog.aclexplode(COALESCE(f.proacl,
      pg_catalog.acldefault('f',f.proowner))) a
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=a.grantee
  LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=a.grantor
  UNION ALL
  SELECT 'function_effective',f.signature||':'||r.rolname,
    pg_catalog.jsonb_build_object('signature',f.signature,'role',r.rolname,
      'execute',pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE'),
      'schema_usage',pg_catalog.has_schema_privilege(r.oid,'catalog_private','USAGE'))
  FROM private_functions f CROSS JOIN pg_catalog.pg_roles r
  WHERE pg_catalog.has_schema_privilege(r.oid,'catalog_private','USAGE')
    OR r.rolname IN (SELECT role_name FROM subjects)
  UNION ALL
  SELECT 'rfq_function_effective',
    pg_catalog.format('%I.%I(%s)',n.nspname,p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid))||':'||r.rolname,
    pg_catalog.jsonb_build_object('role',r.rolname,
      'execute',pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE'),
      'schema_usage',pg_catalog.has_schema_privilege(r.oid,n.oid,'USAGE'))
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN pg_catalog.pg_roles r
  WHERE n.nspname='rfq_private' AND r.rolname IN (SELECT role_name FROM subjects)
  UNION ALL
  SELECT 'effective_database',s.role_name,
    pg_catalog.jsonb_build_object('role',s.role_name,
      'role_oid',s.role_oid::text,'role_exists',s.role_oid IS NOT NULL,
      'connect',CASE WHEN s.role_oid IS NULL THEN NULL ELSE
        pg_catalog.has_database_privilege(s.role_oid,pg_catalog.current_database(),'CONNECT') END,
      'create',CASE WHEN s.role_oid IS NULL THEN NULL ELSE
        pg_catalog.has_database_privilege(s.role_oid,pg_catalog.current_database(),'CREATE') END,
      'temp',CASE WHEN s.role_oid IS NULL THEN NULL ELSE
        pg_catalog.has_database_privilege(s.role_oid,pg_catalog.current_database(),'TEMP') END)
  FROM audit_subjects s
  UNION ALL
  SELECT 'effective_schema',s.role_name||':'||sc.schema_name,
    pg_catalog.jsonb_build_object('role',s.role_name,'schema',sc.schema_name,
      'role_oid',s.role_oid::text,'schema_oid',sc.oid::text,
      'role_exists',s.role_oid IS NOT NULL,'schema_exists',sc.oid IS NOT NULL,
      'usage',CASE WHEN s.role_oid IS NULL OR sc.oid IS NULL THEN NULL ELSE
        pg_catalog.has_schema_privilege(s.role_oid,sc.oid,'USAGE') END,
      'create',CASE WHEN s.role_oid IS NULL OR sc.oid IS NULL THEN NULL ELSE
        pg_catalog.has_schema_privilege(s.role_oid,sc.oid,'CREATE') END)
  FROM audit_subjects s CROSS JOIN schemas sc
  UNION ALL
  SELECT 'effective_relation',s.role_name||':'||rel.schema_name||'.'||rel.object_name,
    pg_catalog.jsonb_build_object('role',s.role_name,
      'relation',rel.schema_name||'.'||rel.object_name,
      'select',pg_catalog.has_table_privilege(r.oid,rel.oid,'SELECT'),
      'insert',pg_catalog.has_table_privilege(r.oid,rel.oid,'INSERT'),
      'update',pg_catalog.has_table_privilege(r.oid,rel.oid,'UPDATE'),
      'delete',pg_catalog.has_table_privilege(r.oid,rel.oid,'DELETE'),
      'truncate',pg_catalog.has_table_privilege(r.oid,rel.oid,'TRUNCATE'))
  FROM subjects s JOIN pg_catalog.pg_roles r ON r.rolname=s.role_name
  CROSS JOIN relations rel WHERE rel.oid IS NOT NULL
  UNION ALL
  SELECT 'snapshot_contract','catalog-a6-scheme-b-v1',
    pg_catalog.jsonb_build_object('version','catalog-a6-scheme-b-v1',
      'project_ref_source','EXTERNAL_DASHBOARD_EVIDENCE_REQUIRED',
      'raw_export_completeness','UNVERIFIED',
      'execution_provenance','UNVERIFIED')
),
section_catalog(section) AS (
  VALUES ('database'),('business_inventory'),('permission_inventory'),
    ('business_object'),('migration_registry'),('schema'),('relation'),('policy'),
    ('role'),('membership'),('database_acl_state'),('database_acl'),
    ('database_builtin_acl'),('public_database_privilege'),('schema_acl_state'),
    ('schema_acl'),('schema_builtin_acl'),('public_schema_privilege'),
    ('relation_acl'),('default_acl_state'),('default_acl'),('default_acl_builtin'),
    ('function'),('function_acl'),('function_effective'),('rfq_function_effective'),
    ('effective_database'),('effective_schema'),('effective_relation'),
    ('snapshot_contract')
),
section_rows AS (
  SELECT 'section_inventory'::text AS section,c.section AS item,
    pg_catalog.jsonb_build_object('section',c.section,
      'row_count',pg_catalog.count(r.section),
      'is_empty',pg_catalog.count(r.section)=0) AS data
  FROM section_catalog c LEFT JOIN rows r ON r.section=c.section
  GROUP BY c.section
  UNION ALL
  SELECT 'section_inventory','section_inventory',
    pg_catalog.jsonb_build_object('section','section_inventory',
      'row_count',(SELECT pg_catalog.count(*) FROM section_catalog)+1,'is_empty',false)
),
all_rows AS (
  SELECT section,item,data FROM rows
  UNION ALL
  SELECT section,item,data FROM section_rows
)
SELECT pg_catalog.jsonb_build_object('section',section,'item',item,
  'row_key',section||':'||item,'data',
  CASE WHEN section='permission_inventory' THEN data || pg_catalog.jsonb_build_object(
    'role_count',(SELECT pg_catalog.count(*) FROM rows WHERE section='role'),
    'business_object_count',(SELECT pg_catalog.count(*) FROM rows WHERE section='business_object'),
    'snapshot_row_count',(SELECT pg_catalog.count(*) FROM all_rows),
    'duplicate_row_key_count',(SELECT pg_catalog.count(*) FROM (
      SELECT section,item FROM all_rows GROUP BY section,item
        HAVING pg_catalog.count(*)>1) duplicates),
    'null_row_key_count',(SELECT pg_catalog.count(*) FROM all_rows
      WHERE section IS NULL OR item IS NULL))
  ELSE data END) AS snapshot_row
FROM all_rows ORDER BY section,item;
