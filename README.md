# Feishu × Linear

对标 Slack-Linear 集成的飞书连接器。

## 架构

```
src/
├── adapters/          # 平台接入层（只懂飞书/Linear SDK）
│   ├── feishu/        # EventDispatcher（webhook-only）+ 消息/卡片 API
│   └── linear/        # OAuth(actor=app) / API Key + Webhook 验签 + GraphQL
├── domain/            # 业务领域（不依赖 HTTP）
│   ├── issues/        # 创建 / 分配 / 卡片数据
│   ├── sync/          # 话题 ↔ Issue 评论双向同步
│   ├── notify/        # 团队 / 项目 / 个人 / 项目频道
│   ├── users/         # 飞书 ↔ Linear 用户映射（邮箱绑定）
│   └── agent/         # @机器人自然语言（OpenAI tools）
├── transport/http/    # Koa 路由
├── cards/             # 飞书卡片 JSON 2.0
├── db/                # Postgres + Drizzle（schema / 迁移）
└── app/               # AppContext 组装
```

### 接入原则

| 侧 | 方式 | 说明 |
|---|---|---|
| 飞书事件/回调 | 官方 `EventDispatcher` + `adaptKoaRouter` | 自动 challenge / 验签 / 解密 |
| 飞书本地开发 | 内网穿透（ngrok / cloudflared）暴露 `/webhook/feishu` | 仅 webhook，无长连接模式 |
| Linear Webhook | `@linear/sdk/webhooks` `LinearWebhookClient` | HMAC + `webhookTimestamp`（毫秒） |
| Linear 鉴权 | `api_key` 或 OAuth `actor=app` | OAuth 才支持 `createAsUser` |

## 快速开始

```bash
cp .env.example .env
# 填入飞书 APP_ID/SECRET、Linear API Key
npm install
npm run dev
```

健康检查：`GET /health`

## 数据库

Postgres（任意托管或自建，推荐 [Neon](https://neon.tech)）。`DATABASE_URL` 必填。

```bash
npm run db:generate   # 改了 src/db/schema.ts 后生成迁移 SQL（提交 drizzle/ 目录）
npm run db:migrate    # 应用迁移（幂等）
```

本地开发起一个 Postgres：

```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=fl postgres:17-alpine
# DATABASE_URL=postgres://postgres:pw@localhost:5432/fl
```

测试（Postgres 相关用例在设置 `TEST_DATABASE_URL` 时才运行，需先 `db:migrate`）：

```bash
TEST_DATABASE_URL=postgres://postgres:pw@localhost:5432/fl npm test
```

## 部署

同一份代码支持两种部署方式；后台任务（先 ACK 再处理）、定时清理、连接池会按运行环境自动适配。

### A. Vercel + Neon（免运维）

1. Neon 建库，复制 **pooled** 连接串（host 含 `-pooler`）作为 `DATABASE_URL`。
2. 本机对 Neon 执行一次迁移：`DATABASE_URL=<neon 连接串> npm run db:migrate`（以后改 schema 同样先迁移再发版）。
3. `vercel link && vercel deploy --prod`（或接 Git 仓库）。入口 `src/index.ts` 被识别为 Koa，整个应用是一个 Fluid Function；`vercel.json` 把区域钉在香港 `hkg1`，并配置每日 `/cron/cleanup` 清理。
4. 在 Vercel 项目里配置 `.env.example` 中的必填项，另加 `CRON_SECRET`（随机串，Vercel 调 Cron 时自动带上）和 `ADMIN_TOKEN`；`PUBLIC_URL` 填你的域名。
5. 飞书 / Linear 后台的回调地址指向 `https://<域名>/webhook/feishu`、`/webhook/linear`。

注意：Neon 与函数区域尽量靠近；飞书卡片 / 链接预览回调必须 3 秒内返回。

### B. Docker + Caddy（VPS，自动 HTTPS）

要求：一台能访问 Linear / 飞书的服务器（推荐香港 / 新加坡 / 东京），域名已解析到该机，开放 80/443。Postgres 随 compose 一起启动。

```bash
git clone https://github.com/IchenDEV/feishu-linear && cd feishu-linear
cp .env.example .env      # 填飞书 / Linear 凭据，并设置：
#   DOMAIN=linear.example.com
#   PUBLIC_URL=https://linear.example.com
#   POSTGRES_PASSWORD=<随机串>    ADMIN_TOKEN=<随机串>
docker compose up -d --build      # 启动时自动执行迁移
curl https://linear.example.com/health
```

- 使用 compose 内置 Postgres 时，`.env` 里的 `DATABASE_URL` 会被 compose 覆盖；改用外部 Postgres 请去掉 `postgres` 服务并修改 `app.environment.DATABASE_URL`。
- Caddy 放行 `/health`、`/webhook/*`、`/oauth/linear/*`、`/api/*`；`/api/*` 需 `Authorization: Bearer $ADMIN_TOKEN`。
- 备份：`docker compose exec postgres pg_dump -U feishu_linear feishu_linear > backup.sql`。
- 更新：`git pull && docker compose up -d --build`；日志：`docker compose logs -f app`。

## 管理 API 鉴权

`/api/*` 需要 `Authorization: Bearer <ADMIN_TOKEN>`；未配置 `ADMIN_TOKEN` 时整体返回 503。
`/cron/cleanup` 需要 `Authorization: Bearer <CRON_SECRET>`。

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<域名>/api/teams
```

## 飞书来源校验

飞书 SDK 只在配置 Encrypt Key 时校验签名，不会比对 Verification Token。本项目对每个事件 / 回调额外校验 `header.token`，不匹配返回 401。建议同时在飞书后台开启「加密」并配置 `FEISHU_ENCRYPT_KEY`。

## 飞书开发者后台配置

1. **机器人能力**：开启
2. **事件订阅**：订阅方式选「将事件发送至开发者服务器」
   - 请求地址：`https://your-domain/webhook/feishu`
   - 记下 Verification Token → `FEISHU_VERIFICATION_TOKEN`（必填）
   - 如开启加密，Encrypt Key → `FEISHU_ENCRYPT_KEY`
   - 添加事件：`im.message.receive_v1`、`application.bot.menu_v6`
3. **回调订阅**：同样选「将回调发送至开发者服务器」，请求地址同上
   - `card.action.trigger`
   - `url.preview.get`（链接预览，URL 规则：`linear.app/*`）
4. 卡片交互与链接预览回调须在 **3 秒内** 返回；事件类请求会先 ACK 再后台处理。
5. **权限**（最小集）
   - `im:message` / `im:message:send_as_bot`
   - `im:message.group_at_msg:readonly` + `im:message.p2p_msg:readonly`
   - `im:chat` / `im:chat:create`（项目频道自动创建）
   - `contact:user.base:readonly` / `contact:user.id:readonly`（用户绑定）

> 本地开发：先 `npm run dev`，再用 `cloudflared tunnel --url http://localhost:3000`（或 ngrok）拿到公网地址，填入后台保存即可通过 challenge 校验。

## Linear 配置

### API Key 模式（默认）

1. Linear → Settings → API → Personal API keys
2. 创建 Webhook，URL：`https://your-domain/webhook/linear`
3. 勾选 `Issue` / `Comment` / `Project`
4. 把 Signing Secret 写入 `LINEAR_WEBHOOK_SECRET`

### OAuth actor=app（推荐生产）

1. 创建 OAuth Application，开启 Webhooks + Agent session events（可选）
2. Redirect URI：`https://your-domain/oauth/linear/callback`
3. `.env` 设 `LINEAR_AUTH_MODE=oauth` 并填 Client ID/Secret
4. 浏览器打开 `/oauth/linear/install`，管理员授权
5. 把返回的 `appUserId` 写入 `LINEAR_APP_USER_ID`（防回声）

## 使用方式

| 操作 | 怎么用 |
|---|---|
| 绑定账号 | 私聊机器人：`bind you@company.com` |
| 自然语言 | 群里 `@机器人 建一个 bug 并分配给我` |
| 表单创建 | 私聊 `create`，或卡片「创建 Issue」 |
| 同步线程 | 表单点「创建并同步线程」 |
| Issue 展开 | 消息里写 `ENG-123` 或贴 Linear 链接 |
| 通知配置 | `POST /api/notification` |
| Agent Guidance | `POST /api/guidance` |

## API

| Method | Path | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| POST | `/webhook/feishu` | 飞书事件+回调统一入口 |
| POST | `/webhook/linear` | Linear Webhook |
| GET | `/oauth/linear/install` | OAuth 安装 |
| POST | `/api/bind` | 用户绑定（`/api/*` 均需 Bearer `ADMIN_TOKEN`） |
| POST | `/api/notification` | 通知配置 |
| POST | `/api/guidance` | 频道 Agent Guidance |
| GET | `/api/teams` | 列出 Linear 团队 |
| GET | `/cron/cleanup` | 清理过期去重记录（Bearer `CRON_SECRET`） |

## 与旧版差异（本次重构修掉的坑）

1. **飞书 `@机器人` 检测**：改用 `mentioned_type === "bot"`，不再误判 `cli_` 前缀
2. **消息类型字段**：事件里是 `message_type`，不是 `msg_type`
3. **Linear 时间戳**：`webhookTimestamp` 本身就是毫秒，不再 `* 1000`
4. **验签**：飞书走官方 Dispatcher；Linear 走官方 `LinearWebhookClient.verify(rawBody, …)`
5. **卡片表单**：改用 Card JSON 2.0 `form` + `form_value`
6. **回声过滤**：用 `LINEAR_APP_USER_ID` / viewer id 过滤自身 webhook
