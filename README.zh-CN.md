# 飞书 × Linear

[English](README.md) · **简体中文**

[飞书](https://www.feishu.cn) 版的 [Linear](https://linear.app) 集成，对标 [Linear 官方 Slack 集成](https://linear.app/docs/slack)：在飞书里创建 / 关联 Issue，话题与 Linear 评论双向同步，接收通知，展开 Linear 链接，并支持 @机器人 用自然语言操作 Linear。

- **中英双语**：所有卡片、命令回复、通知与报错都有简体中文和 English 版本；语言按「用户 → 群 → 工作区」依次解析，可用 `/linear lang` 随时切换。
- **纯 Webhook**：飞书事件 / 卡片回调 / 链接预览共用 `POST /webhook/feishu`，Linear 走 `POST /webhook/linear`，无需长连接。
- **随处部署**：同一份代码可跑在 Cloudflare Workers、Vercel 或 Docker 上。
- **技术栈**：Node ≥ 22 · TypeScript (ESM) · Koa · Postgres + Drizzle · `@larksuiteoapi/node-sdk` · `@linear/sdk`。

## 快速开始

> 完整安装指南：**[docs/installation.zh-CN.md](docs/installation.zh-CN.md)**（[English](docs/installation.md)）。

```bash
git clone https://github.com/IchenDEV/feishu-linear.git && cd feishu-linear
pnpm install
cp .env.example .env          # 填飞书 / Linear 凭据与 DATABASE_URL
pnpm db:migrate               # 应用数据库迁移（幂等）
pnpm dev                      # 把 /webhook/* 暴露到公网，例如 `cloudflared tunnel --url http://localhost:3000`
pnpm setup:check              # 自检权限、回调、斜杠命令、Webhook 与连通性
```

`pnpm setup:check` 会对照连接器的需求检查你的飞书应用与 Linear 工作区，并准确指出缺什么。加 `--register-commands` 可自动注册 `/linear`、`/ask` 斜杠命令，加 `--create-linear-webhook` 可自动创建 Linear Webhook。

## 与 Linear × Slack 的功能对标

✅ 已实现 · 🟡 已实现，但需在飞书后台手动配置或因平台限制与 Slack 有差异。

| 能力 | 状态 | 说明 |
|---|---|---|
| **Agent（@机器人）** | ✅ | 自然语言查询 / 创建 / 更新 / 评论 / 关联 Issue、订阅、列团队 / 项目 / 状态 / 标签 / 成员 / Initiative / 模板、建文档；自动读取所在话题与群近期消息作为上下文，支持图片与文件并上传到 Linear，按群默认团队 / 项目推断。需配置 `OPENAI_API_KEY` |
| Agent Guidance | ✅ | 群设置卡片里按群配置默认团队 / 项目 / 指令；管理员可配置全局指令 |
| **创建 Issue** | ✅ | 消息快捷操作（H5 🟡）、`/linear` 命令（话题 / 回复消息转 Issue）、`/linear link` 关联已有 Issue、卡片表单（团队 / 项目 / 模板 / 标签 / 负责人 / 优先级）、附件上传 |
| **线程双向同步** | ✅ | 文本 / 图片 / 文件双向同步；完成 / 取消 / 重复状态提示；重复 Issue 自动联动到原 Issue；`POST /api/sync-thread` 与 MCP 工具可为已有 Issue 建同步线程 |
| **团队通知** | ✅ | 订阅团队的新建 / 状态 / 评论等事件到群 |
| **项目通知** | ✅ | 项目及项目更新 |
| **Initiative 通知** | ✅ | Initiative 及其更新 |
| **个人通知** | ✅ | 被分配 / 被 @ / 评论 / 状态变化等私聊推送，`/linear me` 按类型开关 |
| **视图订阅** | ✅ | 订阅 Linear 自定义视图，定时轮询（默认每 10 分钟），有 Issue 进入视图即推送 |
| **项目频道** | ✅ | 默认关闭；开启后新建项目自动建群、邀请成员、置顶简介与 Linear 标签页，改名 / 成员变化同步 |
| **链接展开** | ✅ | Issue / Project / Document / Initiative；链接预览 🟡 或机器人回复卡片；卡片内改负责人、评论、订阅、升级为同步线程；私有团队不展开 |
| **Linear MCP / AI 生态** | ✅ | `/mcp` 端点（Streamable HTTP，Bearer `MCP_TOKEN`）：Linear 读写工具 + 飞书读消息 / 发消息 / 回复 / 同步线程 |
| **权限** | ✅ | 操作需绑定 Linear 账号；`/ask` 面向无 Linear 席位的成员提需求（管理员启用）；设置仅群主 / 群管理员 / Linear 管理员可改 |
| **多语言** | ✅ | 全部界面支持简体中文与 English，通知按接收人语言分别渲染 |

与 Slack 版的平台差异：

- 飞书没有原生「消息快捷操作」的服务端回调，本项目通过 **H5 网页应用 + 消息快捷操作** 实现，需在开发者后台配置一次。
- 评论署名：`api_key` 模式下评论由 Key 所属账号发出，并带「发送者（来自飞书）」前缀；要以真实用户身份发评论请用 `oauth`（actor=app）模式。
- 「仅自己可见」使用飞书临时卡片（仅普通群可用），否则退回机器人私聊。

## 使用方式

| 操作 | 怎么用 |
|---|---|
| 帮助 | `/linear help`（或 `/linear 帮助`） |
| 绑定账号 | 飞书账号可读取邮箱时自动按邮箱绑定；否则 `/linear bind you@company.com`（邮箱必须与你的飞书邮箱一致） |
| 自然语言 | `@机器人 把这个话题整理成 Issue 并分配给我` |
| 创建 Issue | `/linear` 或 `/linear create 标题`；在话题内 / 回复某条消息时发送会把该消息转成 Issue；也可用消息快捷操作、机器人菜单 |
| 关联已有 Issue | `/linear link ENG-123` |
| 同步线程 | 表单里选「创建并同步线程」、`/linear sync ENG-123`，或 Issue 卡片上的「升级为同步线程」 |
| 个人通知偏好 | `/linear me` |
| 群设置 | `/linear settings`（默认团队 / 项目、通知订阅、视图、Guidance、Asks、项目频道、语言） |
| 项目专属群 | `/linear project-channel 项目名` |
| 向团队提需求 | `/ask 内容`（无需 Linear 账号，需管理员启用 Asks） |
| 切换语言 | `/linear lang zh` · `/linear lang en` · `/linear lang auto` |
| 链接展开 | 消息里写 `ENG-123` 或贴 Linear 链接 |

### 飞书与 Linear 的身份如何打通

靠 **邮箱** 匹配。用户首次操作时，连接器读取其飞书通讯录邮箱（`email` / `enterprise_email`，权限 `contact:user.email:readonly`），到 Linear 查同邮箱的用户并建立映射。手动 `/linear bind <邮箱>` 只允许绑定与**自己飞书账号邮箱一致**的地址，防止冒用他人身份；管理员可通过 `POST /api/bind` 绑定任意组合。

## 配置

全部通过环境变量，完整注释见 [`.env.example`](.env.example)。

| 变量 | 说明 |
|---|---|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 飞书应用凭据 |
| `FEISHU_VERIFICATION_TOKEN` | **必填**，每个事件 / 回调都会校验 |
| `FEISHU_ENCRYPT_KEY` | 开启「加密」时填写 |
| `LINEAR_AUTH_MODE` | `api_key`（默认）或 `oauth`（actor=app） |
| `LINEAR_API_KEY` / `LINEAR_CLIENT_ID` / `LINEAR_CLIENT_SECRET` | 对应鉴权模式的凭据 |
| `LINEAR_WEBHOOK_SECRET` | Linear Webhook 签名密钥，生产必填 |
| `DEFAULT_LOCALE` | `zh-CN`（默认）或 `en`，工作区默认语言 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | Agent 使用的 OpenAI 兼容接口；不配则 Agent 不可用 |
| `DATABASE_URL` | Postgres 连接串 |
| `MCP_TOKEN` | `/mcp` 的 Bearer Token；留空则禁用 |
| `FEISHU_LINK_PREVIEW` | 飞书后台配置好链接预览后设为 `true` |
| `ADMIN_TOKEN` / `CRON_SECRET` | `/api/*`、`/cron/*` 的 Bearer Token |
| `PUBLIC_URL` | 服务对外地址 |

## HTTP API

| Method | Path | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| POST | `/webhook/feishu` | 飞书事件 + 卡片回调 + 链接预览 |
| POST | `/webhook/linear` | Linear Webhook |
| GET | `/oauth/linear/install` · `/oauth/linear/callback` | OAuth 安装（仅 oauth 模式） |
| POST | `/api/bind` | 绑定飞书 ↔ Linear 用户（管理员） |
| POST | `/api/notification` | 创建通知订阅 |
| POST | `/api/guidance` | 设置群的 Agent Guidance |
| POST | `/api/sync-thread` | 为已有 Issue 创建同步线程（`{issueId, chatId}`） |
| POST | `/api/project-channel` | 为项目创建专属群 |
| GET | `/api/teams` | 列出 Linear 团队 |
| GET | `/cron/cleanup` · `/cron/views` | 清理 · 轮询视图订阅 |
| POST | `/mcp` | MCP 端点 |
| GET | `/h5/message-action` | 消息快捷操作网页（及 `/h5/api/*`） |

`/api/*` 需要 `Authorization: Bearer <ADMIN_TOKEN>`（未配置返回 503）；`/cron/*` 需要 `Bearer <CRON_SECRET>`。

## 部署

三选一，详见 [docs/installation.zh-CN.md](docs/installation.zh-CN.md#4-部署)。

| 目标 | 命令 |
|---|---|
| Cloudflare Workers | `cp wrangler.example.jsonc wrangler.jsonc && pnpm deploy:worker` |
| Vercel + Neon | `vercel link && vercel deploy --prod` |
| Docker + Caddy | `docker compose up -d --build` |

个人部署信息（域名、账号、密钥）不要提交到仓库：`.env`、`.dev.vars`、`wrangler.jsonc`、`.wrangler/`、`.vercel/` 均已被 `.gitignore` 忽略，仓库只保留 `*.example` 模板。

## 开发

```
src/
├── adapters/       平台接入层（只懂飞书 / Linear SDK）
├── domain/         业务：issues、sync、notify、users、agent、settings、mcp
├── i18n/           语言解析 + 类型化的 zh-CN / en 文案目录
├── cards/          飞书卡片 JSON 2.0
├── transport/      Koa 路由、中间件、H5 页面
├── db/             Postgres + Drizzle（schema / 迁移）
├── setup/ · cli/   部署需求清单 + `pnpm setup:check`
├── worker.ts       Cloudflare Workers 入口
└── index.ts        Node / Vercel 入口
```

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 开发（`tsx watch`） |
| `pnpm build` / `pnpm start` | 构建 / 运行 |
| `pnpm typecheck` / `pnpm test` | 类型检查 / 测试 |
| `pnpm db:generate` / `pnpm db:migrate` | 改 `src/db/schema.ts` 后生成迁移 / 应用迁移 |
| `pnpm setup:check` | 部署自检 |
| `pnpm dev:worker` / `pnpm deploy:worker` | Workers 本地调试 / 部署 |

Postgres 相关测试仅在设置 `TEST_DATABASE_URL` 时运行（会清空表，请用专用库）。参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

[AGPL-3.0-only](LICENSE)。如果你修改了本项目并通过网络向他人提供服务，需要向这些用户提供修改后的完整源码。
