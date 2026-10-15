# Sprint 2.5-B4.5-D2-B2-B4-B0：回执身份架构决策

## 决策状态与范围

**选择方案一：可信服务端统一连接数据库，由应用认证、授权并确定 `actor_id`。** 这是下一阶段的实施方向，**将安全目标明确限定为应用服务边界内的操作者隔离**。它不满足 B4-A 提出的“即使共享数据库登录被直接使用，数据库仍能独立证明操作者身份”的严格目标。若该严格目标仍是生产上线硬门槛，则本决策只允许继续本地实现与测试，生产导入必须保持关闭；需要改选方案二或另行批准数据库可验证的签名身份机制。此处没有风险豁免或上线批准。

本轮只新增决策文档。基线是 `main` 的 `840027f8ce6ffb029f695a79d1e2213b32af772d`；全部既有未提交修改保留。没有执行数据库 SQL、导入事务、回执清理或生产连接。

## 仓库现状：事实与未实现部分

| 调查项 | 代码证据 | 结论 |
| --- | --- | --- |
| 管理员认证与 RBAC | `src/app/` 仅有公开页面和 `src/app/api/rfq/route.ts`；`package.json` 无认证 SDK；`src/` 无 admin/auth/session 模块 | **未实现**管理员登录、角色授权、停用流程。现有 `catalog_admin`/`catalog_import` 是 PostgreSQL 权限角色，不是应用管理员 RBAC。 |
| 商品导入入口 | `src/lib/catalog-import/postgres.ts` 导出事务类；调用发生在 `scripts/test-catalog-postgres-import.mjs`、并发测试及离线测试；`src/app/api/` 只有 RFQ 路由 | **未实现**商品导入服务端路由、后台或生产入口。RFQ 路由使用独立的 Mock/RFQ 仓库，不承担商品导入。 |
| PostgreSQL 连接 | `PostgresCatalogImportTransaction` 构造器在 `postgres.ts` 创建 `pg.Pool(max: 4)`；`checkedClient()` 验证实际本地实例 | 目前是**本地隔离测试适配器**，仅接受固定的 55439/55440 目标；不是可部署的生产连接器。 |
| 登录是否共享 | `LOCAL_TARGETS` 对每个测试集群固定一个数据库用户名；`execute()` 在事务内 `SET LOCAL ROLE catalog_import` | 同一目标的导入测试共用该登录及连接池。55440 的测试登录是 `catalog_d2b_owner`，不能拿它作为生产最小权限模型。 |
| `actor_id` 来源 | `transaction.ts` 的 `verifyCatalogActorContext(session, verifier)` 接受注入的验证器；测试传入合成 session/actor。`postgres.ts` 从 `request.actor_context.actor_id` 取值 | 有防伪的**进程内契约**和伪造对象拒绝测试，但**没有真实管理员会话验证器**；当前值只来自测试夹具。 |
| 客户端直接访问数据库 | `src/` 中 catalog 的 `pg.Pool` 只在服务器侧模块；无 catalog 浏览器客户端或 Data API 调用 | 仓库**没有实现**客户端直连商品数据库。不能据此推断未来部署网络规则已配置。 |
| 回执与不确定提交 | `postgres.ts` 在全局事务锁后按 `(actor_id,key)` 读回执，再比对快照；写入与商品 DML 同事务；`COMMIT_UNKNOWN` 要求原 actor、请求与 key 重试 | 本地合成测试覆盖重放；没有生产 HTTP 恢复入口。 |
| Supabase Auth | `package.json` 无 Supabase Auth/SSR SDK；`src/` 无 Auth 集成；仓库文档只描述 Supabase 数据库角色/迁移 | **尚未接入，也无已落实的接入计划**。本决策选择它作为后续管理员身份提供方的实施基线；接入前不得把现有测试 actor 当成真实身份。 |

已执行的回执草案 `docs/sql/catalog-import-receipts.draft.sql` 对 `catalog_import` 授予直接 `SELECT, INSERT`，并设 `SELECT USING (true)`；`catalog_admin` 也能读全部回执。B4-B3 的独立非超级用户测试实证了跨 actor 读取。应用查询的 `WHERE actor_id=$1`、`NOLOGIN`、TypeScript brand 都不能约束直接使用该数据库角色的人。

## 最终架构取舍

| 维度 | 方案一：统一可信服务端连接（**选择**） | 方案二：每操作者独立数据库身份 |
| --- | --- | --- |
| 当前项目适配 | 沿用现有 `CatalogImportTransaction`、一个事务连接和全局锁；需新增管理员认证及生产适配器 | 需新增逐人数据库角色、身份映射、凭据发放/轮换/撤销和连接代理；现有 owner 固定连接须重写 |
| 安全边界 | 服务端验证会话与授权；数据库凭据只在服务端；受限回执函数缩小直接读面 | PostgreSQL 的已认证 `session_user` 可绑定 actor，能抵御单一 actor 数据库凭据跨 actor 访问 |
| 数据库级隔离 | **不满足严格目标**：共享角色一旦可自行调用带 `actor_id` 的函数或直接写入，就可能冒用其他 actor | 在每人登录、受保护映射、正确 RLS/函数及无越权成员关系条件下可满足；中央凭据代理被攻破仍可跨 actor |
| 凭据与撤销 | 一组受控服务凭据；停用管理员由应用授权表与会话失效执行；已有池连接不代表管理员 | 每管理员一组数据库身份/凭据；还需处理旧连接与池的销毁，不能只改 `NOLOGIN` 就假设活跃事务停止 |
| 连接池 | 单一有界池，事务内 `SET LOCAL ROLE`，每次释放前 COMMIT/ROLLBACK；不得保留 actor 会话变量 | 每 actor 池或动态连接代理，连接数、缓存和生命周期复杂；混用连接会破坏身份保证 |
| Supabase 部署 | Supabase Auth 可用于服务端管理员身份；数据库连接仍须使用受限自定义角色，不得用 `service_role`/owner 绕过 RLS。实际部署连接方式需另测 | Supabase Auth 用户并不自动成为独立 PostgreSQL LOGIN；需自建逐人角色并验证自定义角色经连接池的行为，成本更高 |
| 幂等恢复 | 同一应用 actor、请求指纹和 key 重试，服务端代读原回执；禁用账号走单独审计的运维核查 | 原 actor 必须重新使用同一 DB 身份；若角色撤销，需独立的审计恢复通道 |
| 开发及维护 | 较低，但安全关键点集中在管理员认证、服务端授权和共享凭据保护 | 较高，角色与密码生命周期、每人连接数、Supabase pooler 行为都需长期运维 |

选择方案一是因为当前系统连管理员身份和导入入口都尚未实现，商品导入会经过受控 Next.js 服务，而不是直接开放给数据库客户端。为尚不存在的后台预置逐人数据库登录与池管理，会先引入大量运维状态，且 Supabase Auth 身份不会自动等同于 PostgreSQL `session_user`。这项选择**降低了 B4-A 的数据库级隔离目标**，不能把撤销直接 SELECT 或应用层过滤描述为原风险已消除。

Supabase 官方文档将 Auth 服务器侧验证与数据库连接分开说明；`getUser` 获取较新的服务器端用户记录，`getSession` 中的用户对象不应单独用于授权。事务连接池不保留跨事务 session 状态，但事务内状态可使用；这支持本设计的 `SET LOCAL ROLE`，仍需在目标环境实测。[Auth 服务端说明](https://supabase.com/docs/guides/auth/server-side/creating-a-client?environment=route-handler&framework=nextjs)；[PostgreSQL 连接与池模式](https://supabase.com/docs/guides/database/connecting-to-postgres)。这些是未来兼容性依据，**不是**当前项目已经接入 Supabase Auth 或验证生产连接的证据。

## 目标身份、权限与服务流程

1. **身份**：后续采用 Supabase Auth 作为管理员登录提供方。Next.js 服务端每次敏感请求都向 Auth 服务确认用户；不信任浏览器传来的 `actor_id`、角色、JWT `user_metadata` 或未重新验证的 session 对象。用一个未来新增的私有 `catalog_admin_accounts` 注册表，把提供方用户 ID 映射到稳定内部 `actor_id`（UUID 字符串），并记录 `active`、`can_import`、授权版本和停用时间。授权记录由受控管理员流程维护，不由导入请求更新。具体 Auth SDK 与注册表迁移均**未实现**。
2. **入口**：新增默认关闭的仅服务端商品导入端点；启用须单独批准。请求经过身份验证、活动状态与导入权限检查、CSRF/Origin 保护（浏览器会话）、大小/速率限制和 B4 校验。服务端根据注册表构造 `ActorContext`，客户端不能传可信快照、数据库 UUID 或 actor。RFQ 路由和开关保持独立。
3. **数据库登录**：未来专用 `catalog_import_runtime` LOGIN，非 owner、非 superuser、无 `BYPASSRLS`、`NOINHERIT`，仅能 `SET ROLE catalog_import` 和读取最小授权信息；没有 RFQ、维护或其他管理员角色成员关系。凭据由服务端密钥管理系统提供，不进入浏览器或日志。当前 55440 本地 owner 登录**不得原样迁往生产**。
4. **回执读取**：独立增量 SQL 撤销 `catalog_import` 与 `catalog_admin` 对回执的直接 SELECT，移除宽泛读取策略；仅允许 `catalog_import` 执行一个受限 lookup 函数。函数接受**服务端提供的** `actor_id` 与幂等键，返回固定列 `request_fingerprint,status,result,within_retry_window`，不接受 SQL 片段、角色名或表名。若撤销直接 SELECT 而仍需在同一事务内读取，函数需要经过审查的 `SECURITY DEFINER`：`NOLOGIN`、无 `BYPASSRLS` 的专用所有者，固定 `search_path=pg_catalog`、全限定对象名、无动态 SQL；撤销 PUBLIC/default EXECUTE，仅授予 `catalog_import`。函数所有者自身的 SELECT 与 `FORCE RLS` 策略也须实测。
5. **回执写入**：商品与回执保持同一连接、同一事务和 `(actor_id,key)` 唯一约束；不把客户端时间用于 30/90 天判断。现有 `catalog_import` 的直接 INSERT 在数据库级仍可写别人的 actor 行；此方案依赖可信服务端不这样做。可在增量 SQL 中改为受限 append 函数以减少误用，但**只要共享角色能自选 actor 参数，函数也不能证明跨 actor 隔离**。
6. **审计**：服务端记录请求关联 ID、内部 actor、操作、批准/拒绝、回执结果码及必要的授权版本；禁止记录原始导入正文、回执 JSON、密钥、SQL 参数或客户数据。独立监测共享角色直接访问回执的失败尝试、异常函数调用和授权失败；日志权限与保留期限另审。

### 明确的绕过与池边界

- 共享数据库角色若仍有直接 SELECT，立即可读所有 actor；即使撤销 SELECT，只要受限函数接受任意 `actor_id`，持有该角色凭据者仍可请求别人的回执。**应用层身份校验不是数据库级证明**。
- 无 actor 参数的函数在共享登录下没有可信 actor 来源。普通 `SET LOCAL app.actor_id`/自定义 GUC 可由同一角色自行设置，不能用来证明身份；`session_user` 始终是共享登录。要使其可信，必须引入数据库可验证、不能由共享角色伪造的签名声明，或改用方案二。
- 连接池不得保存 actor GUC、session 级 `SET ROLE` 或请求级对象。每个导入独占一个借出的连接并使用 `BEGIN`、`SET LOCAL ROLE`、有界事务锁/超时、COMMIT/ROLLBACK；异常连接丢弃。归还后独立检查无角色/状态残留。连接池不能把一个请求的 `ActorContext` 放进全局缓存。
- 专用服务登录不允许 `SET ROLE catalog_admin`、维护角色、函数 owner 或任意 actor 角色；审计 `PUBLIC`、默认函数 EXECUTE、schema CREATE、继承路径和 `BYPASSRLS`。函数的固定路径和参数化查询限制 SQL 注入范围，但共享凭据泄漏仍可能调用任意合法 actor 参数。

## 管理员停用与不确定提交

管理员停用由受控管理操作更新注册表，并撤销 Auth 会话。每次新请求重新查活动状态；导入事务在做回执查找与商品写入前，对对应授权行取得事务内共享锁并验证 `active/can_import`，停用事务更新该行时等待已有事务结束。这样停用提交后不能再有新导入通过检查；停用前已取得锁的短事务可能先提交，这是一条明确的时间边界。紧急停用还须关闭入口并由运维终止正在运行的事务。**当前这些锁和授权表均未实现。** 共享数据库连接池不保存管理员身份，无需“停用该管理员的数据库登录”，但必须使其应用会话失效。

`COMMIT_UNKNOWN` 的普通恢复路径：同一仍然有效的管理员重新认证，服务端重新导出同一内部 `actor_id`，提交原 `import_batch_id`、原始标准化请求、原 `idempotency_key` 和预期快照；事务先获得相同 advisory lock，再通过受限函数查 `(actor_id,key)`，在快照比较前按原指纹返回原结果或冲突/过期。不得换 key 猜测执行状态。B 无法通过正常服务端接口选择 A 的 actor；但共享数据库角色被直接滥用时仍可尝试 A 的函数参数。账号已停用时，普通接口拒绝恢复；原回执和墓碑保留，由独立授权、可审计的运维流程核查，不开放给被停用账号。

## 需要实施的模块、文件与迁移

1. **管理员认证与授权**：新增服务端 Auth 适配器、`catalog_admin_accounts` 仓库、停用流程、授权测试和默认关闭的管理入口。新增私有管理员表需单独迁移；不改 B2 或 RFQ 表。确认 Supabase Auth 项目配置与 SDK 版本后再实现。
2. **导入编排**：新增服务器 route/service，将验证的用户映射到内部 actor，调用现有 CSV/Excel → Patch Merge → B3 → 事务适配器；保留生产开关默认关闭。修改 `src/lib/catalog-import/transaction.ts` 的真实验证器接入方式；离线 Mock 测试可保留。
3. **生产数据库适配**：以现有 `src/lib/catalog-import/postgres.ts` 为契约参考，新增独立生产配置/连接器；**不要去掉现有本地物理身份白名单后直接复用 owner 连接**。修改回执 SELECT 为受限函数，保持锁、版本复核、原子回执写入与 `COMMIT_UNKNOWN` 语义。`src/lib/catalog-import/receipt.ts` 的结果白名单与错误码应继续复用。
4. **独立增量 SQL**：另建经审查的迁移，配置运行时最小权限角色、管理员注册表、回执 lookup 函数及其执行权限，撤销宽泛 SELECT，并审计 insert 权限。不得编辑或重放已经执行的 `docs/sql/catalog-import-receipts.draft.sql`；不得扩展 RFQ 权限。函数迁移和适配器应在入口仍关闭时一起测试。
5. **90 天维护**：继续使用独立维护角色与相同 advisory lock；维护入口/作业及墓碑测试另行开发。不能将当前 90 天字段约束当作已运行的清理服务。

## 验收与生产决策门槛

- 两个真实认证的合成管理员 A/B：A 只能经服务端接口重放 A 的回执，B 不能令应用读取 A；客户端伪造 actor、角色、会话变量、幂等键或原始上传字段均被拒绝。停用后新请求拒绝；停用与在途事务的锁定顺序可复现。
- 独立非超级用户测试登录验证：匿名/普通角色不可读写；运行时角色不能直接 SELECT 回执、不能 `SET ROLE` 到 admin/维护/owner；函数仅被指定角色执行；函数 owner、`SECURITY DEFINER`、`search_path`、PUBLIC/default grants、RLS、FORCE RLS 及 schema 权限均通过审计。**同时记录共享运行时凭据直接调用函数传入其他 actor 仍可成功的残留能力；此测试不得包装为隔离通过。**
- 同 key 并发只提交一次；30 天重放、过期错误、永久墓碑、`COMMIT_UNKNOWN` 跨进程恢复和回执/商品同事务回滚通过。连接池复用、异常断连、角色复位、管理员撤销均有测试。保持 RFQ 表与权限不变。
- 先在身份锁定的隔离 PostgreSQL 测试，后才另行审批生产身份、增量迁移、密钥、网络边界及默认关闭 API。若仍要求“共享 DB 凭据遭滥用也不能跨 actor”，**方案一验收必然不通过**，必须升级到方案二或数据库验证的签名身份设计；没有人工明确接受降低目标前，生产商品导入保持关闭。
