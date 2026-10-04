# Installation guide

**English** · [简体中文](installation.zh-CN.md)

This guide takes you from nothing to a working Feishu × Linear connector. Budget about 30 minutes. At every stage you can run `pnpm setup:check` to see what is still missing.

- [0. Prerequisites](#0-prerequisites)
- [1. Create the Feishu app](#1-create-the-feishu-app)
- [2. Configure Linear](#2-configure-linear)
- [3. Configure the connector](#3-configure-the-connector)
- [4. Deploy](#4-deploy)
- [5. Wire Feishu to your deployment](#5-wire-feishu-to-your-deployment)
- [6. Verify](#6-verify)
- [7. Optional features](#7-optional-features)
- [Troubleshooting](#troubleshooting)

## 0. Prerequisites

| You need | Notes |
|---|---|
| A Feishu (or Lark) tenant where you can create self-built apps | Admin approval is needed to publish app versions |
| A Linear workspace and permission to create API keys / webhooks | Workspace admin recommended |
| A Postgres database | Any host; [Neon](https://neon.tech) works well |
| A public HTTPS URL for the connector | A custom domain is strongly recommended for Feishu (`*.workers.dev` is often unreachable in mainland China) |
| Node ≥ 22 and pnpm | Only for migrations and deploying; Docker needs only Docker |

## 1. Create the Feishu app

1. Open the [Feishu Open Platform](https://open.feishu.cn/app) (Lark: [open.larksuite.com](https://open.larksuite.com/app)) → **Create custom app**.
2. **Add features → Bot**. Enable it.
3. **Credentials & basic info**: copy **App ID** and **App Secret** → `FEISHU_APP_ID`, `FEISHU_APP_SECRET`.
4. **Events & callbacks → Encryption strategy**: copy the **Verification Token** → `FEISHU_VERIFICATION_TOKEN`. Optionally set an **Encrypt Key** → `FEISHU_ENCRYPT_KEY`.
5. **Permissions & scopes**: grant the scopes below (tenant token). The fastest way is to run `pnpm setup:check` after step 3 — it lists missing scopes and prints a console deep link that pre-selects them.

| Scope | Purpose |
|---|---|
| `im:message:send_as_bot`, `im:message:readonly`, `im:message:update` | Send, read and update bot messages and cards |
| `im:message.p2p_msg:readonly`, `im:message.group_at_msg:readonly` | Receive DMs and @-mentions |
| `im:chat:read`, `im:resource` | Chat metadata, image / file upload and download |
| `contact:user.base:readonly`, `contact:user.id:readonly`, `contact:user.email:readonly` | Identify users and link them to Linear by email |
| `im:message.group_msg` | *Agent:* read recent channel messages as context |
| `im:message.reactions:write_only` | *Agent:* "working" reaction |
| `im:chat:create`, `im:chat:update`, `im:chat.members:write_only`, `im:chat.managers:write_only`, `im:chat.tabs:write_only`, `im:chat.top_notice:write_only`, `im:message.pins:write_only` | *Project channels* |

The authoritative list lives in [`src/setup/requirements.ts`](../src/setup/requirements.ts); `pnpm setup:check` and this guide share it.

The event/callback subscription, bot menu and message shortcut are configured **after** you have a public URL (step 5). Do not publish the app version yet.

## 2. Configure Linear

You can use either mode. Start with `api_key`; switch to `oauth` later if you want comments to appear as the real user.

### Option A — API key (quickest)

1. Linear → **Settings → Account → Security & access → Personal API keys** → create a key → `LINEAR_API_KEY`.
   Prefer a dedicated bot/service user so actions are not attributed to a person.
2. Set `LINEAR_AUTH_MODE=api_key`.

### Option B — OAuth (actor=app)

1. Linear → **Settings → API → OAuth applications → New**. Callback URL: `https://<your-domain>/oauth/linear/callback`.
2. Set `LINEAR_AUTH_MODE=oauth`, `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_REDIRECT_URI`.
3. After deploying, a workspace admin opens `https://<your-domain>/oauth/linear/install` once to authorize.

### Webhook

The connector needs a webhook to receive Linear changes.

- **Automatic:** after deploying, run `pnpm setup:check --create-linear-webhook`. It creates the webhook and prints the signing secret **once** — store it as `LINEAR_WEBHOOK_SECRET`.
- **Manual:** Linear → **Settings → API → Webhooks → New webhook**. URL `https://<your-domain>/webhook/linear`; resources: **Issues, Comments, Projects, Project updates, Initiatives, Initiative updates**; copy the signing secret to `LINEAR_WEBHOOK_SECRET`.

## 3. Configure the connector

Copy the template that matches how you will deploy and fill it in:

| Deployment | Template | Where secrets live |
|---|---|---|
| Node / Docker / Vercel | `.env.example` → `.env` | `.env` / platform env vars |
| Cloudflare Workers | `wrangler.example.jsonc` → `wrangler.jsonc`, `.dev.vars.example` → `.dev.vars` | `wrangler secret put` |

Minimum required: `DATABASE_URL`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_VERIFICATION_TOKEN`, `LINEAR_API_KEY` (or OAuth credentials), `LINEAR_WEBHOOK_SECRET`, `PUBLIC_URL`.

Strongly recommended: `ADMIN_TOKEN` (enables `/api/*`), `CRON_SECRET`.

Optional:

| Variable | Enables |
|---|---|
| `DEFAULT_LOCALE` (`zh-CN` / `en`) | Workspace default language |
| `OPENAI_API_KEY` (+ `OPENAI_BASE_URL`, `OPENAI_MODEL`) | The @bot agent |
| `MCP_TOKEN` | The `/mcp` endpoint |
| `FEISHU_LINK_PREVIEW=true` | Native Link Preview (set only after configuring it in step 5) |

Then apply the database schema (idempotent, safe to re-run after upgrades):

```bash
pnpm install
pnpm db:migrate
```

> **Neon tip:** run migrations with the *direct* connection string (without `-pooler`); use the pooled one at runtime.

## 4. Deploy

All three targets run the same code. Pick one.

### Cloudflare Workers

```bash
cp wrangler.example.jsonc wrangler.jsonc       # set routes (custom domain), PUBLIC_URL, DEFAULT_LOCALE…
pnpm exec wrangler secret put DATABASE_URL
pnpm exec wrangler secret put FEISHU_APP_ID
pnpm exec wrangler secret put FEISHU_APP_SECRET
pnpm exec wrangler secret put FEISHU_VERIFICATION_TOKEN
pnpm exec wrangler secret put LINEAR_API_KEY
pnpm exec wrangler secret put LINEAR_WEBHOOK_SECRET
pnpm exec wrangler secret put ADMIN_TOKEN       # recommended
pnpm exec wrangler secret put CRON_SECRET        # recommended
pnpm deploy:worker
```

- Secrets can also be uploaded in bulk: `wrangler deploy --secrets-file <file>`.
- Bind your own domain (`routes` + `custom_domain`) and set `placement.region` next to your database.
- Cron triggers (daily cleanup and 10-minute view polling) are defined in the config.
- Local dev: `cp .dev.vars.example .dev.vars && pnpm dev:worker`.

### Vercel + Neon

1. Create a Neon project and use the **pooled** connection string as `DATABASE_URL`; run `pnpm db:migrate` once against the **direct** string.
2. `vercel link && vercel deploy --prod`; add the environment variables in the project settings plus `CRON_SECRET` (Vercel sends it to cron routes).
3. `vercel.json` schedules `/cron/cleanup` and `/cron/views`. Hobby plans allow only daily crons, so view subscriptions need Pro or an external scheduler hitting `/cron/views`.

### Docker + Caddy (VPS, automatic HTTPS)

```bash
cp .env.example .env     # fill in credentials; set DOMAIN, PUBLIC_URL, POSTGRES_PASSWORD, ADMIN_TOKEN
docker compose up -d --build
curl https://$DOMAIN/health
```

Migrations run automatically on start. For an external Postgres, remove the `postgres` service and edit `app.environment.DATABASE_URL`. Caddy only exposes `/health`, `/webhook/*`, `/oauth/linear/*`, `/api/*`, `/mcp`, `/h5/*`.

Verify the deployment is up: `curl https://<your-domain>/health` → `{"status":"ok",…}`.

## 5. Wire Feishu to your deployment

In the developer console for your app:

1. **Events & callbacks → Subscription mode** → *Send events to developer server*. Request URL: `https://<your-domain>/webhook/feishu`. The console verifies the URL immediately, so the deployment must already be live.
2. **Add events:** `im.message.receive_v1` (Receive messages) and `application.bot.menu_v6` (Bot menu).
3. **Callback config → add callbacks:** `card.action.trigger` (Card interaction) and, if you want native link previews, `url.preview.get`.
4. **Bot menu** (optional): add three items with event keys `create_issue`, `my_notifications`, `help`.
5. **Slash commands:** run `pnpm setup:check --register-commands` to register `/linear` and `/ask` (works without them too — plain text starting with `/` is handled).
6. **Link Preview** (optional): *Features → Link preview*; URL rule `linear.app/*`, callback as above. Then set `FEISHU_LINK_PREVIEW=true` and redeploy. Without it the bot unfurls links with a reply card.
7. **Message shortcut / H5** (optional):
   1. *Features → Web app*: homepage `https://<your-domain>/h5/message-action`; add your domain to the trusted/redirect domains in *Security settings*.
   2. *Features → Message shortcut*: link `https://<your-domain>/h5/message-action`.
   3. The shortcut now appears under **More** on any message ("convert to Linear issue").
8. **Create a version and publish.** Tenant admin approval is required for scope changes.

> The console cannot be read via API for events, bot menu and H5 settings, so `pnpm setup:check` reminds you to double-check those manually.

## 6. Verify

```bash
pnpm setup:check     # reads your .env; export PUBLIC_URL=… to check a remote deployment
```

Every line should be ✅ (⚠️ items are optional features). Then in Feishu:

1. Add the bot to a group or DM it, and send `/linear help`.
2. Send `/linear` → fill the form → an issue is created in Linear.
3. Create or comment on an issue in Linear → the subscribed chat is notified.
4. `@bot what's assigned to me?` (requires `OPENAI_API_KEY`).

## 7. Optional features

| Feature | How to enable |
|---|---|
| **Language** | `DEFAULT_LOCALE` for the workspace; `/linear lang zh\|en\|auto` per chat (admins) or per user (`/linear me`). Notifications render in each recipient's language. |
| **Agent** | Set `OPENAI_API_KEY` (any OpenAI-compatible endpoint via `OPENAI_BASE_URL`). Per-chat defaults and guidance live in `/linear settings`. |
| **Asks** | An admin enables Asks in `/linear settings`; anyone can then `/ask …` without a Linear account. |
| **Project channels** | Enable in `/linear settings`; requires the `im:chat*` scopes. |
| **MCP** | Set `MCP_TOKEN`; point an MCP client at `https://<your-domain>/mcp` with `Authorization: Bearer <MCP_TOKEN>`. |
| **Admin API** | Set `ADMIN_TOKEN` to use `/api/*`. |

### How accounts are linked

Feishu and Linear identities are matched by **email**: on first use the connector reads the user's Feishu email and finds the Linear user with the same address (`/linear me` shows the state). If the Feishu account has no readable email, `/linear bind <email>` binds an address that must equal the user's own Feishu email. Admins can bind any pair with `POST /api/bind`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Console says "request URL verification failed" | The deployment must be reachable over HTTPS and `FEISHU_VERIFICATION_TOKEN` must match. Check `/health`. |
| Bot ignores messages | Confirm `im.message.receive_v1` is subscribed, the app version is published, and the bot is in the chat (groups: @-mention it). |
| Buttons show an error / "timed out" | Card callbacks must answer within 3 s. Check Worker/server logs; put the Worker near the database (`placement.region`). |
| "Unable to verify your identity: no email is available on your Feishu account" | Grant `contact:user.email:readonly`, or have an admin bind you with `POST /api/bind`. |
| Linear changes never arrive | Check the webhook URL, that it is enabled, and that `LINEAR_WEBHOOK_SECRET` matches; `pnpm setup:check` verifies this. |
| Links aren't unfurled | Either configure Link Preview and set `FEISHU_LINK_PREVIEW=true`, or leave it `false` for reply-card unfurling. Private teams are never unfurled. |
| Comments appear under the API key owner | Expected in `api_key` mode; use OAuth for real-user attribution. |
| `column "locale" does not exist` after upgrading | Run `pnpm db:migrate` (schema changed). |
| Postgres SSL warning on `pg-connection-string` | Harmless; append `sslmode=verify-full` to silence it. |
