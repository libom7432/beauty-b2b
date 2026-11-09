# Sprint 2.7 A5-F4-R4 — Catalog 权限取证来源登记（待签署）

**登记状态：HASH_RECONCILED / PROVENANCE_PENDING；权限基线：BASELINE_NOT_APPROVED；A6：BLOCKED。** 本登记只证明下列本地文件的离线检查结果，不证明十条 SQL 的实际执行身份、时间或项目归属，也不授权数据库操作。

## 1. 项目与来源边界

| 项目 | 登记值 | 证据及状态 |
| --- | --- | --- |
| Supabase 项目 | `beauty-b2b-catalog-dev`；Ref `nnmdcezigmguqolbxzmb` | 项目交接信息及 A5-F4 报告的人工核对陈述；CSV 无 Ref，现场独立证明 **PENDING** |
| 数据库及所有者 | `postgres` / `postgres` | `A5-F1-1.csv` 唯一数据行；**VERIFIED（对该 CSV）** |
| PostgreSQL 运行时版本 | 17.11 | 交接信息和用户陈述；可核验现场截图或运行记录 **PENDING** |
| SQL Editor 身份与时间 | 用户称身份截图记录 `current_user=postgres`、`session_user=postgres`、`2026-11-09 03:49:32 UTC` | 当前环境无法读取该图片；**EVIDENCE_UNAVAILABLE / PENDING**。即使核验截图，也只绑定身份检查查询当时，不自动绑定十次导出 |
| 原始 CSV 目录 | `/Users/mima0000/Downloads/` | 下表十个文件均可读取；原文件应保存在受限证据库，勿提交公开仓库 |
| SQL 原文 | `/Users/mima0000/Documents/Codex/2026-10-03/b2b-b2b-press-on-nails-false/scripts/catalog-a5-evidence-queries.sql` | 整文件 SHA-256 `b167936f182c222583b1dbb272d0bb01321ec5a5c378852998bc732301ed1dc3`；本轮核验 |
| SQL 登记 | `/Users/mima0000/Documents/Codex/2026-10-03/b2b-b2b-press-on-nails-false/docs/catalog-a5-evidence-manifest.md` | 每条查询的登记哈希、来源、版本及静态审查状态 |
| 既有逐项审查 | `/Users/mima0000/Downloads/beauty-b2b-Sprint-2.7-A5-F4-audit.md` | 十份 CSV 的既有行列数和哈希、30 角色与 24 关系矩阵；状态 `EVIDENCE_REVIEWED / BASELINE_NOT_APPROVED / A6_BLOCKED` |

查询来源版本：A4-6 至 A4-9 是 **R2 initial reconstruction（2026-11-09）**，原始 A4 查询未找到，原登记为 `RECONSTRUCTED_DRAFT — NOT APPROVED FOR EXECUTION`；A5-F1-1 至 A5-F1-6 是从 ChatGPT 任务「【beauty-b2b｜Sprint 2.7 项目管理与开发决策】」用户消息 `e5e450ad-2b40-4642-89ac-b84bf07664a5` 恢复的原文，归档版本为 2026-11-09 的 `ORIGINAL_RECOVERED_DRAFT`。该归档中的旧审批标签只描述归档当时状态；本登记不推断现场逐条执行记录或后续批准已完整归档。

## 2. 十份结果的字节与结构核验

SHA-256 对完整 CSV 文件字节计算；SQL SHA-256 按 Manifest 所述，对查询从 `SELECT` 或 `WITH` 到分号的 UTF-8 文本去除首尾空白后计算。数据行数不含标题行。下列文件名均位于上述 `/Users/mima0000/Downloads/` 目录。

| 查询 / CSV 文件 | SQL SHA-256：实算；Manifest 登记 | CSV SHA-256：实算且与 A5-F4 报告一致 | 数据行 / 列 | 文件核验状态 |
| --- | --- | --- | ---: | --- |
| A4-6 / `A4-6-roles.csv` | `666973a4a2714dce31cc83ae24b9d3d3199b13842973b283ce90d9afd5442a35`；一致 | `be7774f0953f84e729db24cbe900d48c0bb9b037d7199aef60ffa2fc8a944c7e` | 30 / 10 | PARTIALLY_VERIFIED |
| A4-7 / `A4-7-memberships.csv` | `1e2d6a638799326b6fa9313f51b7cf069e680315056b51aa7585519c63146fcf`；一致 | `16109aad0fcdc780efa3685d7a72b9940d408ae3eb92660bdbe3b21a3924c4f0` | 24 / 10 | PARTIALLY_VERIFIED |
| A4-8 / `A4-8-schema-acl.csv` | `db85170bddb5ee5f57564d8b72fe88fae771020e1d4df2aa9b2eafb82990176d`；一致 | `f157d8ce6e8ab817166e0f910d29a1d1c87e27075e3c5c5e72e4bc2d463a0456` | 7 / 12 | PARTIALLY_VERIFIED |
| A4-9 / `A4-9-effective-schema.csv` | **规范实算及 Manifest** `e915c936eaff1356335fe298cdcd4cf049bb854c51caa11cf7e2d35f462e3b91`；旧值 `7e2a1c7332293527baa100607640f69db079f55caacd39de378ebf106521a6ae` 含第二行标题注释及 LF（77 字节） | `c4e71306d14b645e338402dc35f00c58ebb066b7869e6780e636e76379a1deef` | 30 / 7 | **HASH_RECONCILED / PARTIALLY_VERIFIED** |
| A5-F1-1 / `A5-F1-1.csv` | `20ab76ff9122648d8b64942c8a8926e02dff4c654bd0d4207e363d41849999bb`；一致 | `a77671f23d5ecf554afbb3dee361e262a734196c09f2d7ad9fd9ec28ac4972d3` | 1 / 3 | PARTIALLY_VERIFIED |
| A5-F1-2 / `A5-F1-2.csv` | `7b29240b656e5386c876a6d0613d14a77916a9871db850e5b44d8a46eb1927cc`；一致 | `570c3c14bfea0d15fcbb6bd4cfd68e615a3b9898ad1ccd037b9d969bc3e8a3d6` | 10 / 5 | PARTIALLY_VERIFIED |
| A5-F1-3 / `A5-F1-3.csv` | `529b87ba18da2a5eed6f01a8dac1c48d6c1f4799b6f38e9eabe672a94cfa70bf`；一致 | `e9a550cae4901a172b41702f9fb2a93ce1d7d00b3529576a37d07a6937652869` | 6 / 5 | PARTIALLY_VERIFIED |
| A5-F1-4 / `A5-F1-4.csv` | `b87055eb6b6f318c6685af5e26a19921b65e8f1a258690498a43f66078f7252c`；一致 | `770e4052f74749a07c173e6fe0b852377948b65bd93a9b46c19aab0f2e0913eb` | 96 / 6 | PARTIALLY_VERIFIED |
| A5-F1-5 / `A5-F1-5.csv` | `397423751a0a6cbeecfdf8f5cd385eca933a84a394ed1c7371e8f2891e86cfa7`；一致 | `d63e25cd0e4362ebf2e8f89fd973b909ce9432f9a54b009f19b24acbcde30996` | 4 / 4 | PARTIALLY_VERIFIED |
| A5-F1-6 / `A5-F1-6.csv` | `453fd800381641777e3bdcdb48b2e8c5b672894c1cad9fbb01b9b70739fd08a6`；一致 | `0d92af25c79b0aeb16b2ac562d701f264f1bb39c36b7ab48c229460e9df44ea1` | 1 / 3 | PARTIALLY_VERIFIED |

十份 CSV 均非空，UTF-8 CSV 解析成功；标题字段不重复，每条数据的字段数与标题一致，没有空数据行或重复标题行。标题字段与 Manifest 的各查询预期字段逐一一致，行列数与 A5-F4 报告一致。所有文件均**没有末尾换行符**；最后一条记录可完整解析，单凭这一格式现象不能判定截断，也不能证明导出未被截断。文件哈希一致只绑定当前本地字节版本，**不证明**该 SQL 曾在指定项目、身份和时间执行，更不证明权限安全。

## 3. 现场执行与签署待补链

| 需绑定材料 | 当前状态 | 完成所需证据 |
| --- | --- | --- |
| SQL Editor 项目名称、Ref、数据库及 PostgreSQL 版本 | PARTIALLY_VERIFIED：项目及版本来自交接陈述；数据库名来自 CSV | 可复核的现场身份截图或执行记录，连同受信项目清单中的 Ref |
| 身份核对截图 | EVIDENCE_UNAVAILABLE：关联的 ChatGPT 项目对话存在图片上传记录，但当前读取接口未返回图片内容；本地取证目录未找到图片 | 原图、来源消息或受限证据位置、图片 SHA-256；独立复核人核对显示内容 |
| 每条查询的执行身份、UTC 时间与成功记录 | PENDING | 十条逐条 SQL Editor 执行日志／截图或等价受控记录，记录查询 ID、身份、UTC 时间和成功状态 |
| 每条已执行 SQL 与对应 CSV 的一一绑定 | PENDING；A4-9 的本地登记哈希已修正，但执行版本仍未验证 | 对照现场保存的 SQL 原文／哈希、导出动作与结果文件；不得把 `HASH_RECONCILED` 当作 `EXECUTION_PROVENANCE_VERIFIED` |
| 采集者、独立复核者、项目审批负责人 | PENDING | 姓名、职责、签署时间及下方结论；不得以本报告代签 |

项目负责人／签署时间（UTC）：________________ / ________________

人工采集者／签署时间（UTC）：________________ / ________________

独立复核者／签署时间（UTC）：________________ / ________________

最终来源核验结论（VERIFIED / PARTIALLY_VERIFIED / BLOCKED）：________________

权限基线审批结论及批准范围：________________

## 4. 权限审批缺口与阶段边界

复用 A5-F4 报告中的完整矩阵：30 个角色与 24 条成员关系已离线核对，**尚未逐项正式批准**。当前数据库 `PUBLIC` 的 CONNECT、TEMPORARY 及 `public` Schema 的 USAGE 是已观察 ACL；平台高权限角色、BYPASSRLS、ADMIN option 和 SET ROLE 路径仍需项目及平台依据。`catalog_audit_meta` 在 A5-F1-3 结果中不存在，不能验证其有效权限。现行 A6 专用审计身份契约及检查器的 PUBLIC TEMP 阻断条件尚未修改。

**A5** 可单独记录“CSV 内容与结构已离线审查”，但来源链及权限基线不得签成通过。**A6** 需另行完成项目身份、执行身份与权限边界签署，处理既有契约差异并获得单独只读执行授权。角色创建、权限修改、数据库写入和迁移均不在本登记授权范围内。
