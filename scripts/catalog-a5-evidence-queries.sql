-- Sprint 2.7-A5-F2-R2: Catalog evidence SQL archival and A4 reconstruction.
-- A4-6 through A4-9: RECONSTRUCTED_DRAFT — NOT APPROVED FOR EXECUTION.
-- A4 source: A4 field requirements in the Sprint 2.7-A5-F2-R2 task, PostgreSQL 17
-- system catalog definitions, and the repository's metadata snapshot patterns.
-- A4 version: R2 initial reconstruction, 2026-11-09. Review each query separately.
-- A5-F1 source: ChatGPT task "【beauty-b2b｜Sprint 2.7 项目管理与开发决策】",
-- message e5e450ad-2b40-4642-89ac-b84bf07664a5 (user-provided A5-F1 conclusion).
-- A5-F1 version: original SQL block recovered 2026-11-09; query text remains unchanged.
-- A5-F1 status: ORIGINAL_RECOVERED_DRAFT — NOT APPROVED FOR EXECUTION.
-- Target for later manual review: beauty-b2b-catalog-dev (nnmdcezigmguqolbxzmb), PostgreSQL 17.11.
-- Each semicolon-terminated SELECT is a separate query. Do not run this file as a batch.

-- A4-6. Complete role inventory. RECONSTRUCTED_DRAFT — NOT APPROVED FOR EXECUTION.
SELECT r.oid AS role_oid,
       r.rolname AS role_name,
       r.rolcanlogin AS can_login,
       r.rolinherit AS inherits_privileges,
       r.rolsuper AS is_superuser,
       r.rolbypassrls AS bypasses_rls,
       r.rolcreatedb AS can_create_database,
       r.rolcreaterole AS can_create_role,
       r.rolreplication AS can_replicate,
       r.rolconnlimit AS connection_limit
FROM pg_catalog.pg_roles AS r
ORDER BY r.rolname, r.oid;

-- A4-7. Complete member -> parent edges. RECONSTRUCTED_DRAFT — NOT APPROVED FOR EXECUTION.
SELECT m.oid AS membership_oid,
       m.member AS member_oid,
       member.rolname AS member_role,
       m.roleid AS parent_oid,
       parent.rolname AS parent_role,
       m.grantor AS grantor_oid,
       grantor.rolname AS grantor_role,
       m.admin_option,
       m.inherit_option,
       m.set_option
FROM pg_catalog.pg_auth_members AS m
LEFT JOIN pg_catalog.pg_roles AS member ON member.oid = m.member
LEFT JOIN pg_catalog.pg_roles AS parent ON parent.oid = m.roleid
LEFT JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = m.grantor
ORDER BY member_role, parent_role, grantor_role, m.oid;

-- A4-8. Complete public schema ACL. RECONSTRUCTED_DRAFT — NOT APPROVED FOR EXECUTION.
SELECT n.oid AS schema_oid,
       n.nspname AS schema_name,
       n.nspowner AS owner_oid,
       pg_catalog.pg_get_userbyid(n.nspowner) AS schema_owner,
       n.nspacl IS NULL AS uses_builtin_acl_default,
       CASE WHEN n.nspacl IS NULL THEN 'BUILTIN_DEFAULT' ELSE 'EXPLICIT' END AS acl_source,
       a.grantee AS grantee_oid,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
       a.grantor AS grantor_oid,
       grantor.rolname AS grantor,
       a.privilege_type,
       a.is_grantable
FROM pg_catalog.pg_namespace AS n
LEFT JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
) AS a ON true
LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = a.grantee
LEFT JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = a.grantor
WHERE n.nspname = 'public'
ORDER BY a.grantee, a.privilege_type, a.grantor;

-- A4-9. Effective public schema privileges for every role, plus required
-- roles even if absent. RECONSTRUCTED_DRAFT — NOT APPROVED FOR EXECUTION.
WITH required_roles(role_name) AS (
  VALUES ('anon'), ('authenticated'), ('service_role')
),
subjects(role_name) AS (
  SELECT r.rolname::text FROM pg_catalog.pg_roles AS r
  UNION
  SELECT required_roles.role_name FROM required_roles
)
SELECT s.role_name,
       r.oid AS role_oid,
       r.oid IS NOT NULL AS role_exists,
       n.oid AS schema_oid,
       n.oid IS NOT NULL AS schema_exists,
       CASE WHEN r.oid IS NOT NULL AND n.oid IS NOT NULL
         THEN pg_catalog.has_schema_privilege(r.oid, n.oid, 'USAGE') END AS can_use,
       CASE WHEN r.oid IS NOT NULL AND n.oid IS NOT NULL
         THEN pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE') END AS can_create
FROM subjects AS s
LEFT JOIN pg_catalog.pg_roles AS r ON r.rolname = s.role_name
LEFT JOIN pg_catalog.pg_namespace AS n ON n.nspname = 'public'
ORDER BY s.role_name;

-- 1. 当前数据库所有者及 ACL 是否采用隐含默认值
SELECT d.datname AS database_name,
       pg_catalog.pg_get_userbyid(d.datdba) AS owner,
       d.datacl IS NULL AS uses_builtin_acl_default
FROM pg_catalog.pg_database AS d
WHERE d.datname = current_database();

-- 2. 当前数据库的显式或隐含默认 ACL，含 PUBLIC 和授权选项
SELECT d.datname AS database_name,
       COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
       a.privilege_type, a.is_grantable,
       d.datacl IS NULL AS uses_builtin_acl_default
FROM pg_catalog.pg_database AS d
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(d.datacl, pg_catalog.acldefault('d', d.datdba))
) AS a
LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = a.grantee
WHERE d.datname = current_database()
ORDER BY grantee, a.privilege_type;

-- 3. 指定角色的有效 CONNECT、CREATE、TEMP；未创建的审计角色显示为不存在
WITH subjects(role_name) AS (
  VALUES ('anon'), ('authenticated'), ('service_role'),
         ('authenticator'), ('postgres'), ('catalog_audit_meta')
)
SELECT s.role_name, r.oid IS NOT NULL AS role_exists,
       CASE WHEN r.oid IS NOT NULL
         THEN pg_catalog.has_database_privilege(r.oid, d.oid, 'CONNECT') END AS can_connect,
       CASE WHEN r.oid IS NOT NULL
         THEN pg_catalog.has_database_privilege(r.oid, d.oid, 'CREATE') END AS can_create,
       CASE WHEN r.oid IS NOT NULL
         THEN pg_catalog.has_database_privilege(r.oid, d.oid, 'TEMP') END AS can_temp
FROM subjects AS s
CROSS JOIN pg_catalog.pg_database AS d
LEFT JOIN pg_catalog.pg_roles AS r ON r.rolname = s.role_name
WHERE d.datname = current_database()
ORDER BY s.role_name;

-- 4. 与目标相关的显式默认 ACL；保留“ACL 条目存在但没有授予项”的行
SELECT pg_catalog.pg_get_userbyid(d.defaclrole) AS creator,
       COALESCE(n.nspname, 'ALL_SCHEMAS') AS schema_scope,
       d.defaclobjtype::text AS object_type,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
       a.privilege_type, a.is_grantable
FROM pg_catalog.pg_default_acl AS d
LEFT JOIN pg_catalog.pg_namespace AS n ON n.oid = d.defaclnamespace
LEFT JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a ON true
LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = a.grantee
WHERE d.defaclnamespace = 0
   OR n.nspname IN (
     'public', 'catalog_private', 'catalog_public',
     'rfq_private', 'admin_private'
   )
ORDER BY creator, schema_scope, object_type, grantee, a.privilege_type;

-- 5. 所有数据库上可能传给未来角色的 PUBLIC 数据库权限
SELECT d.datname AS database_name, a.privilege_type, a.is_grantable,
       d.datacl IS NULL AS uses_builtin_acl_default
FROM pg_catalog.pg_database AS d
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(d.datacl, pg_catalog.acldefault('d', d.datdba))
) AS a
WHERE a.grantee = 0
ORDER BY d.datname, a.privilege_type;

-- 6. 非系统 Schema 上可能传给未来角色的 PUBLIC 权限
SELECT n.nspname AS schema_name, a.privilege_type, a.is_grantable
FROM pg_catalog.pg_namespace AS n
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
) AS a
WHERE a.grantee = 0
  AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
  AND n.nspname <> 'information_schema'
ORDER BY n.nspname, a.privilege_type;
