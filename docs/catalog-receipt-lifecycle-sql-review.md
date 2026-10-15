# Sprint 2.5-B4.5-D2-C2-A：回执生命周期 SQL 与锁安全审查

## 结论

**B：必须先修改 SQL 草案，再申请隔离 PostgreSQL 实测。** 本轮只审查代码与草案，没有连接数据库、执行迁移或运行清理。Git 基线为 `main` 的 `840027f8ce6ffb029f695a79d1e2213b32af772d`；D2 既有未提交修改保持原样。

阻断点有两个：

1. `purge_due_catalog_receipt_results` 直接调用等待型 `pg_advisory_xact_lock(725604510131)`。SQL 本身没有锁等待上限，维护执行器接口也没有强制设置 `lock_timeout` 或总事务超时。受限角色若直接调用函数，或未来适配器漏设超时，会无限等待正在执行的商品导入；任务堆积后可能占住连接。仅在设计文档中要求超时不足以约束实际调用。
2. 函数的候选查询、更新条件和 RLS 策略分别调用 `clock_timestamp()`。这不会提前清理未到期行，但“恰好 90 天”的判断缺少单次操作的固定时刻；`clock_timestamp()` 是易变表达式，其作为索引范围右值能否有效利用 `catalog_import_receipts_purge_due_idx` 也尚未验证。永久墓碑会使表持续增长，不能在未观察真实执行计划前声称批处理查询可扩展。

建议先将函数内的锁获取改为 `pg_try_advisory_xact_lock(725604510131)`：若未取得锁，以稳定的“维护繁忙”错误退出并让受控任务稍后重试，**不要返回 0**，以免将锁竞争误报为没有待清理记录。为行锁及表级锁补充函数级有界 `lock_timeout`，未来真实适配器在调用前还必须设置有界 `statement_timeout`、`transaction_timeout`，并以独立 PostgreSQL 测试证明两种超时真正生效。保持同一个全局锁键和先锁后读的顺序。

函数取得锁后记录一次数据库时刻，例如 `v_cutoff := clock_timestamp()`，并用它处理候选选择、更新复核和 `expired_at`。条件坚持 `result_purge_after < v_cutoff`，使等于 90 天的行保留结果。RLS 仍需使用数据库计算的到期条件，不得因为固定时刻而放宽；隔离库须验证 RLS 不会将未到期行暴露给函数所有者。用 `EXPLAIN (ANALYZE, BUFFERS)` 检查 100、1,000、10,000 及大量永久墓碑的合成数据下是否使用到期索引，并测量最大 500 行批次的锁占用时间。若索引未能有效使用，再审查 RLS 与谓词写法，不能为了查询速度删除到期条件。

## 当前锁与并发结构

| 路径 | 实际顺序与范围 | 审查结论 |
| --- | --- | --- |
| 商品导入 `postgres.ts` | `READ COMMITTED`；`SET LOCAL ROLE catalog_import`；设置锁、语句、空闲及事务超时；获取事务级 **全局** advisory lock `725604510131`；依次对 `categories`、`products`、`product_variants`、`product_categories`、`product_images`、`product_translations` 取 `SHARE ROW EXCLUSIVE` 表锁；之后查询受限回执、重新读快照、写商品和回执。 | 锁覆盖整个导入事务，不按 actor、商品或幂等键分区。唯一约束、快照复核及回执主键是最后保护。|
| 维护执行器 `receipt-maintenance.ts` | 授权后开事务；要求适配器先取得同一 catalog lock，再调用固定清理接口。接口只规定顺序，尚无 PostgreSQL 适配器和超时实现。 | 纯离线契约，不能据此声称生产连接、权限或超时已经生效。|
| 维护 SQL 草案 | 函数再次获取同一事务级 advisory lock；随后按 `(result_purge_after,actor_id,idempotency_key)` 排序，最多 500 行 `FOR UPDATE SKIP LOCKED`，更新到期回执。 | 若外层已持锁，同一事务再次获取安全；若直接调用，函数仍先于行锁获取全局锁。当前等待无界。|

**锁顺序未见合规路径内的逆序**：导入先全局锁再商品表，最后回执；维护先全局锁再回执行。两个维护任务和导入因此完全串行，`SKIP LOCKED` 在全部调用者遵守全局锁时基本不会分摊并发工作，只是处理绕过协议的其他事务持有行锁时的防御。不存在由这两条合规路径形成的已知锁循环；但其他写入者若先持回执行/商品表锁再等待该 advisory lock，仍可形成死锁或超时。所有未来商品及回执写入路径都须审计这一顺序。

全局互斥**并非 90 天清理的逻辑必需条件**：30 天重放窗口与严格超过 90 天的待清理行不重叠；回执主键永不删除，清理只更新已提交行，适当的行锁、状态谓词和 `SKIP LOCKED` 可以防止重复清理。但在真实 PostgreSQL 尚未证明行锁方案、RLS 和 `COMMIT_UNKNOWN` 兼容前，**保留全局锁作为首期方案**。其代价是每批最多 500 行清理会阻塞新导入，反之亦然；应通过非等待获取、短事务、批次上限、超时与监控控制。未来若要取消全局锁，需独立迁移与并发测试，覆盖同键重放、跨进程恢复、已过期墓碑、两维护进程和正在写入的导入事务。

## 90 天边界与数据不变性

现有表约束要求 `retry_until = completed_at + interval '30 days'`、`result_purge_after = completed_at + interval '90 days'`；`expired` 行必须 `result IS NULL`，且 `expired_at` 不早于到期时间。`restricted_v1` 使用数据库 `clock_timestamp() <= retry_until` 判定可重放。维护草案使用严格 `< clock_timestamp()`；按每次实际求值，在恰好 90 天时不可清理，超过后才可清理。建议固定一次数据库时刻，使一批内的边界语义一致；不能让客户端提交时钟。

维护函数只设置 `status='expired'`、`result=NULL`、`expired_at`；没有更新 `actor_id`、`idempotency_key`、`request_fingerprint`、`completed_at`、`retry_until` 或 `result_purge_after`。`(actor_id,idempotency_key)` 主键保留，原键不能再次插入。函数只选择 `status='committed'`；已清理行不会被重复选择。函数所有者的 UPDATE 列授权不包含身份、指纹和期限字段，其 RLS `USING` 只允许原状态为 `committed` 的到期行，`WITH CHECK` 只允许目标状态为 `expired`。因此非超级用户沿该接口不能把墓碑恢复为 committed；拥有表所有权或超级用户权限的运维操作不在此保证内，必须另行审计。

## 权限、函数与迁移审查

- 原始回执 SQL 创建 `catalog_receipt_maintenance` 为 `NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`，当前仍授予到期元数据的列级 SELECT 和三列 UPDATE，并启用 RLS/FORCE RLS。受限访问增量 SQL 撤销导入/管理角色的直接回执 SELECT，仅给 `catalog_import` 单键查询函数 EXECUTE。当前隔离库已应用前者；本轮未重新查询数据库状态。
- C1 草案另建 `catalog_receipt_lifecycle_owner`，同样 NOLOGIN、非超级用户、无 BYPASSRLS；只授予到期元数据 SELECT 与 `status/result/expired_at` UPDATE，不授予 `result` SELECT、DELETE、商品表或 RFQ 权限。`SECURITY DEFINER` 对“调用角色不拥有表更新权限”这一最小权限目标是必要的；函数所有者仍受 FORCE RLS 约束，但**尚未实测**。所有权临时会员关系和 schema CREATE 权限在同一 DDL 事务内撤销。
- 函数名及表名均明确限定在 `catalog_private`；`search_path=pg_catalog, pg_temp`；无用户拼接 SQL 或动态 SQL。函数只接受整数批量上限并只返回计数。`PUBLIC` EXECUTE 在事务内撤销，只有维护角色获 EXECUTE。普通管理员、匿名角色和导入角色不应能执行。草案撤销维护角色旧的直接表授权并删除其旧策略。实际角色成员关系、PUBLIC 默认授权、`SET ROLE`、临时对象替换以及非超级用户有效权限必须到隔离库实测。
- 草案独立于已执行的 B2/原始回执/受限访问 SQL，不包含 `DROP TABLE`、`TRUNCATE`、回执 `DELETE`、六张商品表 DDL、RFQ 对象或生产 API。明确 `BEGIN`/`COMMIT`，失败应在 `ON_ERROR_STOP` 下整体回滚。它**新增**一个专用函数所有者和最小授权函数，**不扩大** `catalog_import`、`catalog_admin`、匿名或 PUBLIC 权限。
- 与 `restricted_v1` 的四字段单键查询、30 天重放、同一事务写入回执及 `COMMIT_UNKNOWN` 同键恢复在设计上兼容，因为清理只处理严格超过 90 天的回执。原有共享 `catalog_import` 角色可传入其他管理员 actor ID 的残余风险依旧存在；维护草案没有解决，也不应宣称解决。

## 执行器审查

`runBatch` 在授权前将批量限制为 1–500 的安全整数；默认拒绝，授权异常也拒绝。`ReceiptMaintenanceTransaction` 的 `purgeDue` 只返回计数，返回越界会触发回滚。COMMIT 发起后出错一律报告 `COMMIT_UNKNOWN`，不自动重复清理；后续调度可以安全重跑，因为已提交行不再是 `committed`。ROLLBACK 失败会丢弃连接。该接口不会接受任意 SQL、客户端角色或回执正文。

目前 **没有真实 PostgreSQL 维护适配器、专用维护登录、调度器、审计日志实现或生产授权入口**。接口声明的 `acquireCatalogLock()` 与未来真实连接的事务边界、超时及身份校验必须在下一阶段实现和实测；纯 TypeScript 类型不能证明这些安全属性。未来日志仅记录任务关联 ID、数量、耗时和稳定错误码，不记录 actor、key、指纹、result、凭据或异常堆栈。生产维护角色不得成为普通管理员的可继承角色。

## 修改与隔离 PostgreSQL 验证顺序

1. 先按上述建议修订 SQL 草案及对应离线静态断言：非等待 advisory lock 或经证明有效的函数内锁等待上限、单次数据库 cutoff、明确的忙碌错误。更新设计文档，使实际锁策略与文档一致。不要改已执行的原始迁移。
2. 再单独核准隔离目标，使用实际连接校验 host、port、database、login、数据目录、监听地址、system identifier 和版本。迁移前保存权限/行数快照；用 `ON_ERROR_STOP` 和 DDL 事务执行修订草案。若提交结果不确定，先查实际结构，不能盲目重跑。
3. 使用独立非超级用户登录：维护、导入、管理、匿名及无授权角色。验证直接 SELECT/UPDATE/DELETE、函数 EXECUTE、role membership、SET ROLE、BYPASSRLS、SECURITY DEFINER owner、FORCE RLS、临时对象、默认权限以及 `result` 列不可读。RFQ 表缺席时只能做静态隔离审查。
4. 用合成回执验证 30 天含边界重放、90 天等号保留、超过 90 天清理、永久主键和指纹、批量上限、重复运行、两个维护连接、维护与导入相互争锁、锁繁忙/超时、语句超时、故障回滚和提交结果不明后安全重试。使用数据库时间，不修改主机时钟；检查执行计划和锁等待。清理仅本次合成数据，保留原 Schema 与墓碑策略。
5. 真实测试完成后仍需单独批准生产维护身份、连接与调度器；生产商品导入入口保持关闭。共享导入角色跨管理员读取风险仍是单独的生产决策阻断项。
