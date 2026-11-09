# Sprint 2.7-A6-D7-P1 — A6 正式执行准入清单（审批草案）

**文档状态：DRAFT / NOT APPROVED。** 本清单供项目负责人、数据库安全负责人和独立复核者逐项决策；它本身不授予 SQL Editor 使用、数据库访问、权限变更或迁移许可。当前阶段状态保持 `EVIDENCE_COLLECTED / PROVENANCE_PENDING / BASELINE_NOT_APPROVED / A6_BLOCKED`。所有未填写的身份、证据编号和签署字段均须由责任人据实填写。

**目标候选信息：** `beauty-b2b-catalog-dev`，Project Ref `nnmdcezigmguqolbxzmb`，数据库 `postgres`，预期 PostgreSQL 17.11。这些值来自交接材料，尚不是本次 A6 会话的现场认证。审批时逐项记录“材料位置／哈希、复核者、结论、UTC 时间”；空白或无法复核均按未满足处理。

## A. 执行契约：先签署，再申请单次执行

| 检查项 | 当前状态 | 所需证据与完成标准 | 责任与未满足时动作 |
| --- | --- | --- | --- |
| 方案 B 及旧契约偏差 | **PENDING**：D0 仅接受设计方向；[A6 ADR](catalog-a6-controlled-snapshot-adr.md) 仍为提案 | 签署一次性、人工操作的 Supabase SQL Editor 元数据查询契约。明确替代旧契约的专用审计身份、直连／连接池主机、已验证 TLS、连接只读和同一 `BEGIN READ ONLY` 事务的部分；不能证明的属性逐项记为偏差，不得默认为满足 | 项目负责人和数据库安全负责人共同批准偏差及剩余风险；未签署则 **BLOCKED**，不得执行 |
| 操作员及实际数据库身份 | **UNVERIFIED** | 具名 Dashboard 操作员、账号、访问途径、预期和实得 `current_user`／`session_user`、会话时间窗及可用权限边界；独立复核者具名。SQL Editor 可能使用高权限身份，查询白名单是操作控制，不等于数据库强制只读 | 项目负责人指定，数据库安全负责人核查，独立复核者见证；身份或权限边界不明则停止 |
| 目标身份 | **UNVERIFIED** | 从受信项目清单与现场 SQL Editor 项目上下文交叉确认项目名、Ref、环境、数据库及完整 `server_version`；另行批准身份检查查询，记录 UTC 时间。数据库自报和 A5 旧截图均不足以绑定本次每条查询 | 项目负责人签目标，操作员采集，独立复核者验证；任何不一致即停止 |
| 查询字节与函数安全 | **PENDING** | 对每条允许查询登记 ID、用途、版本、完整 UTF-8 可执行文本、起止边界、注释／空白／分号／换行规则和 SHA-256，并由独立审查者确认实际解析的函数及参数仅属批准的只读元数据范围。A1 文件当前完整字节 SHA-256 为 `0c7fcb350dd319403726a7861e5fa64d1632007f9b6952ee7febac72e7f57d5c`，仅是本地候选值，**不是已批准 SQL 哈希**；批准前须重算并签署。版本记录为 `catalog-a6-scheme-b-v1` | 数据库安全负责人审查，项目负责人签查询清单，独立复核者核字节；粘贴后若一字节改变，重新审查批准；否则停止 |
| 允许范围及禁止动作 | **PENDING** | 仅独立批准的身份检查、元数据快照和在迁移注册表存在且获准读取时的**仅 version** 历史查询。禁止业务表行、RFQ／客户资料、Auth 数据、凭据、函数体、迁移正文，以及 DDL／DML、动态 SQL、角色／ACL／RLS 修改、迁移、未列入白名单或可能有副作用的函数 | 数据库安全负责人签白名单和函数解析结果；出现越界查询或更改企图立即停止 |
| 导出与会话记录能力 | **UNVERIFIED** | 执行前证明 SQL Editor 能保存**实际完整执行语句**、查询 ID、唯一执行 ID、项目 Ref、操作员与 DB 身份、UTC 执行时间、成功／错误、列名和类型、行数、结果限制／分页设置及完整原始导出。约定原始格式、受限存储位置和保留期限；若转 JSONL，保存原件及两者哈希和转换记录 | 操作员演示，独立复核者确认，安全负责人批准存储；无法证明完整性或原文绑定则停止，不可凭截图／重算哈希补链 |
| 单条执行与失败停止 | **PENDING** | 每次仅执行已签版本的一条查询，保留完整执行记录和导出的一一绑定。项目、身份、SQL 哈希不符，查询失败，输出缺失／截断，来源不明，权限／成员／RLS 异常，或审批缺失时立即停止；分页或重跑需新批准，不得现场修补权限 | 操作员执行停止规则，独立复核者记录；任何失败不得进入正式安全接受 |

批准查询登记（执行前逐条填写；现无已批准条目）：

| 查询 ID／用途 | 版本及完整文本受控位置 | SHA-256（完整 UTF-8 字节） | 函数审查记录 | 项目／安全双签及 UTC 时间 |
| --- | --- | --- | --- | --- |
| ______ | ______ | ______ | ______ | ______ |

## B. A5 历史权限证据：采集不等于来源或基线批准

| 检查项 | 当前状态 | 解除条件及责任 |
| --- | --- | --- |
| 十份历史 CSV | **EVIDENCE_COLLECTED**：A4-6、A4-7、A4-8、A4-9、A5-F1-1 至 A5-F1-6 的本地字节、结构、行列数已核对；A4-9 SQL 规范哈希已勘误 | 逐份使用[来源登记](catalog-a5-evidence-provenance.md)核对，不把文件名、下载时间或包内哈希当成现场执行证明；采集者与独立复核者签署 |
| 来源链 | **PROVENANCE_PENDING** | 逐次绑定受信 Project Ref、实际 SQL 全文／哈希、SQL Editor 身份、UTC 时间、成功日志、唯一执行 ID、原始 CSV 和其哈希；A4-6 至 A4-9 为重建查询，须说明原始 A4 SQL 缺失及其影响。项目负责人和独立复核者分别签结论；未补链不得升级来源状态 |
| 角色、成员及高权限路径 | **BASELINE_NOT_APPROVED**：历史观察 30 个角色、24 条成员关系；包括高权限角色、BYPASSRLS、ADMIN／INHERIT／SET 选项及多跳 SET ROLE 路径 | 数据库安全负责人逐项解释并批准精确角色属性、成员／父角色／授权者与三个选项及高权限路径；项目负责人接受剩余风险，独立复核者签核。30／24 仅是该次完整性参照，**不是永久角色数量规则** |
| 数据库 PUBLIC 权限 | **REVIEW_PENDING**：历史证据记录 CONNECT=true、TEMP=true；CREATE 须逐项按原证据和新快照核对，不能由本草案假定 | 安全负责人逐项给出 CONNECT／TEMP／CREATE 的批准或阻断结论及有效权限链；TEMP 另见 E 节 |
| Schema PUBLIC 权限及默认 ACL | **REVIEW_PENDING**：历史 `public` Schema PUBLIC USAGE 已观察；CREATE、其他 Schema 和显式／NULL／内建默认 ACL 须逐项核对 | 安全负责人签 Schema PUBLIC USAGE／CREATE、所有显式默认 ACL、内建参考与实际有效权限的精确清单；独立复核者检查差异与未知授予 |
| 人工签署 | **PENDING** | 项目负责人、采集者、数据库安全负责人和独立复核者按各自范围签身份、UTC 时间、证据索引和结论；[A5 签署摘要](catalog-a5-signoff.md)目前仍待签 |

完整历史 CSV、截图和日志保留在受限证据位置，不放入本文件或 Git。历史 A5 的来源补链与新 A6 执行证据是不同审批对象，不能相互代替。

## C. A6-D6 工具状态与证明边界

| 组件 | 已完成的本地能力 | 尚需的正式证明 |
| --- | --- | --- |
| A1 快照 SQL | 已形成单条候选元数据查询；记录数据库／会话身份、角色与成员 OID、ACL 来源、动态计数等；结构测试 **9/9 PASS** | 精确 SQL 字节及函数安全审批、现场目标及执行身份、实际完整导出；未执行正式 A6 SQL |
| B1 Evidence Validator | 本地证据包内部一致性、名称／OID、逐 Schema ACL 计数、哈希及导出映射校验；合成测试 **50/50 PASS** | 独立来源认证和原始导出完整性人工核验；内部一致性 PASS 不能认证 SQL Editor 来源 |
| C1 Security Baseline Validator | 对签名基线的角色／成员／ACL／有效权限／SET ROLE 路径做离线比较；合成测试 **34/34 PASS** | 真实目标的逐项签署基线及独立信任锚；`PENDING`、错误签名或仅合成批准均不得产生正式安全接受 |
| D1 Validation Pipeline | 证据变更或 B1 阻断时不运行 C1；合成测试 **31/31 PASS** | 旧规则接入、真实来源认证及完整原始导出证明。当前 `sourceAuthenticationStatus=SOURCE_AUTHENTICATION_UNVERIFIED`、`rawExportCompletenessStatus=RAW_EXPORT_COMPLETENESS_UNVERIFIED`、`legacyCheckerStatus=NOT_INTEGRATED`、正式 `overallStatus=BLOCKED` |

合计 **124/124 离线合成测试**已通过，证明的是本地实现的受测行为；不证明真实数据库执行、项目归属、现场导出完整性或权限审批。正式 Overall 目前没有 PASS 路径；不得通过改写标签或使用 `SYNTHETIC_MATCH_ONLY` 提前放行。

## D. 旧安全规则逐项对照与接入责任

旧检查器为 [`scripts/check-catalog-supabase-snapshot.mjs`](../scripts/check-catalog-supabase-snapshot.mjs)，D1 当前**没有调用它**。下表“D6 覆盖”指现有本地代码范围，不代表等价的正式验收。负责人须以获认证的同一目标证据完成可复核的规则对照、格式适配和阻断测试；旧检查器的 PASS 也不能单独替代来源或审批签署。

| 规则 | 旧 Catalog-only 检查器 | D6 现状及缺口 | 后续责任／停止条件 |
| --- | --- | --- | --- |
| Catalog-only 阶段 | 要求 `empty`／`foundation`／`admin-read` 及 Admin Identity `absent`／`present`；按阶段核对象和角色 | D6 校验快照结构与基线目标，但 D1 未选择或运行旧 profile | 项目负责人签阶段和 Admin Identity；工程负责人接入旧规则或经独立证明的等价规则。未知阶段／对象则阻断 |
| Admin Read | 要求运行时角色状态、六项 SELECT 策略、只读有效表／Schema／函数权限 | C1 比对部分角色与有效数据库／Schema 权限，不覆盖全部旧 Admin Read、策略和对象断言 | 数据库安全负责人审查角色与策略；工程负责人做覆盖对照。缺少任一断言则阻断 Admin Read 接受 |
| RLS 与公开视图 | 核六张私表 RLS、策略、公开视图所有者／列／屏障／发布过滤等 | A1 有相关元数据，B1 主要核证据结构；C1 未形成完整 RLS／视图语义基线 | 独立复核者与安全负责人核政策及视图哈希／语义；缺失、扩大或不明则阻断 |
| 函数及 `SECURITY DEFINER` | 核函数清单、所有者、`SECURITY DEFINER`、`search_path`、ACL 和有效调用者，含 receipt 例外 | A1/B1 采集并验证部分身份与字段；C1 未完整比较函数安全语义 | 安全负责人审函数和调用路径；未知函数、执行者或搜索路径则阻断 |
| 迁移版本 | 独立 version-only 结果须与所签阶段的精确集合一致；`empty absent` 可记录注册表不存在和空历史 | D6 单一快照包尚无 version-only 历史接入，也未跑旧版本集合规则 | 项目负责人签版本集合，安全负责人批准独立历史查询，独立复核者核完整结果；缺失／额外／重复版本则阻断 |
| 运行时角色权限 | 核 `catalog_admin_reader_runtime` 的 CONNECT、CREATE、TEMP、Schema／表写入和函数权限 | C1 核数据库／Schema 有效权限与 TEMP 冲突，未替代旧表、函数与 RFQ 权限断言 | 安全负责人逐项确认旧规则仍生效；任何写入、DDL、TEMP 或未知执行权阻断 |
| PUBLIC TEMP | 旧规则无条件阻断 PUBLIC TEMP／CREATE；Admin Read 还要求运行时有效 TEMP=false | C1 保留 `RUNTIME_TEMP_CONFLICT`，未形成可批准的兼容方案 | 按 E 节独立安全决策；冲突未解不得批准基线或迁移 |
| 异常阻断与格式适配 | 旧规则阻断缺失／重复对象、未知成员、ACL、权限或迁移漂移 | B1/D1 可阻断证据完整性错误，但旧检查器预期成员 `item=member->parent`，A1 输出 `item=membership_oid`；直接复用同一 JSONL 不等价 | 工程负责人提出可审查的适配／集成方案并做正反例验证，独立复核者验收；不得静默跳过、重排或丢失成员关系 |

## E. 运行时 TEMP：独立安全阻断项

历史 A5 证据记录当前数据库 `PUBLIC TEMP=true`。旧 Catalog-only 契约要求 `catalog_admin_reader_runtime` 在 `admin-read` 阶段有效 TEMP=false；Admin Read 迁移自身也有 TEMP=false 断言。PUBLIC 授权可使未来角色获得 TEMP，有效权限不能靠撤销该角色的直接授权或设置 `NOINHERIT` 消除。未来运行时状态仍须在获准的目标环境核验。

**当前结论：`RUNTIME_TEMP_CONFLICT / BLOCKED`。** 尚无已批准兼容方案。不得直接撤销 PUBLIC TEMP，不得删除／放松 TEMP=false 断言，不得执行 Admin Read 迁移。解除条件：数据库安全负责人完成 Supabase 平台依赖与风险评估，项目负责人和安全负责人另行签署所选方案及必要的权限／架构／契约变更授权，独立复核者以新证据确认运行时约束和旧规则相容。仅批准 A6 只读取证也不会自动解除本项。

## F. 正式审批闸口矩阵

`DONE_LOCAL` 仅用于已完成的离线实现；`PENDING`、`UNVERIFIED` 和 `BLOCKED` 均不得解释为正式批准。每一闸口需有独立审批记录、证据索引、结论和 UTC 时间。后置闸口不得反推前置闸口已通过。

| 闸口 | 当前状态 | 所需材料 | 责任角色与完成标准 | 不满足时停止条件 |
| --- | --- | --- | --- | --- |
| `CONTRACT_APPROVED` | **PENDING** | 签署的方案 B ADR／执行协议、旧连接契约偏差、操作员与 DB 身份、查询及导出控制、高权限风险接受 | 项目负责人＋数据库安全负责人共同批准，独立复核者核范围 | 未双签或偏差不明：不得执行 |
| `IMPLEMENTATION_VERIFIED` | **D6 DONE_LOCAL；正式闸口 PENDING** | A1/B1/C1/D1 版本、R2 独立复审记录、124 项结果、批准契约与实现逐项对照 | 独立复核者签工具符合**已批准**契约；不要求重做已完成原型 | 契约未批准或有未解释差异：不得称正式实现验收完成 |
| `LEGACY_RULES_INTEGRATED` | **BLOCKED / NOT_INTEGRATED** | D 节逐项映射、成员行键适配、Catalog-only 阶段和 version-only 历史、旧规则正反例结果 | 工程负责人交付，数据库安全负责人及独立复核者验收无规则丢失 | 任一旧阻断规则缺失或未验证：不得给正式安全 PASS |
| `EXECUTION_AUTHORIZED` | **BLOCKED** | 单次书面授权：受信目标、具名操作员、会话窗口、实际 DB 身份、逐条全文 SQL 哈希、导出方式、存储及停止规则 | 项目负责人＋数据库安全负责人签署，独立复核者见证；只授权明确的只读元数据范围 | 缺任一签署、身份或 SQL 字节不符：不得启动 A6 |
| `EVIDENCE_AUTHENTICATED` | **UNVERIFIED** | 现场 Project Ref、每条实际执行 SQL、执行身份／UTC／成功记录、唯一 ID 与原始结果一一绑定；A5 来源另行补链 | 操作员采集，独立复核者核源并签结论 | 不能核实际执行或原件关联：Evidence 不得正式 PASS |
| `RAW_EXPORT_VERIFIED` | **UNVERIFIED** | 完整原始导出、行列与结果限制证明、文件哈希、受限存储和 JSONL 转换追溯 | 独立复核者逐条核完整性，安全负责人核保护方式 | 缺失、截断、转写不符或无法证明结果上限：阻断 |
| `SECURITY_BASELINE_APPROVED` | **BLOCKED / BASELINE_NOT_APPROVED** | 签署的精确角色／成员／ACL／默认 ACL／有效权限／SET ROLE 基线，旧规则结果，RLS／函数审查，TEMP 处置 | 数据库安全负责人逐项签、项目负责人接受风险、独立复核者确认签名与独立哈希信任锚 | 未批准基线、旧规则异常或 TEMP 冲突：不得安全接受 |
| `MIGRATION_AUTHORIZED` | **BLOCKED** | 独立迁移提案、目标前置快照、TEMP 兼容方案、回滚／影响评估和另行审批 | 项目负责人＋数据库安全负责人另行书面授权；A6 取证审批不包含迁移 | 任一前置条件不满足：不得执行迁移、GRANT／REVOKE 或改 RLS |

## G. 审批记录模板（每个闸口分别复制填写）

| 字段 | 待填写内容 |
| --- | --- |
| 闸口名称／审批编号 | ______ |
| 姓名或经确认的身份 | ______ |
| 审批角色（项目负责人／数据库安全负责人／独立复核者） | ______ |
| 批准范围与明确排除事项 | ______ |
| 适用项目、Ref、环境、数据库 | ______ |
| 对应 ADR／协议／证据／查询版本及全文 SHA-256 | ______ |
| 已审材料位置或受限证据索引、独立哈希信任锚 | ______ |
| 风险接受、限制条件、有效会话窗口与停止条件 | ______ |
| 决策（`APPROVE` / `REJECT` / `PENDING`） | ______ |
| 签名或可核验审批记录引用 | ______ |
| UTC 日期时间 | ______ |

分别保留三份具名审批记录；同一人多角色签署时须证明符合独立复核要求。空白模板、口头同意或 D6 合成测试结果均不能改变闸口状态。本清单完成后的下一步仅是人工审阅和签署决策，不自动触发正式取证或数据库操作。
