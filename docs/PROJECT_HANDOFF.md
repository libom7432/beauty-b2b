# Beauty B2B 项目交接入口

更新时间：2026-11-08（Asia/Shanghai）
对应代码 Commit：`326d86091a01e3d6ab5971cbf2c8f3282f4c7d04`

> 新对话先重新核对 Git 状态、代码和环境。本文记录上述 Commit 的仓库状态；历史阶段文档中的“计划”“本地通过”不等于当前生产验收。

## 1. 项目概况

- 定位：面向欧美市场的 B2B 美甲产品外贸独立站，含英文主页与 `/zh` 中文镜像、商品目录、搜索、筛选、询盘入口和后台工作区。
- 技术栈：Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4、Supabase Auth/数据库设计、PostgreSQL；测试使用 Node.js 脚本和 Playwright。
- `src/app/(en)`、`src/app/zh`：双语前台路由；`src/features/pages`、`src/i18n`：共用页面和文案。
- `src/lib/catalog`：概念商品、类目、Collection 和目录模型；`src/lib/rfq`、`src/app/api/rfq`：询盘/RFQ 的本地受限路径。
- `src/app/admin`、`src/components/admin`、`src/lib/admin`：后台页面、草稿编辑器、身份与导航保护。
- `src/lib/catalog-read`、`src/lib/catalog-import`：目录读取、导入及 PostgreSQL 适配；`src/app/api/admin`：后台只读辅助接口。
- `supabase/migrations`：版本化 SQL；`docs/sql`：尚需单独审查/批准的 SQL 草案；`scripts`：离线和隔离数据库验证；`e2e`：浏览器测试与隔离夹具。
- `README.md` 主要描述早期 V3 前台。其“没有认证、后台或 RFQ 后端”的表述已落后于当前代码；但当前代码仍不能据此视作已接入生产。

## 2. Git 基线

| 项目 | 2026-11-08 检查结果 |
| --- | --- |
| 原始本地仓库 | 本文所在 Git 顶层目录 `.`；从任意子目录用 `git rev-parse --show-toplevel` 重新确认 |
| 分支 | `main` |
| HEAD | `326d86091a01e3d6ab5971cbf2c8f3282f4c7d04` |
| origin | `https://github.com/libom7432/beauty-b2b.git` |
| 远端同步 | 前一轮 Push 后远端 `main` 与 HEAD 一致；本次本地检查 `origin/main...HEAD` 为 Behind 0 / Ahead 0，未再次 Fetch |
| 工作区 | 仅 `docs/PROJECT_HANDOFF.md` 为未跟踪文件；其余工作区与暂存区干净 |

- 最近三次已推送提交：`d537b2e` Collection 草稿/Guard 基础、`fdbe5f6` 商品列表筛选、`326d860` 后台侧栏统一 Guard。
- 本文件尚未 Add/Commit/Push。后续对话必须以届时实际 HEAD、`git status` 和远端引用为准。

建议新会话的只读核对命令：

```bash
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git remote -v
git rev-list --left-right --count origin/main...HEAD
```

最后一条只比较本地记录的远端引用；需要确认 GitHub 最新状态时，应在获得相应授权后 Fetch。

## 3. 已完成功能与验收边界

### Sprint 1 / V3 前台

- 代码：英中双语路由、类目/商品/Collection 展示、搜索筛选排序、SEO 与页面模板；`README.md` 解释目录结构和概念数据。
- 数据：24 个双语 Mock 商品及示例价格/MOQ/OEM 信息仅供开发，不能作为供应商报价或生产商品内容。
- 验收：存在本地 Mock 校验和前台脚本；本次未重跑，也未做生产内容、SEO 或真实供应商数据验收。

### Sprint 2.4：询盘与 RFQ

- 代码：询盘/RFQ 模型、校验、数据库适配和 `src/app/api/rfq/route.ts` 的本地受限 POST 路径。
- 运行边界：RFQ Route 在默认配置和所有生产环境保持关闭；现有代码不是已上线的客户询盘提交服务。
- 验收：历史文档记录本地/隔离测试；真实生产写入、限流、监控和部署仍待验证。参见 `docs/rfq-api-b2d1.md`。

### Sprint 2.5：目录数据库与导入

- 代码：Catalog 基础迁移、校验、CSV/Excel 规范化、快照/合并/预览、隔离 PostgreSQL 导入适配与 receipt 生命周期设计。
- 只读目录：Admin 授权仓储、签名游标、PostgreSQL 读取适配和专用只读角色迁移均已在仓库中。
- 运行边界：`src/lib/catalog-read/server.ts` 默认使用未配置源；仅生产 Node 环境显式设置 `CATALOG_READ_SOURCE=supabase` 且配置合格时才选 Supabase 读取源。
- 验收：历史文档记录离线及专用本地 PostgreSQL 集群验证；不能推断真实 Supabase 已创建、迁移已执行或生产连接通过。
- `docs/sql/*.draft.sql` 是草案，不属于可自动执行的版本化迁移；receipt 的生产授权、运行身份和维护调度尚未完成。
- 参考：`docs/catalog-database-foundation.md`、`docs/catalog-import-d2-final-review.md`、`docs/admin-catalog-supabase-b4b2a.md`、`docs/admin-catalog-supabase-snapshot-f2.md`。

目录读取的关键入口：

- `src/lib/catalog-read/server.ts` 决定是否启用真实读取源。
- `src/lib/catalog-read/repository-core.ts` 在源访问前实施授权与游标检查。
- `src/lib/catalog-read/postgres-supabase-config.ts` 验证显式目标和连接参数。
- `supabase/migrations/20261020120000_add_catalog_admin_read_runtime.sql` 是仓库中的版本化迁移，不证明目标环境已执行。

### Sprint 2.6：后台与 Collection

- 代码：Supabase Auth 管理员登录/登出入口、私有目录授权检查、后台只读工作区及商品/类目/Collection 列表和详情。
- 商品列表支持 URL 同步的搜索、状态/主类目筛选、排序、Clear 和浏览器历史导航；由服务端仓储与签名游标处理读取。
- 商品、类目和 Collection 编辑器目前为本地草稿/演示，不向数据库保存；Collection 详情明确显示 `LOCAL DEMO / NOT CONNECTED`。
- Collection 草稿会话保留页内未保存状态；Owner 与身份复核控制访问，成员来源重新读取，候选商品可搜索并进行精确成员校验后 Proposed Add。
- Collection 辅助 API Route 在后台授权边界内提供成员来源和精确成员校验；浏览器测试主要使用隔离夹具，未验证真实 Supabase 权限。
- Guard 覆盖后台未保存草稿、浏览器历史、正式桌面侧栏、品牌链接、移动菜单和登出；登出失败可连续重试且每次有效尝试重新确认。
- P1-F1/F2 登出保护与 P2-F1 正式侧栏迁移在本地定向审查/验证后提交；本次只核对代码状态，没有重新运行这些测试。

Collection 草稿的关键入口：

- `src/components/admin/admin-collection-draft-sessions.tsx` 和 `src/lib/admin/collection-draft-session.ts`：页内会话状态。
- `src/lib/admin/collection-draft-session-owner.ts`、`src/components/admin/admin-shell.tsx`：Owner 和身份变化边界。
- `src/components/admin/collection-editors.tsx`：基本字段、成员、候选及 Proposed Add 的界面协调。
- `src/components/admin/admin-unsaved-changes.tsx`：统一 Guard 意图与确认弹窗。
- `src/app/admin/logout-form.tsx`：正式登出入口；不要只用测试 probe 验证登出。
- `e2e/admin-collections-detail.spec.ts`、`e2e/admin-guard-foundation.spec.ts`：关联浏览器回归。

## 4. 当前开发阶段

- Sprint 2.6 已完成并推送：Collection 草稿会话/Owner、成员来源与身份复核、候选/Proposed Add、商品列表筛选、正式侧栏统一 Guard、登出失败重试。
- 当前没有正在开发的业务代码变更；本文件是唯一未跟踪工作。
- Sprint 2.6 尚余 P2：顶部面包屑仍通过 `confirmNavigation()` 使用原生 `window.confirm`，未迁入 `requestNavigation` 的统一弹窗。
- 后台页面的 `READ ONLY · SPRINT 2.6` 和 Collection 的 `LOCAL DEMO` 标签与当前未持久化边界一致。
- 生产接入是另一个阶段：管理员身份、目录只读角色/连接、RFQ 写入和导入链路均需独立环境核验与审批。

已提交范围按任务边界分开：

1. `d537b2e`：Collection 本地草稿与 Guard 基础。
2. `fdbe5f6`：商品列表筛选及 URL 状态。
3. `326d860`：正式侧栏/品牌/移动菜单的 Guard 入口与 cleanup。

三个提交共享部分后台文件；未来修复应检查具体 hunk，不能仅按路径判断任务归属。

## 5. 未完成任务与风险

| 优先级 | 状态与影响 | 下一步 |
| --- | --- | --- |
| P0 | 本轮未发现新的已确认 P0；生产环境状态未验证，不能据此声明无生产风险 | 在批准的隔离/预生产环境进行目标识别、权限快照和部署检查 |
| P1 | 本轮未发现新的已确认 P1；P1-F1/F2 仅有本地隔离夹具与定向浏览器验收 | 生产接入前重验真实身份撤销、会话与授权边界 |
| P2 | 顶部面包屑仍使用原生确认；交互与侧栏/登出不一致 | 单独迁入统一 Guard，并审查取消、确认和历史导航 |
| 生产接入 | Catalog 只读源默认关闭；真实 Supabase 项目、角色/ACL/RLS、TLS/pooler、迁移历史未验收 | 按 `docs/admin-catalog-supabase-snapshot-f2.md` 的审批门槛先做只读目标快照 |
| 生产接入 | RFQ Route 生产关闭；Catalog 导入 receipt 草案及维护运行器未生产化 | 分别审查运行身份、数据库授权、迁移、监控和回滚 |
| 内容上线 | Mock 价格、MOQ、能力和图片不得作为真实商品承诺 | 使用核实的供应商数据替换并复核索引策略 |

## 6. 测试状态

- 最近三次分组提交前的本地定向记录：Collection 基础暂存快照 Typecheck 通过、82 个相关单元测试通过、10 个定向 Playwright 通过。
- 商品筛选暂存快照 Typecheck/定向 ESLint 通过、5 个单元测试通过、11 个关联 Playwright 通过、1 个按视口跳过。
- P2-F1 暂存快照 Typecheck、定向 ESLint、`git diff --check` 通过；8 个关联 Playwright 通过、2 个按视口跳过，含 P1 登出连续失败重试回归。
- 这些结果来自提交前的本地验证记录，不是本次文档任务新运行的测试；本轮没有运行 Typecheck、Lint、单元测试或 Playwright。
- GitHub 仓库当前未见 `.github` CI 工作流；不得把本地测试等同于云端 CI 或生产发布验收。
- 未覆盖：真实 Supabase Auth、目标项目权限与迁移、生产 TLS/pooler、真实 RFQ 写入、生产导入/receipt、运行监控、真实客户/供应商数据。
- 历史报告的测试数字和 Git 基线可能过期；执行新任务时以实际代码和新测试结果为准。

可用于后续定向检查的现有命令与入口：

```bash
npm run typecheck
npx eslint src/components/admin/admin-shell.tsx src/components/admin/admin-unsaved-changes.tsx
node --test scripts/test-admin-collection-draft-session.mjs
npx playwright test e2e/admin-collections-detail.spec.ts
git diff --check
```

运行 Playwright 前应选择关联测试名称和视口，避免自动执行整个 E2E 集合；上述命令只是入口示例，不能据此宣称本轮已通过。

## 7. 开发约束

- 接手时先运行只读 Git 检查；不凭历史 PASS 报告跳过代码核对，也不擅自覆盖、删除或整理未提交工作。
- 一个任务只修改必要范围；混合文件按实际 diff hunk 审查。提交前核对暂存快照、敏感信息与依赖，不把混合工作区测试冒充暂存快照验证。
- 关键修复先定向验证，再交独立只读复审；区分 PASS、CONDITIONAL PASS 与 FAIL，明确未测范围。
- Git Add/Commit/Push、分支切换或历史改写须服从当轮授权；生产数据库访问、迁移和真实凭据操作须单独授权并核验目标。
- 不把本地 PostgreSQL 集群、Playwright 夹具、SQL 草案或离线权限快照写成生产验收。
- 严守前台公开数据、后台授权读取和数据库专用角色边界；不要把服务器连接串或密钥暴露给浏览器、文档或日志。

## 8. 下一步建议

**建议下一项独立任务：Sprint 2.6 P2-F2 顶部面包屑导航统一 Guard。**

1. 先核对 `src/components/admin/admin-shell.tsx` 中三个面包屑入口与 `src/components/admin/admin-unsaved-changes.tsx` 的当前调用关系。
2. 仅将面包屑接入现有 `requestNavigation`；不增加第二套确认状态，不改变已通过的侧栏、移动菜单或登出流程。
3. 定向验收：有草稿取消后页面/草稿/身份不变；确认后只导航一次；无草稿可直接导航；浏览器前进/后退及登出失败重试无回归。
4. 运行 Typecheck、定向 ESLint、`git diff --check` 和必要的桌面/移动端 Playwright；随后独立只读复审。真实 Supabase 验证另立任务。

生产接入前应先从批准的目标项目做只读身份和权限快照，确认环境、迁移与角色边界，再决定是否申请迁移或启用连接。本文不授权这些操作。
