# Sprint 2.7-A5-F2-R2 — Catalog 权限取证 SQL 清单

状态：**技术审查完成（STATIC_ONLY）；A4 重建草案尚未获准人工执行**。十条查询均已归档；尚未连接或验证 Supabase。

## 目标与来源

- 目标项目：`beauty-b2b-catalog-dev`；Ref：`nnmdcezigmguqolbxzmb`；Region：`ap-northeast-1`；预期 PostgreSQL：17.11。
- Git 基线：`main`，`c496faf1f3c94156288a5debf6d6bf0ff8768e69`。此值仅是本轮开始时的代码基线，不证明数据库身份。
- A5-F1 原文来源：ChatGPT 任务「【beauty-b2b｜Sprint 2.7 项目管理与开发决策】」的用户消息 `e5e450ad-2b40-4642-89ac-b84bf07664a5`，消息中“待手动执行的只读 SQL 草案”代码块。查询正文逐字归档于 `scripts/catalog-a5-evidence-queries.sql`；没有静默改变查询语义。该消息只提出后续人工审核执行，**不构成执行批准**。
- A4 第 6–9 项：原始 SQL 仍未找到。本轮依 Sprint 2.7-A5-F2-R2 任务列出的字段要求、[PostgreSQL 17 系统目录文档](https://www.postgresql.org/docs/17/catalogs.html)及仓库现有元数据快照模式重建，版本为 **R2 initial reconstruction（2026-11-09）**。四条均为 `RECONSTRUCTED_DRAFT — NOT APPROVED FOR EXECUTION`，不得冒充 A4 原始查询。
- 哈希口径：下表 SHA-256 对每条查询从 `SELECT` 或 `WITH` 至分号的 UTF-8 文本计算，去除首尾空白；不包括标题注释。归档 SQL **整文件** SHA-256：`b167936f182c222583b1dbb272d0bb01321ec5a5c378852998bc732301ed1dc3`。
- A4-9 哈希口径勘误（A5-F4-R4-F1）：规范范围从 `WITH required_roles` 开始，到 `ORDER BY s.role_name;` 结束，去除首尾空白，以 UTF-8 计算 SHA-256，不含标题注释。旧登记值 `7e2a1c7332293527baa100607640f69db079f55caacd39de378ebf106521a6ae` 可由第二行标题注释 `-- roles even if absent. RECONSTRUCTED_DRAFT — NOT APPROVED FOR EXECUTION.` 及其 LF（共 77 字节）紧接规范查询正文计算复现；该旧值仅供历史追溯，不是规范查询哈希。此修正不证明现场实际执行的 SQL 字节版本。

## 查询清单

| 编号 | 状态、来源 | 预期导出字段与数量基线 | 查询 SHA-256 | 静态审查 |
| --- | --- | --- | --- | --- |
| A4-6 | `RECONSTRUCTED_DRAFT`；R2 字段要求、`pg_roles` | `role_oid, role_name, can_login, inherits_privileges, is_superuser, bypasses_rls, can_create_database, can_create_role, can_replicate, connection_limit`；初查 30 行，仅作完整性参考 | `666973a4a2714dce31cc83ae24b9d3d3199b13842973b283ce90d9afd5442a35` | `PASS_STATIC / NOT_APPROVED` |
| A4-7 | `RECONSTRUCTED_DRAFT`；R2 字段要求、`pg_auth_members` | `membership_oid, member_oid, member_role, parent_oid, parent_role, grantor_oid, grantor_role, admin_option, inherit_option, set_option`；初查 24 行，仅作完整性参考 | `1e2d6a638799326b6fa9313f51b7cf069e680315056b51aa7585519c63146fcf` | `PASS_STATIC / NOT_APPROVED` |
| A4-8 | `RECONSTRUCTED_DRAFT`；R2 字段要求、`pg_namespace` | `schema_oid, schema_name, owner_oid, schema_owner, uses_builtin_acl_default, acl_source, grantee_oid, grantee, grantor_oid, grantor, privilege_type, is_grantable`；此前 7 行，仅作参考；若显式 ACL 为空，保留一行 NULL 权限标记 | `db85170bddb5ee5f57564d8b72fe88fae771020e1d4df2aa9b2eafb82990176d` | `PASS_STATIC / NOT_APPROVED` |
| A4-9 | `RECONSTRUCTED_DRAFT`；R2 字段要求、`has_schema_privilege` | `role_name, role_oid, role_exists, schema_oid, schema_exists, can_use, can_create`；覆盖全部当前角色及 `anon`、`authenticated`、`service_role`，预期至少与 A4-6 角色集合相同；缺失角色仍留一行 | `e915c936eaff1356335fe298cdcd4cf049bb854c51caa11cf7e2d35f462e3b91` | `PASS_STATIC / NOT_APPROVED` |
| A5-F1-1 | `ORIGINAL_RECOVERED_DRAFT`；上述消息 | `database_name, owner, uses_builtin_acl_default`；当前数据库预期 1 行 | `20ab76ff9122648d8b64942c8a8926e02dff4c654bd0d4207e363d41849999bb` | `PASS_STATIC` |
| A5-F1-2 | `ORIGINAL_RECOVERED_DRAFT`；上述消息 | `database_name, grantee, privilege_type, is_grantable, uses_builtin_acl_default`；逐项全量，行数待实测 | `7b29240b656e5386c876a6d0613d14a77916a9871db850e5b44d8a46eb1927cc` | `PASS_STATIC` |
| A5-F1-3 | `ORIGINAL_RECOVERED_DRAFT`；上述消息 | `role_name, role_exists, can_connect, can_create, can_temp`；固定 6 个候选角色，当前库预期 6 行。未创建的角色以 `role_exists=false` 和 NULL 权限表示 | `529b87ba18da2a5eed6f01a8dac1c48d6c1f4799b6f38e9eabe672a94cfa70bf` | `PASS_STATIC` |
| A5-F1-4 | `ORIGINAL_RECOVERED_DRAFT`；上述消息 | `creator, schema_scope, object_type, grantee, privilege_type, is_grantable`；可为 0 行，须保留空 CSV 与成功执行记录 | `b87055eb6b6f318c6685af5e26a19921b65e8f1a258690498a43f66078f7252c` | `PASS_STATIC` |
| A5-F1-5 | `ORIGINAL_RECOVERED_DRAFT`；上述消息 | `database_name, privilege_type, is_grantable, uses_builtin_acl_default`；所有数据库的 PUBLIC 行，数量待实测并核对数据库覆盖范围 | `397423751a0a6cbeecfdf8f5cd385eca933a84a394ed1c7371e8f2891e86cfa7` | `PASS_STATIC` |
| A5-F1-6 | `ORIGINAL_RECOVERED_DRAFT`；上述消息 | `schema_name, privilege_type, is_grantable`；非系统 Schema 的 PUBLIC 行，数量待实测并核对 Schema 覆盖范围 | `453fd800381641777e3bdcdb48b2e8c5b672894c1cad9fbb01b9b70739fd08a6` | `PASS_STATIC` |

审批状态：A4 四条均 **未获项目所有者批准人工执行**；A5-F1 六条仍为从原消息恢复的待审核执行草案。十条的来源和哈希可以分别核对，但归档与静态通过不构成执行授权。

## 静态安全及兼容性审查

- A4 四条与 A5-F1 六条均为查询 `pg_catalog` 的独立 `SELECT`（A4-9 及 A5-F1-3 含只读 `WITH`），仅用 PostgreSQL 内置信息函数；未见 DDL、DML、动态 SQL、角色变更、GRANT/REVOKE、RLS 或迁移语句；不读取业务行、凭据及迁移正文。A4-6 只从 `pg_roles` 选取指定属性，不选 `rolpassword`。
- A4-7 从 `pg_auth_members` 全量读取成员 → 父角色及授权者的名称和 OID，保留三个 option；LEFT JOIN 避免名称映射异常时静默丢边。A4-8 用 `nspacl IS NULL` 和 `acl_source` 区分显式与内建默认 Schema ACL，并保留 grantor、grantee。A4-9 的 `has_schema_privilege` 是有效权限，不是直接 ACL；USAGE 与 CREATE 独立输出。
- A4-9 对全部当前角色枚举，额外保留三个必查角色；不存在角色时 `role_exists=false`，有效权限为 NULL。若 `public` Schema 不存在，`schema_exists=false`，有效权限为 NULL。任何此类缺失、A4-8 空结果、未知角色／边、数量差异、权限扩大均需人工阻断或解释，不得自动通过。
- 依 PostgreSQL 17 文档，使用的 `pg_database`、`pg_roles`、`pg_default_acl`、`pg_namespace`、`aclexplode`、`acldefault`、`has_database_privilege` 及 `TEMP` 权限名与 17 系列兼容。**仅为静态判断；未在目标 PostgreSQL 17.11 执行。**
- 第 1、2、5 条的 `uses_builtin_acl_default` 明确区分数据库 ACL 的 NULL 隐含默认值；第 2、5 条展开 `PUBLIC` ACL。第 3 条报告指定角色的有效权限，不能仅凭无显式授权推断无有效权限。第 4 条只涵盖显式 `pg_default_acl`：空结果不表示内置默认权限安全。第 6 条导出 PUBLIC Schema 权限，但没有显式／隐含来源标记，也不替代完整 Schema ACL 或逐角色有效权限结果。
- A4 初查的 30／24／7 仅是数量基线，不是正式快照或安全通过。本机未发现可用的 `psql` 或 PostgreSQL SQL 解析库；**验证级别为 `STATIC_ONLY`，没有本地或目标数据库执行验证**。
- 参考 PostgreSQL 17 官方文档：[角色视图](https://www.postgresql.org/docs/17/view-pg-roles.html)、[成员关系字段](https://www.postgresql.org/docs/17/catalog-pg-auth-members.html)、[Schema 目录](https://www.postgresql.org/docs/17/catalog-pg-namespace.html)、[权限及 ACL 函数](https://www.postgresql.org/docs/17/functions-info.html)、[显式默认 ACL](https://www.postgresql.org/docs/17/catalog-pg-default-acl.html)。

## 人工导出、核验与签署要求

1. 先由项目所有者独立确认项目名称、Ref、Region、目标数据库、直连或 pooler 主机、PostgreSQL 版本、执行身份及其授权范围；记录 UTC 采集时间。仅当十条查询的来源、静态审查和**逐条执行批准**齐备后，才逐条人工执行。
2. 每条查询保存 SQL 原文、查询版本或 SHA-256、成功／失败记录、完整 CSV、行数、文件名、项目 Ref、数据库名、执行身份、人工采集者及独立复核者。空结果也保存带列头的文件和成功执行记录；截图、数量摘要及截断结果均不够。
3. 对 30 个角色和 24 条成员关系逐行记录：原始对象／角色、权限或关系、直接／继承／PUBLIC 来源、预期及业务依据、风险级别、`APPROVED`／`NEEDS_EXPLANATION`／`BLOCKED`、负责人、证据引用、复核结论。未知角色／边、缺行或权限扩大不得自动批准。
4. 将敏感拓扑信息放在受限位置，勿提交公开仓库。两名人员分别签署身份核验、结果完整性与逐行审核；不把静态审查或本地归档当成真实 Supabase 取证。

## 阻断条件与交接顺序

- **当前阻断**：A4-6 至 A4-9 原始 SQL 仍缺失，已用有来源和独立哈希的 `RECONSTRUCTED_DRAFT` 补齐技术取证包；四条尚待 GPT 独立审查及项目所有者批准。A5-F1 六条亦未获执行批准；真实目标证据与独立复核均未采集。
- 任何查询结果缺行、目标身份不符、空结果未经解释、未知角色／成员边未分类或复核未完成，均保持阻断。若项目所有者后来提供 A4 原文，应对照重建版重新审核，不能静默替换。
- 后续顺序：身份核对 → A4 四项完整导出 → A5-F1 六项完整导出 → 完整性校验 → 逐行分类及独立复核 → 通过后另行申请角色创建及 A6。**本轮不批准数据库连接、SQL 执行、角色创建或迁移。**
