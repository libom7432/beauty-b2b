-- Metadata-only snapshot. Run with a read-only, audited database connection.
-- No row values, password hashes, connection strings or function bodies are selected.
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
relations AS (
  SELECT e.*, c.oid, c.relkind, c.relowner, c.relacl, c.relrowsecurity,
    c.relforcerowsecurity
  FROM expected_relations e
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=e.schema_name
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.object_name
),
schemas AS (
  SELECT x.schema_name, n.oid, n.nspowner, n.nspacl
  FROM (VALUES ('catalog_private'),('catalog_public'),('rfq_private'),
    ('admin_private'),('public'),('supabase_migrations')) x(schema_name)
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=x.schema_name
),
private_functions AS (
  SELECT p.*, n.nspname,
    format('%I.%I(%s)',n.nspname,p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)) AS signature
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='catalog_private'
),
rows AS (
  SELECT 'database'::text section, current_database()::text item,
    pg_catalog.jsonb_build_object('name',current_database(),
      'server_version',current_setting('server_version'),
      'owner',pg_catalog.pg_get_userbyid(d.datdba),
      'encoding',pg_catalog.pg_encoding_to_char(d.encoding)) data
  FROM pg_catalog.pg_database d WHERE d.datname=current_database()
  UNION ALL
  SELECT 'business_inventory','catalog-rfq-admin-prefixes',
    pg_catalog.jsonb_build_object('complete',true)
  UNION ALL
  SELECT 'permission_inventory','database-acl-and-membership',
    pg_catalog.jsonb_build_object('complete',true,
      'membership_count',(SELECT count(*) FROM pg_catalog.pg_auth_members),
      'database_acl_count',(SELECT count(*) FROM pg_catalog.pg_database d,
        LATERAL pg_catalog.aclexplode(COALESCE(d.datacl,
          pg_catalog.acldefault('d',d.datdba))) a
        WHERE d.datname=current_database()),
      'public_schema_acl_count',(SELECT count(*) FROM pg_catalog.pg_namespace n,
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
  SELECT 'business_object','function:'||format('%I.%I(%s)',n.nspname,p.proname,
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
    pg_catalog.jsonb_build_object('login',r.rolcanlogin,'inherit',r.rolinherit,
      'superuser',r.rolsuper,'bypass_rls',r.rolbypassrls,
      'create_db',r.rolcreatedb,'create_role',r.rolcreaterole)
  FROM pg_catalog.pg_roles r
  UNION ALL
  SELECT 'membership',member.rolname||'->'||parent.rolname,
    pg_catalog.jsonb_build_object('member',member.rolname,'parent',parent.rolname,
      'admin_option',m.admin_option)
  FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles member ON member.oid=m.member
  JOIN pg_catalog.pg_roles parent ON parent.oid=m.roleid
  UNION ALL
  SELECT 'database_acl',COALESCE(grantee.rolname,'PUBLIC')||':'||a.privilege_type,
    pg_catalog.jsonb_build_object('grantee',COALESCE(grantee.rolname,'PUBLIC'),
      'privilege',a.privilege_type,'grantable',a.is_grantable)
  FROM pg_catalog.pg_database d,
    LATERAL pg_catalog.aclexplode(COALESCE(d.datacl,
      pg_catalog.acldefault('d',d.datdba))) a
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=a.grantee
  WHERE d.datname=current_database()
  UNION ALL
  SELECT 'schema_acl',s.schema_name||':'||COALESCE(grantee.rolname,'PUBLIC')||':'||a.privilege_type,
    pg_catalog.jsonb_build_object('schema',s.schema_name,
      'grantee',COALESCE(grantee.rolname,'PUBLIC'),
      'privilege',a.privilege_type,'grantable',a.is_grantable)
  FROM schemas s,
    LATERAL pg_catalog.aclexplode(COALESCE(s.nspacl,
      pg_catalog.acldefault('n',s.nspowner))) a
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=a.grantee
  WHERE s.oid IS NOT NULL
  UNION ALL
  SELECT 'relation_acl',r.schema_name||'.'||r.object_name||':'||
    COALESCE(grantee.rolname,'PUBLIC')||':'||a.privilege_type,
    pg_catalog.jsonb_build_object('relation',r.schema_name||'.'||r.object_name,
      'grantee',COALESCE(grantee.rolname,'PUBLIC'),
      'privilege',a.privilege_type,'grantable',a.is_grantable)
  FROM relations r,
    LATERAL pg_catalog.aclexplode(COALESCE(r.relacl,
      pg_catalog.acldefault((CASE WHEN r.relkind='S' THEN 'S' ELSE 'r' END)::"char",r.relowner))) a
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=a.grantee
  WHERE r.oid IS NOT NULL
  UNION ALL
  SELECT 'default_acl',pg_catalog.pg_get_userbyid(d.defaclrole)||':'||
    COALESCE(n.nspname,'ALL_SCHEMAS')||':'||d.defaclobjtype::text||':'||
    COALESCE(grantee.rolname,'PUBLIC')||':'||a.privilege_type,
    pg_catalog.jsonb_build_object('creator',pg_catalog.pg_get_userbyid(d.defaclrole),
      'schema',n.nspname,'object_type',d.defaclobjtype,
      'grantee',COALESCE(grantee.rolname,'PUBLIC'),
      'privilege',a.privilege_type,'grantable',a.is_grantable)
  FROM pg_catalog.pg_default_acl d
  LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace,
    LATERAL pg_catalog.aclexplode(d.defaclacl) a
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=a.grantee
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
  SELECT 'function_acl',f.signature||':'||COALESCE(grantee.rolname,'PUBLIC')||':'||a.privilege_type,
    pg_catalog.jsonb_build_object('signature',f.signature,
      'grantee',COALESCE(grantee.rolname,'PUBLIC'),
      'privilege',a.privilege_type,'grantable',a.is_grantable)
  FROM private_functions f,
    LATERAL pg_catalog.aclexplode(COALESCE(f.proacl,
      pg_catalog.acldefault('f',f.proowner))) a
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=a.grantee
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
    format('%I.%I(%s)',n.nspname,p.proname,
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
      'connect',pg_catalog.has_database_privilege(r.oid,current_database(),'CONNECT'),
      'create',pg_catalog.has_database_privilege(r.oid,current_database(),'CREATE'),
      'temp',pg_catalog.has_database_privilege(r.oid,current_database(),'TEMP'))
  FROM subjects s JOIN pg_catalog.pg_roles r ON r.rolname=s.role_name
  UNION ALL
  SELECT 'effective_schema',s.role_name||':'||sc.schema_name,
    pg_catalog.jsonb_build_object('role',s.role_name,'schema',sc.schema_name,
      'usage',pg_catalog.has_schema_privilege(r.oid,sc.oid,'USAGE'),
      'create',pg_catalog.has_schema_privilege(r.oid,sc.oid,'CREATE'))
  FROM subjects s JOIN pg_catalog.pg_roles r ON r.rolname=s.role_name
  CROSS JOIN schemas sc WHERE sc.oid IS NOT NULL
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
)
SELECT pg_catalog.jsonb_build_object('section',section,'item',item,'data',data) AS snapshot_row
FROM rows ORDER BY section,item;
