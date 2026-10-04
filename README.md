# Feishu × Linear

飞书（Feishu / Lark）版的 Linear 连接器，目标是对标 [Linear 的 Slack 集成](https://linear.app/docs/slack)：在飞书里用机器人创建 / 关联 Issue、与 Linear 评论双向同步、接收通知、展开链接，并支持 @机器人 用自然语言操作 Linear。

- 技术栈：Node ≥ 22 · TypeScript (ESM) · Koa · Postgres + Drizzle · 官方 `@larksuiteoapi/node-sdk` / `@linear/sdk`
- 接入方式：**纯 Webhook**（飞书事件 / 回调 / 链接预览共用 `POST /webhook/feishu`，Linear 走 `POST /webhook/linear`），不依赖长连接
- 部署形态：同一份代码可跑在 Cloudflare Workers、Vercel、或 Docker（VPS）上

> 项目仍在开发中，功能进度见下方「功能对标」。

## 功能对标

对照 Linear × Slack 的能力清单。✅ 已实现 · 🟡 部分实现 · ⬜ 计划中。

| 能力 | 状态 | 说明 |
|---|---|---|
| **Agent（@机器人）** | 🟡 | 群里 @ 机器人用自然语言建 / 搜 Issue、列团队 / 项目（OpenAI 兼容接口）。待补：读取话题上下文、文件上传、更新 / 评论、生成文档、批量提炼需求 |
| Agent Guidance | 🟡 | 按群配置默认团队 / 项目 / 指令（目前通过管理 API） |
| **创建 Issue** | 🟡 | 卡片表单（私聊 `create`、机器人菜单）、Agent。待补：消息快捷操作、`/linear` 命令、关联已有 Issue、模板 |
| **线程双向同步** | 🟡 | 文本评论双向同步、Issue 状态变更回帖。待补：图片 / 文件、重复 Issue 联动 |
| **团队通知** | ✅ | 创建 / 状态变更推送到指定群 |
| **项目通知** | ✅ | 推送到指定群或项目专属群 |
| **个人通知** | 🟡 | 被分配时私聊通知（需绑定账号）。待补：更多事件类型与偏好 |
| Initiative 通知 / 视图订阅 | ⬜ | |
| **项目频道自动创建** | 🟡 | 新建项目时自动建群、项目改名同步群名。待补：邀请项目成员、群内回链 |
| **链接展开** | 🟡 | Issue / Project 链接预览（`url.preview.get`）、消息里的 Issue ID 自动展开（60 分钟冷却）、卡片上「分配给我 / 订阅」。待补：Document / Initiative、评论 / 取消订阅 / 升级同步线程、私有团队不展开 |
| Loops / MCP 生态 | ⬜ | |
| Linear Asks 类（非 Linear 用户提需求） | ⬜ | |

## 目录结构

```
src/
├── adapters/          # 平台接入层（只懂飞书 / Linear SDK）
│   ├── feishu/        # EventDispatcher + 消息 / 卡片 API
│   └── linear/        # API Key / OAuth + Webhook 验签 + GraphQL
├── domain/            # 业务领域（不依赖 HTTP）
│   ├── issues/        # 创建 / 分配 / 卡片数据
│   ├── sync/          # 话题 ↔ Issue 评论双向同步
│   ├── notify/        # 团队 / 项目 / 个人通知、项目频道
│   ├── users/         # 飞书 ↔ Linear 用户映射
│   └── agent/         # @机器人 自然语言（OpenAI tools）
├── transport/http/    # Koa 路由 + 中间件
├── cards/             # 飞书卡片 JSON 2.0
├── db/                # Postgres + Drizzle（schema / 迁移）
├── worker.ts          # Cloudflare Workers 入口
└── index.ts           # Koa 应用装配（Node / Vercel 入口）
```

## 快速开始

```bash
pnpm install
cp .env.example .env     # 填飞书 App ID / Secret / Verification Token、Linear 凭据、DATABASE_URL
pnpm db:migrate          # 应用数据库迁移（幂等）
pnpm dev
```

健康检查：`GET /health`。本地开发需要把 `/webhook/feishu` 暴露到公网（`cloudflared tunnel --url http://localhost:3000` 或 ngrok）。

常用命令：

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 开发（`tsx watch`） |
| `pnpm build` / `pnpm start` | 构建 / 运行产物 |
| `pnpm typecheck` / `pnpm test` | 类型检查 / 测试 |
| `pnpm db:generate` | 改了 `src/db/schema.ts` 后生成迁移（提交 `drizzle/`） |
| `pnpm db:migrate` | 应用迁移 |
| `pnpm dev:worker` / `pnpm deploy:worker` | Workers 本地调试 / 部署 |

## 数据库

Postgres（任意托管或自建，如 [Neon](https://neon.tech)），`DATABASE_URL` 必填。

```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=fl postgres:17-alpine
# DATABASE_URL=postgres://postgres:pw@localhost:5432/fl
```

测试：Postgres 相关用例仅在设置 `TEST_DATABASE_URL` 时运行（用例会清空表，请用专用库，并先执行迁移）：

```bash
TEST_DATABASE_URL=postgres://postgres:pw@localhost:5432/fl pnpm test
```

## 配置

所有配置通过环境变量，完整列表与注释见 [`.env.example`](.env.example)。关键项：

| 变量 | 说明 |
|---|---|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 飞书应用凭据 |
| `FEISHU_VERIFICATION_TOKEN` | 事件订阅的 Verification Token，**必填**，用于校验请求来源 |
| `FEISHU_ENCRYPT_KEY` | 开启「加密」时填写 |
| `LINEAR_AUTH_MODE` | `api_key`（默认，自用最快）或 `oauth`（actor=app，支持以用户身份评论 / Agent 身份） |
| `LINEAR_API_KEY` / `LINEAR_CLIENT_ID` / `LINEAR_CLIENT_SECRET` | 对应鉴权模式 |
| `LINEAR_WEBHOOK_SECRET` | Linear webhook 签名密钥，生产环境必填 |
| `LINEAR_APP_USER_ID` | 可选，用于过滤连接器自己触发的 webhook（防回声）；留空时自动取当前账号 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | Agent 使用的 OpenAI 兼容接口，不配则 Agent 不可用，其余功能不受影响 |
| `DATABASE_URL` | Postgres 连接串 |
| `ADMIN_TOKEN` | `/api/*` 的 Bearer Token，留空则管理 API 禁用 |
| `CRON_SECRET` | `/cron/*` 的 Bearer Token |
| `PUBLIC_URL` | 服务对外地址 |

`LINEAR_AUTH_MODE=api_key` 时连接器以该 Key 所属账号操作；想让评论 / Issue 显示为真实发送者，请使用 OAuth 模式，或为连接器单独建一个机器人账号。

## 飞书开发者后台配置

1. **机器人能力**：开启。
2. **事件与回调 → 订阅方式**：选「将事件 / 回调发送至开发者服务器」，请求地址 `https://<你的域名>/webhook/feishu`。
   - 事件：`im.message.receive_v1`、`application.bot.menu_v6`
   - 回调：`card.action.trigger`、`url.preview.get`
3. **链接预览**：在应用功能中配置，URL 规则填 `linear.app/*`，回调地址同上。
4. **权限**（最小集）：
   - `im:message`、`im:message:send_as_bot`、`im:message:readonly`
   - `im:message.group_at_msg:readonly`、`im:message.p2p_msg:readonly`
   - `im:chat`、`im:chat:create`（项目频道）
   - `contact:user.id:readonly`、`contact:user.base:readonly`（按邮箱绑定用户）
5. 创建版本并发布后生效。

事件类请求会先 ACK 再后台处理；卡片交互与链接预览必须 3 秒内返回。

**来源校验**：飞书 SDK 只在配置 Encrypt Key 时校验签名，不会比对 Verification Token。本项目对每个事件 / 回调额外校验 `header.token`，不匹配返回 401；建议同时开启「加密」。

## Linear 配置

**API Key 模式**：Linear → Settings → API 创建 Personal API key；再创建 Webhook，URL 为 `https://<你的域名>/webhook/linear`，勾选 `Issue` / `Comment` / `Project`，把 Signing Secret 填入 `LINEAR_WEBHOOK_SECRET`。

**OAuth（actor=app）模式**：创建 OAuth Application，回调地址 `https://<你的域名>/oauth/linear/callback`；设置 `LINEAR_AUTH_MODE=oauth` 与 Client ID / Secret；浏览器打开 `/oauth/linear/install` 由管理员授权。

## 使用方式

| 操作 | 怎么用 |
|---|---|
| 绑定账号 | 私聊机器人：`bind you@company.com`（飞书账号有邮箱权限时会自动按邮箱绑定） |
| 自然语言 | 群里 `@机器人 建一个 bug 并分配给我` |
| 表单创建 | 私聊 `create`，或机器人菜单事件 `create_issue` |
| 同步线程 | 表单里点「创建并同步线程」 |
| Issue 展开 | 消息里写 `ENG-123` 或贴 Linear 链接 |
| 通知 / Guidance 配置 | 管理 API（见下） |

## API

| Method | Path | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| POST | `/webhook/feishu` | 飞书事件 + 回调统一入口 |
| POST | `/webhook/linear` | Linear Webhook |
| GET | `/oauth/linear/install` · `/oauth/linear/callback` | OAuth 安装（仅 oauth 模式） |
| POST | `/api/bind` | 绑定飞书 ↔ Linear 用户 |
| POST | `/api/notification` | 创建通知配置 |
| POST | `/api/guidance` | 设置群的 Agent Guidance |
| GET | `/api/teams` | 列出 Linear 团队 |
| GET | `/cron/cleanup` | 清理过期去重记录 |

`/api/*` 需要 `Authorization: Bearer <ADMIN_TOKEN>`（未配置则返回 503）；`/cron/*` 需要 `Bearer <CRON_SECRET>`。

## 部署

同一份代码支持三种形态；后台任务（先 ACK 再处理）、定时清理、连接池会按运行环境自动适配。**部署相关的个人配置（域名、账号、区域、密钥）不要提交到仓库**：`.env`、`.dev.vars`、`wrangler.jsonc`、`.wrangler/`、`.vercel/` 均已被 `.gitignore` 忽略，仓库里只保留 `*.example` 模板。

### Cloudflare Workers

```bash
cp wrangler.example.jsonc wrangler.jsonc   # 按需填写自定义域名、placement 等（该文件不入库）
DATABASE_URL='<直连地址>' pnpm db:migrate  # 首次及每次改 schema 后先迁移
# 密钥：逐个 `pnpm exec wrangler secret put <NAME>`，或 `pnpm exec wrangler deploy --secrets-file <文件>`
#   必填：DATABASE_URL FEISHU_APP_ID FEISHU_APP_SECRET FEISHU_VERIFICATION_TOKEN LINEAR_API_KEY LINEAR_WEBHOOK_SECRET
#   建议：ADMIN_TOKEN CRON_SECRET；可选：FEISHU_ENCRYPT_KEY OPENAI_API_KEY 等
pnpm deploy:worker
```

要点：

- 本地调试：`cp .dev.vars.example .dev.vars` 后 `pnpm dev:worker`。
- 飞书在国内回调，`*.workers.dev` 常无法解析，请绑定自己的域名（`routes` + `custom_domain`）。
- 建议用 `placement.region` 把 Worker 放到离数据库最近的机房；也可选用 Hyperdrive 复用连接（配置见示例文件注释，代码会优先使用 `HYPERDRIVE` 绑定）。
- 每个请求独立建连接池（`DB_MODE=per-request`），请求及后台任务结束后关闭。
- 响应后的后台任务（`waitUntil`）最多再运行约 30 秒，Agent 单次对话需在此内完成。
- 每个请求会记录访问日志并返回 `Server-Timing`，便于观察飞书 3 秒限制内的耗时（`pnpm exec wrangler tail`）。

### Vercel + Neon

1. Neon 建库，使用 pooled 连接串（host 含 `-pooler`）作为 `DATABASE_URL`，并先对库执行一次 `pnpm db:migrate`。
2. `vercel link && vercel deploy --prod`。入口 `src/index.ts` 被识别为 Koa 应用；`vercel.json` 配置了区域与每日 `/cron/cleanup`，区域请按你的数据库位置调整。
3. 在项目里配置环境变量，另加 `CRON_SECRET`（Vercel 调用 Cron 时自动携带）和 `ADMIN_TOKEN`。

### Docker + Caddy（VPS，自动 HTTPS）

要求：一台能同时访问飞书和 Linear 的服务器，域名解析到该机，开放 80 / 443。

```bash
cp .env.example .env     # 填凭据，并设置 DOMAIN、PUBLIC_URL、POSTGRES_PASSWORD、ADMIN_TOKEN
docker compose up -d --build   # 启动时自动执行迁移，Postgres 随 compose 一起启动
curl https://$DOMAIN/health
```

使用外部 Postgres 时去掉 `postgres` 服务并修改 `app.environment.DATABASE_URL`。Caddy 仅放行 `/health`、`/webhook/*`、`/oauth/linear/*`、`/api/*`。

## 许可

[AGPL-3.0](LICENSE)。如果你修改了本项目并通过网络向他人提供服务，需要向这些用户提供修改后的完整源码。
