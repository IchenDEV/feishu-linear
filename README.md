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
├── db/                # SQLite + Drizzle
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
| POST | `/api/bind` | 用户绑定 |
| POST | `/api/notification` | 通知配置 |
| POST | `/api/guidance` | 频道 Agent Guidance |
| GET | `/api/teams` | 列出 Linear 团队 |

## 与旧版差异（本次重构修掉的坑）

1. **飞书 `@机器人` 检测**：改用 `mentioned_type === "bot"`，不再误判 `cli_` 前缀
2. **消息类型字段**：事件里是 `message_type`，不是 `msg_type`
3. **Linear 时间戳**：`webhookTimestamp` 本身就是毫秒，不再 `* 1000`
4. **验签**：飞书走官方 Dispatcher；Linear 走官方 `LinearWebhookClient.verify(rawBody, …)`
5. **卡片表单**：改用 Card JSON 2.0 `form` + `form_value`
6. **回声过滤**：用 `LINEAR_APP_USER_ID` / viewer id 过滤自身 webhook
