# Sprint 2.7-A6-D7-P2 — 旧 Catalog 检查器集成设计（草案）

**状态：DESIGN ONLY / NOT_INTEGRATED。** 本文仅规划如何在 A6-D6 链路中保留旧 Catalog-only 安全断言；不批准修改检查器、执行 SQL、迁移或正式 A6 快照。现阶段仍为 `EVIDENCE_COLLECTED / PROVENANCE_PENDING / BASELINE_NOT_APPROVED / A6_BLOCKED`。D1 的正式 Overall 恒为 `BLOCKED`，来源认证和原始导出完整性均为 `UNVERIFIED`。

## 1. 现状和判定口径

旧入口是 `checkCatalogPermissionSnapshot(rows,{profile:"catalog-only",stage,migrationVersions,adminIdentity})`（`scripts/check-catalog-supabase-snapshot.mjs:523-529`）。D1 只在 B1 通过和证据重读校验后调用 C1（`scripts/catalog-a6-validation-pipeline.mjs:79-156`），没有调用旧入口，返回 `legacyCheckerStatus:"NOT_INTEGRATED"`。C1 主要比较已签角色、成员、ACL、PUBLIC／有效数据库和 Schema 权限及 SET ROLE 路径；未覆盖旧检查器全部对象、RLS、函数、迁移版本和运行时权限断言。B1 核证据包结构、计数、OID 身份与哈希；其 `INTERNAL_CONSISTENCY_PASS` 不等于安全规则 PASS。

下表状态定义：**COVERED** = A1 提供字段、B1 核相关结构、C1 已有对应规则且 D1 已执行等价旧断言，四项全满足；**PARTIAL** = C1 已覆盖其中一部分，但旧断言仍未接入；**NOT_INTEGRATED** = 对应旧断言在 D1 中基本没有等价执行。按此严格口径，尚无任何一项旧规则可称正式 COVERED。每项的最小适配均以 B1 已通过的原始快照为前提；不得通过改写证据包掩盖异常。

## 2. 旧规则覆盖矩阵

| 旧规则及位置 | 所需数据；A1 SQL | B1 完整性 | C1 规则；D1 调用 | 当前状态与最小适配 |
| --- | --- | --- | --- | --- |
| **Catalog-only 阶段**：旧 `:51-57,141-190,220-285` | 阶段 `empty/foundation/admin-read`、Admin Identity `absent/present` 是独立签署输入；A1 `business_inventory`、`business_object`、`schema`、`role`、`relation`、`policy` 提供目标结构（SQL `:72-166`） | B1 核 section、行键、计数及必需公共标记（B1 `:199-305`），不判断所选阶段的应有对象 | C1 无阶段参数或 Catalog-only 对象集合；D1 不调旧规则 | **NOT_INTEGRATED**。从独立批准的阶段／Admin Identity 输入运行旧 `catalog-only` 分支；不得把 `empty` 与迁移前 `foundation` 混为一谈 |
| **Admin Read 阶段**：旧 `:178-190,280-311,366-382,461-492` | `catalog_admin_reader_runtime` 角色和策略、admin schema／表、有效表／Schema／函数权限；A1 提供角色、`policy`、`relation`、`effective_*`、`function_effective`／`rfq_function_effective`（SQL `:119-166,346-418`） | B1 保证字段形状和部分角色／Schema 对应；不校验六项 SELECT 策略、强制 RLS 或每条有效权限语义 | C1 覆盖角色和数据库／Schema 有效权限一部分，不覆盖策略、表和函数全套；D1 不调旧规则 | **PARTIAL**。保持 `foundation` 为迁移前、`admin-read` 为迁移后；用旧规则检查相应阶段，缺失任何策略或权限行即阻断 |
| **Migration History**：旧 Catalog-only `:125-140`（`:500-519` 属另一 profile），阶段集合见 [ADR](catalog-a6-controlled-snapshot-adr.md) | A1 仅有 `migration_registry.exists`（SQL `:115-117`）；没有 version-only 列表。非空阶段要独立、完整、唯一的 14 位版本集；`empty absent` 可在注册表缺失证据下使用已验证空集 | B1 仅核 registry 行形状，不认证历史查询、结果、完整性或其与快照同目标／会话的绑定 | C1 无版本比较；D1 无历史输入也不调旧检查器 | **NOT_INTEGRATED**。将获批准的 version-only 结果作为独立证据工件做来源、哈希、行数、唯一性及目标绑定；缺失时旧检查器不得运行成 PASS，不能用 `[]` 代替未采集历史 |
| **RLS 强制状态与策略**：旧 `:286-305,337-385` | A1 `relation.rls_enabled/rls_forced`、`policy` 命令／角色／表达式标志与哈希、视图列／所有者／屏障／过滤提示（SQL `:125-158`） | B1 核字段和快照行结构，不证明表达式语义或旧规则要求的表／策略集合 | C1 未比较 RLS／策略／视图；D1 不调旧规则 | **NOT_INTEGRATED**。复用旧 Catalog-only 与 shared core 的表和策略阻断，保留 `admin_private.admin_users` 的 `rls_forced` 检查；表达式哈希另需人工语义核查 |
| **SECURITY DEFINER 函数**：旧 `:389-430` | A1 `function` 的签名、owner、`security_definer`、`search_path`、kind 和 `function_acl`／有效调用者（SQL `:346-386`） | B1 核字段与 ACL 的部分身份引用，不证明函数清单、owner 或 `search_path` 合规 | C1 不比较函数；D1 不调旧规则 | **NOT_INTEGRATED**。保留 Foundation／receipt 函数的精确所有者、`SECURITY DEFINER` 与 `search_path` 断言；未知函数或路径阻断 |
| **函数 EXECUTE 权限**：旧 `:399-458,480-491` | A1 `function_acl`、`function_effective`、`rfq_function_effective`（SQL `:355-386`） | B1 校验 `function_acl` 的角色/OID 和签名存在，未覆盖所有预期有效调用行或授权语义 | C1 无函数 ACL／EXECUTE 比较；D1 不调旧规则 | **NOT_INTEGRATED**。旧规则核 PUBLIC EXECUTE、异常 grantee、receipt／RFQ 调用者及运行时函数权限；缺失有效行不得解释为 false |
| **业务表与视图权限**：旧 `:147-176,243-276,337-385` | A1 `business_object`、`relation`、`relation_acl`、`effective_relation` 和视图元数据（SQL `:87-158,285-299,409-418`） | B1 核 section、行键、关联存在和部分 ACL 主体；不核表／视图权限 allowlist 或视图语义 | C1 无关系 ACL／有效表权限比较；D1 不调旧规则 | **NOT_INTEGRATED**。保留缺失／额外对象、表 ACL、匿名访问、视图 owner／列／屏障／过滤检查；视图哈希变更由人工复核 |
| **运行时读取角色权限**：旧 `:461-492` | A1 `role`、`effective_database`、`effective_schema`、`effective_relation`、`function_effective`／`rfq_function_effective`（SQL `:160-166,370-418`） | B1 核角色／Schema 身份与行结构，未保证缺失的表／函数有效行一定被发现 | C1 核部分数据库／Schema 权限及 TEMP 冲突；D1 只调用 C1 | **PARTIAL**。迁移后必须复用旧 CONNECT、CREATE、TEMP、Schema、表写入、receipt 与函数／RFQ EXECUTE 断言；迁移前断言角色尚不存在 |
| **PUBLIC CREATE/TEMP**：旧 `:195-219,494-496` | A1 `database_acl`、`public_database_privilege`、`schema_acl`、`public_schema_privilege`、`effective_database`（SQL `:184-283,388-407`） | B1 核数据库／Schema ACL 来源、按 Schema 计数和主体 OID，不决定风险可接受性 | C1 对已签基线比较 PUBLIC 和有效权限，并在运行时角色存在时阻断 TEMP；D1 调 C1，但不调旧无条件 PUBLIC TEMP 阻断 | **PARTIAL**。保留旧 PUBLIC CREATE/TEMP 和 public Schema CREATE 阻断；SQL Editor 操作员 TEMP 风险接受不能转移给运行时角色；旧断言冲突须另行批准处置 |
| **缺失、异常、未知对象／权限**：旧 `:65-123,141-219,243-311,323-519` | A1 动态清单、对象、ACL、角色和有效权限等（SQL `:72-158,160-466`） | B1 核 section inventory、重复键、OID、文件哈希及部分交叉一致性；不判断全部业务 allowlist | C1 比较其纳入的角色／成员／ACL 权限，对 RLS、函数、关系和版本无完整规则；D1 调 C1、不调旧规则 | **PARTIAL**。旧检查器所有 BLOCK findings 必须并入最终安全结果；异常、转换丢失或未映射规则均失败闭锁 |

以上 `旧 :行号` 均指 `scripts/check-catalog-supabase-snapshot.mjs`；`B1 :行号` 指 `scripts/catalog-a6-evidence-validator.mjs`；`SQL :行号` 指 `scripts/catalog-supabase-permission-snapshot.sql`。行号用于定位现有代码，不是批准记录。

## 3. 快照字段兼容性与无损适配条件

| 差异 | 影响 | 适配约束 |
| --- | --- | --- |
| A1 `membership.item=membership_oid`；旧检查器要求 `item=member->parent`（旧 `:111-117`） | 原始 A1 JSONL 直接传入旧检查器会报 `SNAPSHOT_INCOMPLETE` | 仅对**已通过 B1**的内存克隆建立旧视图，按已验证姓名构造旧 item 及相应 `row_key`；保留原始行、OID、grantor 和三个选项用于 B1/C1。若两条 OID 边映射为同一 `member->parent`，不得合并或覆盖，返回适配失败并阻断；需另行审查旧检查器的多授权者支持 |
| A1 行包含 `row_key`、OID 和 ACL 来源等新字段 | 旧检查器按 `section/item/data` 读取，额外字段通常可保留；它自身只比较部分语义 | 适配器不能改原始证据、ACL 值、角色名或权限布尔值；内存视图的行数与 section 分布必须与 B1 已验证原件一致，并记录适配版本／输入哈希 |
| A1 使用 `section_inventory`、NULL／内建默认 ACL 显式标记；旧检查器还要求数据库及 public Schema ACL 计数至少 1（旧 `:74-92`） | 合法零行或格式差异可能被旧规则阻断 | 不补造 ACL 行或把 NULL 解释为无权限。若旧假设与真实快照冲突，维持 BLOCKED，另行审查并批准旧规则修订 |
| A1 仅报告迁移注册表是否存在；D6 bundle 只接受一条 `snapshot` 查询（B1 `:538-560`） | 旧检查器无法获得可信版本数组；`empty absent` 的合法空集也必须由注册表缺失与空历史证据确认 | 下一阶段先设计并审查第二条 version-only 查询的证据契约，扩展 B1 与 D1 的绑定、完整性及失败闭锁；版本文件不得仅由调用者口头提供 |
| 旧 `catalog-only` 包含无条件 `UNREVIEWED_ROLE_MEMBERSHIP` 和固定平台角色审查（旧 `:183-194`） | A5 历史 24 条成员关系尚未获批，当前真实目标很可能被旧规则持续阻断 | 保留阻断。签署精确基线后，如需接受特定平台边，须单独批准旧规则的最小修订及反例；适配器不得过滤成员或把旧 BLOCK 改为 WARN |
| 旧规则 `empty/foundation/admin-read` 与 D6 C1 无阶段概念 | 直接以 C1 PASS 推断迁移前／后安全会越界 | 阶段、Admin Identity 和精确迁移版本集由独立审批输入确定；迁移前不执行迁移后断言，迁移后不得沿用迁移前 PASS |

## 4. 集成方式比较与推荐

| 方式 | 修改面与可测试性 | 主要风险 | 决定 |
| --- | --- | --- | --- |
| 直接改造旧检查器读取 A1 | 旧规则本体和测试需改；成员键、NULL ACL、历史及阶段都进入旧代码 | 容易无意改变旧调用者行为或放松旧 BLOCK | 暂不选 |
| **独立兼容适配器调用旧检查器** | 新模块只做已验证输入的无损视图、阶段／历史证据检查和旧函数调用；D1 加一处受控调用并单独测试 | 非单射成员键与旧无条件成员阻断仍会 BLOCKED，必须显式呈现 | **推荐**：保留旧代码和断言，改动面最小，失败闭锁可独立测试 |
| 抽出旧规则为可复用模块 | 需重构大量旧检查器及已有入口／测试 | 回归面最大；规则搬移时可能漏掉隐含条件 | 仅在已批准适配器无法无损表达时再申请 |

**拟议调用顺序（未来实现，当前未执行）：** B1 验证完整原件和独立 policy 锚 → D1 固定读取同一份已验证 JSONL 字节 → 验证独立的阶段、Admin Identity 与 version-only 历史证据 → 无损内存适配 → 调用旧 `catalog-only` 检查器 → 仅在证据仍未变化时调用／汇总 C1。旧检查器抛错、返回非 `PASS`、适配非单射、历史缺失或任一重读哈希变化，均记录 `LEGACY_BLOCKED`／具体 finding，C1 可不运行且正式 Overall 必须 BLOCKED。旧 PASS 只满足一个安全子闸口；C1 的已签基线、来源认证、原始导出完整性和人工批准仍各自独立。不得在兼容视图上重新计算并替换原始证据哈希。

**已知边界：** 当前旧检查器对每条成员关系无条件发 `UNREVIEWED_ROLE_MEMBERSHIP`（旧 `:191-194`），所以适配器本身不能让含成员关系的目标获得旧 PASS。应先完成目标特定成员基线审批；如审批结论允许部分边，另开受控任务修改旧规则并证明未批准边继续阻断。适配器的完成与旧规则的正式集成验收是两个不同结论。

## 5. 下一阶段最小文件计划与验证

下列是**预计**修改面，不是本轮授权：

1. 新增 `scripts/catalog-a6-legacy-adapter.mjs` 与 `scripts/test-catalog-a6-legacy-adapter.mjs`：纯函数适配、非单射／缺字段阻断、旧 Catalog-only 调用和 finding 映射；旧 checker 文件先保持不变。
2. 修改 `scripts/catalog-a6-evidence-validator.mjs` 与其测试：在单条快照既有合同之外，独立验证经批准的 version-only 查询及其原始导出、JSONL、执行记录、目标／身份、哈希与行数；保留 `empty absent` 的受证据支持的空历史语义。若后续选择独立历史证据验证器，须在设计审查中说明等价绑定，不得只传裸数组。
3. 修改 `scripts/catalog-a6-validation-pipeline.mjs` 与其测试：接入旧结果、阶段及历史信任锚；保证 B1 或重读失败时旧 checker/C1 均不运行；旧 BLOCK、异常或未集成时 `legacyCheckerStatus` 非通过、正式 Overall BLOCKED；保留既有来源和原始导出未验证状态。
4. 仅在基线签署后确有必要时，另行申请修改 `scripts/check-catalog-supabase-snapshot.mjs` 及其定向测试，以处理已批准的平台成员／角色和多授权者边；不得借适配器静默删断言。A1 SQL 与 C1 默认不需改动，若发现字段不足须先报告并重新审批范围。

最少反例：OID 行键映射冲突、两条不同 grantor 的同名边、缺失／重复历史版本、`empty absent` 无注册表证明、stage 与 Admin Identity 不符、RLS 关闭／强制状态错误、额外策略／函数／EXECUTE、匿名私表 SELECT、运行时写权限、PUBLIC CREATE/TEMP、旧 checker 抛错或返回 BLOCKED、B1 后文件变化。正例须覆盖合法阶段组合和受证据证明的空历史；不能用合成测试宣称真实 SQL Editor 来源已认证。

## 6. 安全边界与剩余审批

- 旧检查器保持启用目标；现状 `NOT_INTEGRATED` 不可改写为通过。任何旧安全断言的删减、WARN 化或例外化需独立设计和批准。
- SQL Editor 执行身份的高权限／TEMP 风险与 `catalog_admin_reader_runtime` 的有效 TEMP=false 是两条不同约束。历史 `PUBLIC TEMP=true` 冲突未解，禁止执行 Admin Read 迁移，不能用操作员风险接受转移给运行时角色。
- 未获签署的 A5 权限基线不得让 C1 产生正式安全接受。旧规则 PASS、C1 PASS 或 124 项离线测试也不能替代项目 Ref、每次执行来源、完整原始导出与人工审批。
- 来源认证 `UNVERIFIED`、原始导出完整性 `UNVERIFIED` 时，正式 Overall 必须保持 `BLOCKED`；此设计不新增正式 PASS 路径。
- 后续仍需独立完成 `CONTRACT_APPROVED`、`LEGACY_RULES_INTEGRATED`、`EXECUTION_AUTHORIZED`、`EVIDENCE_AUTHENTICATED`、`RAW_EXPORT_VERIFIED`、`SECURITY_BASELINE_APPROVED`；迁移另需 `MIGRATION_AUTHORIZED`。各闸口的材料、责任及停止条件见 [D7-P1 清单](catalog-a6-d7-execution-readiness-checklist.md)。
