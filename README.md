# Feishu × Linear

**English** · [简体中文](README.zh-CN.md)

A [Linear](https://linear.app) integration for [Feishu / Lark](https://www.feishu.cn), modelled on [Linear's official Slack integration](https://linear.app/docs/slack). Create and link issues from chat, keep Feishu threads and Linear comments in sync, receive notifications, unfurl Linear links, and drive Linear in natural language by @-mentioning the bot.

- **Bilingual UI** — every card, command reply, notification and error is available in 简体中文 and English. Language is resolved per user → chat → workspace, switchable at runtime with `/linear lang`.
- **Webhook only** — Feishu events, card callbacks and link previews share a single `POST /webhook/feishu`; Linear uses `POST /webhook/linear`. No long-lived connections.
- **Run anywhere** — the same code runs on Cloudflare Workers, Vercel, or Docker.
- **Stack** — Node ≥ 22 · TypeScript (ESM) · Koa · Postgres + Drizzle · `@larksuiteoapi/node-sdk` · `@linear/sdk`.

## Quick start

> Full walkthrough: **[docs/installation.md](docs/installation.md)** (also in [简体中文](docs/installation.zh-CN.md)).

```bash
git clone https://github.com/IchenDEV/feishu-linear.git && cd feishu-linear
pnpm install
cp .env.example .env          # fill in Feishu + Linear credentials and DATABASE_URL
pnpm db:migrate               # apply database migrations (idempotent)
pnpm dev                      # expose /webhook/* publicly, e.g. `cloudflared tunnel --url http://localhost:3000`
pnpm setup:check              # verify scopes, callbacks, slash commands, webhook and reachability
```

`pnpm setup:check` audits your Feishu app and Linear workspace against what the connector needs and prints exactly what is missing. Add `--register-commands` to register the `/linear` and `/ask` slash commands and `--create-linear-webhook` to create the Linear webhook for you.

## Feature parity with Linear × Slack

✅ implemented · 🟡 implemented, needs a manual Feishu console step or differs due to platform limits.

| Capability | Status | Notes |
|---|---|---|
| **Agent (@bot)** | ✅ | Natural-language query / create / update / comment / link issues, subscriptions, teams / projects / states / labels / members / initiatives / templates, documents. Reads the current thread and recent channel messages as context, understands images and files, uploads attachments to Linear, infers team / project from the chat's defaults. Requires `OPENAI_API_KEY`. |
| Agent guidance | ✅ | Per-chat default team / project / instructions in the settings card; workspace-wide guidance for admins. |
| **Create issues** | ✅ | Message action (H5 🟡), `/linear` command (turn a thread or replied-to message into an issue), `/linear link` for existing issues, card form (team / project / template / labels / assignee / priority), attachment upload. |
| **Two-way thread sync** | ✅ | Text, images and files both ways; completed / canceled / duplicate notices; duplicates follow the canonical issue; `POST /api/sync-thread` and an MCP tool can sync an existing issue. |
| **Team notifications** | ✅ | Subscribe a chat to new issues, status changes, comments, etc. |
| **Project notifications** | ✅ | Projects and project updates. |
| **Initiative notifications** | ✅ | Initiatives and initiative updates. |
| **Personal notifications** | ✅ | Assigned / mentioned / comments / status changes by DM, per-type toggles in `/linear me`. |
| **View subscriptions** | ✅ | Subscribe to a custom Linear view; polled (every 10 min) and pushed when issues enter it. |
| **Project channels** | ✅ | Opt-in. Creates a chat per new project, invites members, pins the intro and a Linear tab, keeps name and membership in sync. |
| **Link unfurling** | ✅ | Issues, projects, documents, initiatives — via Link Preview 🟡 or a bot reply card; change assignee, comment, subscribe, or upgrade to a synced thread inline; private teams are never unfurled. |
| **Linear MCP / AI ecosystem** | ✅ | `/mcp` endpoint (Streamable HTTP, Bearer `MCP_TOKEN`): Linear read/write tools plus Feishu read / send / reply / sync tools. |
| **Permissions** | ✅ | Actions require a linked Linear account; `/ask` lets people without Linear seats file requests (admin opt-in); only chat owners / chat admins / Linear admins can change settings. |
| **Localization** | ✅ | 简体中文 and English across all surfaces, per-recipient rendering for notifications. |

Platform differences from Slack:

- Feishu has no native server-side "message action" callback. This project ships an **H5 web app + message shortcut** instead, configured once in the developer console.
- Comment attribution: in `api_key` mode comments are posted by the key's owner with a "sender (from Feishu)" prefix. Use `oauth` (actor=app) for real-user attribution.
- "Only visible to you" uses Feishu ephemeral cards (regular groups only) and falls back to a bot DM.

## Usage

| Task | How |
|---|---|
| Help | `/linear help` |
| Link your account | Automatic by email when your Feishu account exposes one; otherwise `/linear bind you@company.com` (must match your Feishu email) |
| Natural language | `@bot turn this thread into an issue and assign it to me` |
| Create an issue | `/linear` or `/linear create <title>`; send it inside a thread or as a reply to convert that message; or use the message shortcut / bot menu |
| Link an existing issue | `/linear link ENG-123` |
| Sync a thread | Choose "Create & sync thread" in the form, `/linear sync ENG-123`, or "Upgrade to synced thread" on an issue card |
| Personal notifications | `/linear me` |
| Chat settings | `/linear settings` (defaults, subscriptions, views, guidance, Asks, project channels, language) |
| Project channel | `/linear project-channel <project>` |
| Request from the team | `/ask <text>` (no Linear account needed; an admin must enable Asks) |
| Language | `/linear lang zh` · `/linear lang en` · `/linear lang auto` |
| Unfurl | Mention `ENG-123` or paste a Linear link |

### How Feishu and Linear identities are linked

Identity is matched by **email**. When someone first acts, the connector reads their Feishu contact email (`email` / `enterprise_email`, scope `contact:user.email:readonly`) and looks up the Linear user with the same address. Manual `/linear bind <email>` is restricted to an address that matches the caller's own Feishu account — nobody can claim another person's Linear identity. Admins can bind arbitrary pairs via `POST /api/bind`.

## Configuration

All configuration is environment variables; see [`.env.example`](.env.example) for the full annotated list.

| Variable | Description |
|---|---|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Feishu app credentials |
| `FEISHU_VERIFICATION_TOKEN` | Required. Checked on every event / callback |
| `FEISHU_ENCRYPT_KEY` | When "Encrypt Key" is enabled |
| `LINEAR_AUTH_MODE` | `api_key` (default) or `oauth` (actor=app) |
| `LINEAR_API_KEY` / `LINEAR_CLIENT_ID` / `LINEAR_CLIENT_SECRET` | Credentials for the chosen mode |
| `LINEAR_WEBHOOK_SECRET` | Linear webhook signing secret (required in production) |
| `DEFAULT_LOCALE` | `zh-CN` (default) or `en` — workspace default language |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | Any OpenAI-compatible endpoint for the agent; unset = agent disabled |
| `DATABASE_URL` | Postgres connection string |
| `MCP_TOKEN` | Bearer token for `/mcp`; unset = MCP disabled |
| `FEISHU_LINK_PREVIEW` | `true` once Link Preview is configured in the console |
| `ADMIN_TOKEN` / `CRON_SECRET` | Bearer tokens for `/api/*` and `/cron/*` |
| `PUBLIC_URL` | Public base URL of the service |

## HTTP API

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/webhook/feishu` | Feishu events + card callbacks + link previews |
| POST | `/webhook/linear` | Linear webhook |
| GET | `/oauth/linear/install` · `/oauth/linear/callback` | OAuth install (oauth mode only) |
| POST | `/api/bind` | Bind a Feishu ↔ Linear user pair (admin) |
| POST | `/api/notification` | Create a notification subscription |
| POST | `/api/guidance` | Set agent guidance for a chat |
| POST | `/api/sync-thread` | Create a synced thread for an existing issue (`{issueId, chatId}`) |
| POST | `/api/project-channel` | Create a project channel |
| GET | `/api/teams` | List Linear teams |
| GET | `/cron/cleanup` · `/cron/views` | Housekeeping · poll view subscriptions |
| POST | `/mcp` | MCP endpoint |
| GET | `/h5/message-action` | Message-shortcut web app (plus `/h5/api/*`) |

`/api/*` needs `Authorization: Bearer <ADMIN_TOKEN>` (503 if unset); `/cron/*` needs `Bearer <CRON_SECRET>`.

## Deployment

Pick one — details in [docs/installation.md](docs/installation.md#4-deploy).

| Target | Command |
|---|---|
| Cloudflare Workers | `cp wrangler.example.jsonc wrangler.jsonc && pnpm deploy:worker` |
| Vercel + Neon | `vercel link && vercel deploy --prod` |
| Docker + Caddy | `docker compose up -d --build` |

Personal deployment details (domains, accounts, keys) never belong in the repo: `.env`, `.dev.vars`, `wrangler.jsonc`, `.wrangler/` and `.vercel/` are git-ignored; only `*.example` templates are tracked.

## Development

```
src/
├── adapters/       platform layer (Feishu / Linear SDKs only)
├── domain/         business logic: issues, sync, notify, users, agent, settings, mcp
├── i18n/           locale resolution + typed zh-CN / en message catalogs
├── cards/          Feishu card JSON 2.0 builders
├── transport/      Koa routes, middleware, H5 pages
├── db/             Postgres + Drizzle schema and migrations
├── setup/ · cli/   deployment requirements + `pnpm setup:check`
├── worker.ts       Cloudflare Workers entry
└── index.ts        Node / Vercel entry
```

| Command | Description |
|---|---|
| `pnpm dev` | Dev server (`tsx watch`) |
| `pnpm build` / `pnpm start` | Build / run |
| `pnpm typecheck` / `pnpm test` | Type-check / tests |
| `pnpm db:generate` / `pnpm db:migrate` | Generate (after editing `src/db/schema.ts`) / apply migrations |
| `pnpm setup:check` | Audit your deployment |
| `pnpm dev:worker` / `pnpm deploy:worker` | Workers local dev / deploy |

Postgres-backed tests run only when `TEST_DATABASE_URL` is set (they truncate tables — use a throwaway database). See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0-only](LICENSE). If you modify this project and offer it over a network, you must make the modified source available to its users.
