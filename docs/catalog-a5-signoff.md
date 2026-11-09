# Sprint 2.7 A5-F5 — Catalog 权限证据分层签署报告（待签）

**阶段状态：`EVIDENCE_COLLECTED / PROVENANCE_PENDING / BASELINE_NOT_APPROVED / A6_BLOCKED`。** 本文件是项目负责人及独立复核者的签署准备材料；未取得签名，也不构成数据库权限批准。

## 1. 项目身份、证据范围与版本

- 目标：Supabase 开发项目 `beauty-b2b-catalog-dev`，Ref `nnmdcezigmguqolbxzmb`；目标数据库 `postgres`；预期 PostgreSQL 17.11。项目名、Ref 和版本来自交接／人工陈述，CSV 本身不包含现场 Ref 或运行时版本。`A5-F1-1.csv` 记录数据库及所有者均为 `postgres`。
- 十条取证 SQL 归档于 `scripts/catalog-a5-evidence-queries.sql`，整文件 SHA-256 为 `b167936f182c222583b1dbb272d0bb01321ec5a5c378852998bc732301ed1dc3`。逐条规范 SQL SHA-256、来源与版本见 `docs/catalog-a5-evidence-manifest.md`；对应 CSV SHA-256、完整本地路径、行列数与来源状态见 `docs/catalog-a5-evidence-provenance.md`。
- A4-6 至 A4-9 是 R2 重建查询，原始 A4 SQL 未找到；A5-F1-1 至 A5-F1-6 是从先前用户提供的 SQL 原文恢复的归档版本。A4-9 规范 SHA-256 为 `e915c936eaff1356335fe298cdcd4cf049bb854c51caa11cf7e2d35f462e3b91`；旧登记值 `7e2a1c7332293527baa100607640f69db079f55caacd39de378ebf106521a6ae` 多含第二行标题注释及 LF（77 字节），仅用于追溯。修复哈希口径不证明实际执行版本。

| 查询 | 原始 CSV 文件名 | 数据行 / 列 | 本地文件核验 |
| --- | --- | ---: | --- |
| A4-6 | `A4-6-roles.csv` | 30 / 10 | 已核对 SHA-256；执行来源待绑定 |
| A4-7 | `A4-7-memberships.csv` | 24 / 10 | 已核对 SHA-256；执行来源待绑定 |
| A4-8 | `A4-8-schema-acl.csv` | 7 / 12 | 已核对 SHA-256；执行来源待绑定 |
| A4-9 | `A4-9-effective-schema.csv` | 30 / 7 | 已核对 SHA-256；规范 SQL 哈希已勘误；执行来源待绑定 |
| A5-F1-1 | `A5-F1-1.csv` | 1 / 3 | 已核对 SHA-256；执行来源待绑定 |
| A5-F1-2 | `A5-F1-2.csv` | 10 / 5 | 已核对 SHA-256；执行来源待绑定 |
| A5-F1-3 | `A5-F1-3.csv` | 6 / 5 | 已核对 SHA-256；执行来源待绑定 |
| A5-F1-4 | `A5-F1-4.csv` | 96 / 6 | 已核对 SHA-256；执行来源待绑定 |
| A5-F1-5 | `A5-F1-5.csv` | 4 / 4 | 已核对 SHA-256；执行来源待绑定 |
| A5-F1-6 | `A5-F1-6.csv` | 1 / 3 | 已核对 SHA-256；执行来源待绑定 |

十份 CSV 均可读取，字段宽度一致、无重复标题行，SHA-256 和行列数与来源登记及 A5-F4 综合审查报告一致。此结论仅证明当前本地文件完整性与登记一致，不以数量证明权限安全，也不代替现场导出证明。完整 CSV、截图与执行日志应留在受限证据位置，不随本报告提交 Git。

## 2. 执行来源与人工签署缺口

| 事项 | 当前结论 | 签署前需要的绑定材料 |
| --- | --- | --- |
| 项目名称与 Ref | `PARTIALLY_VERIFIED`：交接信息及人工陈述；CSV 无 Ref | 受信项目清单及可核验现场身份材料 |
| 数据库名与所有者 | `VERIFIED`：`A5-F1-1.csv` 所记录的值均为 `postgres` | 与现场目标身份记录关联 |
| PostgreSQL 运行时版本、SQL Editor 身份及身份检查时间 | `PENDING`：用户称截图记录 `current_user=session_user=postgres`、17.11、`2026-11-09 03:49:32 UTC`，但当前环境无法读取原图 | 原图、来源及哈希；独立复核其可见内容。该截图只证明身份检查当时，不自动证明十条导出 |
| 十条 SQL 的逐次执行身份、UTC 时间、成功记录及 SQL–CSV 一一绑定 | `PENDING` | 每条查询的现场日志／截图或等价记录、实际 SQL 原文／哈希、导出文件关联 |
| 采集者、独立复核者与审批负责人 | `PENDING` | 下方人工签名、时间、范围及结论 |

不得用文件创建／下载时间代替数据库采集时间，不得将 `HASH_RECONCILED` 写成 `EXECUTION_PROVENANCE_VERIFIED`。

## 3. 权限基线审批摘要

- A5-F4 综合审查报告已逐项记录 30 个角色与 24 条成员关系，交叉分析数据库 ACL、`public` Schema ACL、默认 ACL 与有效权限。此处仅引用该矩阵，不将 `REVIEWED_PENDING_APPROVAL` 或 `NEEDS_EXPLANATION` 改为 `APPROVED`。
- 当前数据库 `PUBLIC` 获 CONNECT 与 TEMPORARY，`public` Schema 的 `PUBLIC` 获 USAGE。未来新角色可能因 PUBLIC 获有效 TEMP；TEMP 与数据库／Schema CREATE 及业务表 DML 是不同权限，但不能称该角色在数据库权限意义上绝对只读。TEMP 剩余风险尚未由项目负责人接受。
- `authenticator → service_role`、`supabase_realtime_admin → service_role`、`supabase_storage_admin → authenticator` 等 SET ROLE 路径，以及 `postgres`、`supabase_admin`、`supabase_read_only_user` 等高权限属性仍待平台／数据库安全负责人解释和项目负责人批准。角色名称或前缀不构成批准依据。
- `catalog_audit_meta` 在现有证据中不存在；其实际有效权限未验证。

审计身份方案状态：**A** 独立 LOGIN 元数据审计角色须先处理并正式接受 PUBLIC TEMP=true 的剩余风险，未批准；**B** 由既有受控身份完成一次性元数据审计是优先评估的架构建议，实际身份及权限边界未绑定，未获实施批准；**C** 坚持有效 TEMP=false 则继续阻断并研究隔离方案。方案 B 的受控查询机制不等同于数据库最小权限角色。

## 4. A5 分层验收与 A6 准入

| 层级 | 当前状态 | 准入含义 |
| --- | --- | --- |
| Evidence Collected | `EVIDENCE_COLLECTED` | 十份实际取得的 CSV 已完成本地结构、行列数及哈希核对；尚未完成执行来源绑定 |
| Evidence Provenance | `PROVENANCE_PENDING` | 项目现场身份、逐次执行时间／身份／成功记录、SQL–CSV 绑定及签署待补 |
| Permission Baseline | `BASELINE_NOT_APPROVED` | 30 角色、24 关系及相关 ACL 已分析，正式逐项审批与剩余风险决定未完成 |
| A6 Entry | `A6_BLOCKED` | 尚无 A6 正式快照执行授权；现有专用审计身份契约及检查器条件未因方案 B 建议而变更 |

项目负责人须分别签署证据来源与权限基线结论，正式选定审计执行方式；若改变 A6 专用身份契约，应另行批准设计变更及检查器适配。数据库连接／写入、审计角色创建、GRANT／REVOKE、RLS 修改、迁移及 A6 执行均需单独授权。本报告不授予任何此类权限。

## 5. 人工签署（留空）

项目负责人姓名／签名：________________　日期时间（UTC）：________________

人工采集者姓名／签名：________________　日期时间（UTC）：________________

独立复核者姓名／签名：________________　日期时间（UTC）：________________

证据来源结论及范围：________________

权限基线结论、剩余风险接受与范围：________________

审计身份方案决定及 A6 独立授权编号（如有）：________________
