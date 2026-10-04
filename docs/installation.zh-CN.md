# 安装指南

[English](installation.md) · **简体中文**

本文带你从零部署一个可用的飞书 × Linear 连接器，约 30 分钟。任何阶段都可以运行 `pnpm setup:check` 查看还缺什么。

- [0. 前置条件](#0-前置条件)
- [1. 创建飞书应用](#1-创建飞书应用)
- [2. 配置 Linear](#2-配置-linear)
- [3. 配置连接器](#3-配置连接器)
- [4. 部署](#4-部署)
- [5. 把飞书接到你的部署](#5-把飞书接到你的部署)
- [6. 验证](#6-验证)
- [7. 可选功能](#7-可选功能)
- [常见问题](#常见问题)

## 0. 前置条件

| 需要 | 说明 |
|---|---|
| 可创建企业自建应用的飞书租户 | 发布应用版本需要管理员审批 |
| Linear 工作区，且有权限创建 API Key / Webhook | 建议工作区管理员 |
| 一个 Postgres 数据库 | 任意托管均可，推荐 [Neon](https://neon.tech) |
| 连接器的公网 HTTPS 地址 | 强烈建议使用自己的域名（`*.workers.dev` 在中国大陆常无法解析） |
| Node ≥ 22 与 pnpm | 仅用于迁移和部署；Docker 方式只需 Docker |

## 1. 创建飞书应用

1. 打开[飞书开放平台](https://open.feishu.cn/app) → **创建企业自建应用**。
2. **添加应用能力 → 机器人**，并启用。
3. **凭证与基础信息**：复制 **App ID** 与 **App Secret** → `FEISHU_APP_ID`、`FEISHU_APP_SECRET`。
4. **事件与回调 → 加密策略**：复制 **Verification Token** → `FEISHU_VERIFICATION_TOKEN`；可选设置 **Encrypt Key** → `FEISHU_ENCRYPT_KEY`。
5. **权限管理**：开通下表权限（租户身份）。最快的方式是完成第 3 步后运行 `pnpm setup:check`，它会列出缺失权限并给出一键申请的控制台链接。

| 权限 | 用途 |
|---|---|
| `im:message:send_as_bot`、`im:message:readonly`、`im:message:update` | 发送、读取、更新机器人消息与卡片 |
| `im:message.p2p_msg:readonly`、`im:message.group_at_msg:readonly` | 接收私聊与 @机器人 消息 |
| `im:chat:read`、`im:resource` | 会话信息、图片 / 文件上传下载 |
| `contact:user.base:readonly`、`contact:user.id:readonly`、`contact:user.email:readonly` | 识别用户并按邮箱关联 Linear 账号 |
| `im:message.group_msg` | *Agent：* 读取群内近期消息作为上下文 |
| `im:message.reactions:write_only` | *Agent：* 「处理中」表情 |
| `im:chat:create`、`im:chat:update`、`im:chat.members:write_only`、`im:chat.managers:write_only`、`im:chat.tabs:write_only`、`im:chat.top_notice:write_only`、`im:message.pins:write_only` | *项目频道* |

权限清单的权威来源是 [`src/setup/requirements.ts`](../src/setup/requirements.ts)，`pnpm setup:check` 与本文共用。

事件订阅、机器人菜单、消息快捷操作要等有了公网地址之后再配（第 5 步），此时先不要发布版本。

## 2. 配置 Linear

两种模式任选。建议先用 `api_key`，需要评论显示为真实用户时再切到 `oauth`。

### 方式 A —— API Key（最快）

1. Linear → **Settings → Account → Security & access → Personal API keys** 创建 Key → `LINEAR_API_KEY`。
   建议用一个专门的机器人 / 服务账号，避免操作都记在某个人头上。
2. 设置 `LINEAR_AUTH_MODE=api_key`。

### 方式 B —— OAuth（actor=app）

1. Linear → **Settings → API → OAuth applications → New**，回调地址 `https://<你的域名>/oauth/linear/callback`。
2. 设置 `LINEAR_AUTH_MODE=oauth`、`LINEAR_CLIENT_ID`、`LINEAR_CLIENT_SECRET`、`LINEAR_REDIRECT_URI`。
3. 部署后，由工作区管理员访问一次 `https://<你的域名>/oauth/linear/install` 授权。

### Webhook

连接器需要 Webhook 才能收到 Linear 的变更。

- **自动：** 部署后运行 `pnpm setup:check --create-linear-webhook`，会创建 Webhook 并**仅打印一次**签名密钥，请保存为 `LINEAR_WEBHOOK_SECRET`。
- **手动：** Linear → **Settings → API → Webhooks → New webhook**，URL 填 `https://<你的域名>/webhook/linear`，资源勾选 **Issues、Comments、Projects、Project updates、Initiatives、Initiative updates**，把 Signing secret 填入 `LINEAR_WEBHOOK_SECRET`。

## 3. 配置连接器

按部署方式复制对应模板并填写：

| 部署方式 | 模板 | 密钥存放 |
|---|---|---|
| Node / Docker / Vercel | `.env.example` → `.env` | `.env` / 平台环境变量 |
| Cloudflare Workers | `wrangler.example.jsonc` → `wrangler.jsonc`，`.dev.vars.example` → `.dev.vars` | `wrangler secret put` |

最少必填：`DATABASE_URL`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_VERIFICATION_TOKEN`、`LINEAR_API_KEY`（或 OAuth 凭据）、`LINEAR_WEBHOOK_SECRET`、`PUBLIC_URL`。

强烈建议：`ADMIN_TOKEN`（启用 `/api/*`）、`CRON_SECRET`。

可选：

| 变量 | 作用 |
|---|---|
| `DEFAULT_LOCALE`（`zh-CN` / `en`） | 工作区默认语言 |
| `OPENAI_API_KEY`（及 `OPENAI_BASE_URL`、`OPENAI_MODEL`） | @机器人 Agent |
| `MCP_TOKEN` | `/mcp` 端点 |
| `FEISHU_LINK_PREVIEW=true` | 原生链接预览（第 5 步配置好之后再设） |

然后应用数据库结构（幂等，升级后可重复执行）：

```bash
pnpm install
pnpm db:migrate
```

> **Neon 提示：** 迁移用*直连*地址（不带 `-pooler`），运行时用 pooled 地址。

## 4. 部署

三种形态运行同一份代码，任选其一。

### Cloudflare Workers

```bash
cp wrangler.example.jsonc wrangler.jsonc       # 填自定义域名 routes、PUBLIC_URL、DEFAULT_LOCALE…
pnpm exec wrangler secret put DATABASE_URL
pnpm exec wrangler secret put FEISHU_APP_ID
pnpm exec wrangler secret put FEISHU_APP_SECRET
pnpm exec wrangler secret put FEISHU_VERIFICATION_TOKEN
pnpm exec wrangler secret put LINEAR_API_KEY
pnpm exec wrangler secret put LINEAR_WEBHOOK_SECRET
pnpm exec wrangler secret put ADMIN_TOKEN       # 建议
pnpm exec wrangler secret put CRON_SECRET        # 建议
pnpm deploy:worker
```

- 也可批量上传密钥：`wrangler deploy --secrets-file <文件>`。
- 绑定自己的域名（`routes` + `custom_domain`），并用 `placement.region` 把 Worker 放到离数据库最近的机房。
- 定时任务（每日清理、每 10 分钟视图轮询）已在配置中声明。
- 本地调试：`cp .dev.vars.example .dev.vars && pnpm dev:worker`。

### Vercel + Neon

1. 在 Neon 建库，`DATABASE_URL` 用 **pooled** 连接串；对**直连**地址执行一次 `pnpm db:migrate`。
2. `vercel link && vercel deploy --prod`；在项目设置里配置环境变量，另加 `CRON_SECRET`（Vercel 调用 Cron 时自动携带）。
3. `vercel.json` 已配置 `/cron/cleanup` 与 `/cron/views`。Hobby 套餐只允许每日一次的 Cron，视图订阅需 Pro 或外部定时调用 `/cron/views`。

### Docker + Caddy（VPS，自动 HTTPS）

```bash
cp .env.example .env     # 填凭据，并设置 DOMAIN、PUBLIC_URL、POSTGRES_PASSWORD、ADMIN_TOKEN
docker compose up -d --build
curl https://$DOMAIN/health
```

启动时自动执行迁移。使用外部 Postgres 时，去掉 `postgres` 服务并修改 `app.environment.DATABASE_URL`。Caddy 仅放行 `/health`、`/webhook/*`、`/oauth/linear/*`、`/api/*`、`/mcp`、`/h5/*`。

确认部署成功：`curl https://<你的域名>/health` → `{"status":"ok",…}`。

## 5. 把飞书接到你的部署

在应用的开发者后台：

1. **事件与回调 → 订阅方式** → 选「将事件发送至开发者服务器」，请求地址 `https://<你的域名>/webhook/feishu`。保存时后台会立即校验，所以部署必须已经在线。
2. **添加事件：** `im.message.receive_v1`（接收消息）与 `application.bot.menu_v6`（机器人自定义菜单）。
3. **回调配置 → 添加回调：** `card.action.trigger`（卡片交互）；需要原生链接预览时再加 `url.preview.get`。
4. **机器人菜单**（可选）：添加三项，事件 key 分别为 `create_issue`、`my_notifications`、`help`。
5. **斜杠命令：** 运行 `pnpm setup:check --register-commands` 注册 `/linear` 与 `/ask`（不注册也能用，以 `/` 开头的文本同样会被处理）。
6. **链接预览**（可选）：*应用功能 → 链接预览*，URL 规则填 `linear.app/*`，回调地址同上；然后设置 `FEISHU_LINK_PREVIEW=true` 并重新部署。不配置时，机器人会用回复卡片展开链接。
7. **消息快捷操作 / H5**（可选）：
   1. *应用功能 → 网页应用*：主页填 `https://<你的域名>/h5/message-action`，并在*安全设置*里把你的域名加入重定向 / H5 可信域名。
   2. *应用功能 → 消息快捷操作*：链接填 `https://<你的域名>/h5/message-action`。
   3. 之后在任意消息的「更多」菜单里就能选择「转为 Linear Issue」。
8. **创建版本并发布。** 权限变更需要租户管理员审批。

> 事件订阅、机器人菜单、H5 配置无法通过 API 读取，`pnpm setup:check` 只能提醒你手动核对。

## 6. 验证

```bash
pnpm setup:check     # 读取 .env；检查远端部署时先 export PUBLIC_URL=…
```

所有项应为 ✅（⚠️ 为可选功能）。然后在飞书里：

1. 把机器人拉进群或私聊它，发送 `/linear help`。
2. 发送 `/linear` → 填表单 → Linear 里创建出 Issue。
3. 在 Linear 里新建 / 评论 Issue → 已订阅的群收到通知。
4. `@机器人 分配给我的 Issue 有哪些？`（需要 `OPENAI_API_KEY`）。

## 7. 可选功能

| 功能 | 如何启用 |
|---|---|
| **语言** | 工作区用 `DEFAULT_LOCALE`；群（管理员）或个人（`/linear me`）用 `/linear lang zh\|en\|auto`。通知按每位接收人的语言分别渲染。 |
| **Agent** | 设置 `OPENAI_API_KEY`（`OPENAI_BASE_URL` 可指向任意 OpenAI 兼容接口）。每群默认值与 Guidance 在 `/linear settings`。 |
| **Asks** | 管理员在 `/linear settings` 启用后，任何人都可 `/ask …`，无需 Linear 账号。 |
| **项目频道** | 在 `/linear settings` 开启；需要 `im:chat*` 相关权限。 |
| **MCP** | 设置 `MCP_TOKEN`；MCP 客户端连接 `https://<你的域名>/mcp`，带 `Authorization: Bearer <MCP_TOKEN>`。 |
| **管理 API** | 设置 `ADMIN_TOKEN` 后即可使用 `/api/*`。 |

### 账号如何打通

飞书与 Linear 的身份靠 **邮箱** 匹配：用户首次使用时读取其飞书邮箱，到 Linear 查找同邮箱用户（`/linear me` 可查看状态）。若飞书账号读不到邮箱，可用 `/linear bind <邮箱>`，该邮箱必须与自己的飞书邮箱一致。管理员可通过 `POST /api/bind` 绑定任意组合。

## 常见问题

| 现象 | 处理 |
|---|---|
| 后台提示「请求地址校验失败」 | 部署必须可经 HTTPS 访问，且 `FEISHU_VERIFICATION_TOKEN` 一致。先检查 `/health`。 |
| 机器人不响应消息 | 确认已订阅 `im.message.receive_v1`、应用版本已发布、机器人在会话里（群里需 @）。 |
| 点按钮报错 / 超时 | 卡片回调须在 3 秒内响应。查看日志；把 Worker 放到离数据库近的区域（`placement.region`）。 |
| 提示「无法确认你的身份：你的飞书账号没有可读取的邮箱」 | 开通 `contact:user.email:readonly`，或让管理员用 `POST /api/bind` 帮你绑定。 |
| 收不到 Linear 的变更 | 检查 Webhook 地址、是否启用、`LINEAR_WEBHOOK_SECRET` 是否一致；`pnpm setup:check` 会检查。 |
| 链接没有展开 | 要么配置链接预览并设 `FEISHU_LINK_PREVIEW=true`，要么保持 `false` 使用回复卡片。私有团队不展开。 |
| 评论显示为 API Key 所属账号 | `api_key` 模式下的预期行为；要真实用户署名请用 OAuth。 |
| 升级后报 `column "locale" does not exist` | 执行 `pnpm db:migrate`（表结构有变更）。 |
| `pg-connection-string` 的 SSL 警告 | 无害；在连接串后加 `sslmode=verify-full` 可消除。 |
