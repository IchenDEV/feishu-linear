import "dotenv/config";
import { LinearClient } from "@linear/sdk";
import pg from "pg";
import { loadConfigResult } from "../config.js";
import {
  FEISHU_CALLBACKS,
  FEISHU_EVENTS,
  FEISHU_MENU_KEYS,
  FEISHU_SCOPES,
  LINEAR_WEBHOOK_RESOURCES,
  SLASH_COMMANDS,
  scopeApplyUrl,
} from "../setup/requirements.js";

/**
 * 部署自检：pnpm setup:check
 *   --register-commands       注册 /linear 与 /ask 斜杠命令
 *   --create-linear-webhook   在 Linear 创建 webhook（会打印 Signing Secret，请设置为 LINEAR_WEBHOOK_SECRET）
 */

type Level = "ok" | "warn" | "fail" | "info";
const ICON: Record<Level, string> = { ok: "✅", warn: "⚠️ ", fail: "❌", info: "ℹ️ " };
let failures = 0;
let warnings = 0;
const out = (level: Level, msg: string) => {
  if (level === "fail") failures++;
  if (level === "warn") warnings++;
  console.log(`${ICON[level]} ${msg}`);
};
const section = (title: string) => console.log(`\n── ${title} ──`);

const args = new Set(process.argv.slice(2));
const FEISHU = "https://open.feishu.cn";

async function feishuToken(appId: string, appSecret: string): Promise<string> {
  const res = await fetch(`${FEISHU}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const j = (await res.json()) as { code: number; msg: string; tenant_access_token?: string };
  if (j.code !== 0 || !j.tenant_access_token) throw new Error(`${j.msg} (code ${j.code})`);
  return j.tenant_access_token;
}

async function feishuApi<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${FEISHU}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return (await res.json()) as T;
}

async function main() {
  console.log("Feishu × Linear — setup check\n");

  // ── 1. 配置 ──
  section("Configuration");
  const loaded = loadConfigResult(process.env);
  if (!loaded.ok) {
    for (const issue of loaded.issues) out("fail", `${issue.path}: ${issue.message}`);
    console.log("\nFix the configuration above first (see .env.example).");
    process.exit(1);
  }
  const config = loaded.config;
  out("ok", "Environment variables are valid");
  out("info", `PUBLIC_URL=${config.PUBLIC_URL}  DEFAULT_LOCALE=${config.DEFAULT_LOCALE}  LINEAR_AUTH_MODE=${config.LINEAR_AUTH_MODE}`);
  if (/localhost|127\.0\.0\.1/.test(config.PUBLIC_URL)) {
    out("warn", "PUBLIC_URL points to localhost — Feishu and Linear cannot reach it. Use your public HTTPS URL.");
  }
  out(config.OPENAI_API_KEY ? "ok" : "warn", config.OPENAI_API_KEY ? "OPENAI_API_KEY is set (agent enabled)" : "OPENAI_API_KEY is not set — the @bot agent is disabled");
  out(config.MCP_TOKEN ? "ok" : "info", config.MCP_TOKEN ? "MCP_TOKEN is set (/mcp enabled)" : "MCP_TOKEN is not set — the /mcp endpoint is disabled");
  out(config.ADMIN_TOKEN ? "ok" : "info", config.ADMIN_TOKEN ? "ADMIN_TOKEN is set (/api/* enabled)" : "ADMIN_TOKEN is not set — the admin API is disabled");

  // ── 2. 数据库 ──
  section("Database");
  try {
    const pool = new pg.Pool({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 8000 });
    const tables = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const have = new Set(tables.rows.map((r) => r.table_name));
    const need = ["user_mappings", "sync_threads", "notification_configs", "chat_settings", "view_subscriptions"];
    const missing = need.filter((t) => !have.has(t));
    if (missing.length) out("fail", `Missing tables: ${missing.join(", ")} — run \`pnpm db:migrate\``);
    else {
      const col = await pool.query(
        "select 1 from information_schema.columns where table_name = 'chat_settings' and column_name = 'locale'",
      );
      if (!col.rowCount) out("fail", "Database schema is outdated (chat_settings.locale missing) — run `pnpm db:migrate`");
      else out("ok", "Connected; schema is up to date");
    }
    await pool.end();
  } catch (err) {
    out("fail", `Cannot connect to Postgres: ${(err as Error).message}`);
  }

  // ── 3. 飞书 ──
  section("Feishu");
  let token = "";
  try {
    token = await feishuToken(config.FEISHU_APP_ID, config.FEISHU_APP_SECRET);
    out("ok", `Authenticated as app ${config.FEISHU_APP_ID}`);
  } catch (err) {
    out("fail", `Cannot get a tenant access token: ${(err as Error).message} (check FEISHU_APP_ID / FEISHU_APP_SECRET)`);
  }

  if (token) {
    try {
      const scopesRes = await feishuApi<{ code: number; data?: { scopes?: Array<{ scope_name: string; grant_status: number }> } }>(
        token,
        "/open-apis/application/v6/scopes",
      );
      const granted = new Set(
        (scopesRes.data?.scopes ?? []).filter((s) => s.grant_status === 1).map((s) => s.scope_name),
      );
      const missingCore = FEISHU_SCOPES.core.filter((s) => !granted.has(s));
      const missingFeat = Object.keys(FEISHU_SCOPES.feature).filter((s) => !granted.has(s));
      if (missingCore.length) out("fail", `Missing required scopes: ${missingCore.join(", ")}`);
      else out("ok", "All required scopes are granted");
      for (const s of missingFeat) out("warn", `Optional scope not granted: ${s} — ${FEISHU_SCOPES.feature[s]}`);
      const toAdd = [...missingCore, ...missingFeat];
      if (toAdd.length) {
        out("info", `Add them in one click: ${scopeApplyUrl(config.FEISHU_APP_ID, toAdd)}`);
        out("info", "After adding scopes, create a new app version and publish it.");
      }
    } catch (err) {
      out("warn", `Could not read scopes: ${(err as Error).message}`);
    }

    try {
      const appRes = await feishuApi<{
        data?: { app?: { callback_info?: { callback_type?: string; request_url?: string; subscribed_callbacks?: string[] } } };
      }>(token, `/open-apis/application/v6/applications/${config.FEISHU_APP_ID}?lang=en_us`);
      const cb = appRes.data?.app?.callback_info;
      const expected = `${config.PUBLIC_URL.replace(/\/$/, "")}/webhook/feishu`;
      if (cb?.callback_type !== "webhook") {
        out("fail", `Callback delivery is "${cb?.callback_type ?? "unset"}" — set it to “Send to developer server” with URL ${expected}`);
      } else if (cb.request_url !== expected) {
        out("fail", `Callback URL is ${cb.request_url}, expected ${expected}`);
      } else {
        out("ok", `Callback URL: ${expected}`);
      }
      const subs = new Set(cb?.subscribed_callbacks ?? []);
      for (const c of FEISHU_CALLBACKS.required) out(subs.has(c) ? "ok" : "fail", `Callback ${c} ${subs.has(c) ? "subscribed" : "is NOT subscribed"}`);
      for (const [c, why] of Object.entries(FEISHU_CALLBACKS.optional)) {
        if (!subs.has(c)) out(config.FEISHU_LINK_PREVIEW ? "warn" : "info", `Callback ${c} not subscribed — ${why}`);
        else out("ok", `Callback ${c} subscribed`);
      }
    } catch (err) {
      out("warn", `Could not read app callback settings: ${(err as Error).message}`);
    }

    out("info", `Verify manually in the console: events ${FEISHU_EVENTS.join(", ")}; bot menu keys ${FEISHU_MENU_KEYS.join(", ")} (the API cannot read these)`);

    try {
      const list = await feishuApi<{ code: number; data?: { items?: Array<{ command: string }> } }>(
        token,
        "/open-apis/application/v7/app_slash_commands",
      );
      const have = new Set((list.data?.items ?? []).map((i) => i.command));
      for (const c of SLASH_COMMANDS) {
        if (have.has(c.command)) {
          out("ok", `Slash command /${c.command} registered`);
        } else if (args.has("--register-commands")) {
          const r = await feishuApi<{ code: number; msg: string }>(token, "/open-apis/application/v7/app_slash_commands", {
            method: "POST",
            body: JSON.stringify(c),
          });
          out(r.code === 0 ? "ok" : "fail", r.code === 0 ? `Registered /${c.command}` : `Failed to register /${c.command}: ${r.msg}`);
        } else {
          out("warn", `Slash command /${c.command} is not registered — rerun with --register-commands`);
        }
      }
    } catch (err) {
      out("warn", `Could not check slash commands: ${(err as Error).message}`);
    }
  }

  // ── 4. Linear ──
  section("Linear");
  if (config.LINEAR_AUTH_MODE === "api_key") {
    try {
      const linear = new LinearClient({ apiKey: config.LINEAR_API_KEY });
      const viewer = await linear.viewer;
      const org = await linear.organization;
      out("ok", `Authenticated as ${viewer.name} (${viewer.email}) in workspace “${org.name}”`);
      if (!viewer.admin) out("warn", "The API key owner is not a workspace admin — webhook inspection/creation needs admin rights");

      const expected = `${config.PUBLIC_URL.replace(/\/$/, "")}/webhook/linear`;
      let hooks: Array<{ url?: string | null; enabled: boolean; resourceTypes: string[] }> = [];
      try {
        hooks = (await linear.webhooks()).nodes;
      } catch {
        out("warn", "Cannot list webhooks (admin API scope required)");
      }
      const mine = hooks.find((h) => h.url === expected);
      if (mine) {
        const missing = LINEAR_WEBHOOK_RESOURCES.filter((r) => !mine.resourceTypes.includes(r));
        out(mine.enabled ? "ok" : "fail", `Webhook ${expected} ${mine.enabled ? "is enabled" : "is DISABLED"}`);
        out(missing.length ? "warn" : "ok", missing.length ? `Webhook is missing resource types: ${missing.join(", ")}` : "Webhook covers all required resource types");
      } else if (args.has("--create-linear-webhook")) {
        const payload = await linear.createWebhook({
          url: expected,
          resourceTypes: [...LINEAR_WEBHOOK_RESOURCES],
          allPublicTeams: true,
          label: "Feishu × Linear",
        });
        const wh = await payload.webhook;
        out("ok", `Created webhook ${expected}`);
        out("info", `Signing secret (set it as LINEAR_WEBHOOK_SECRET): ${wh?.secret ?? "(see Linear → Settings → API → Webhooks)"}`);
      } else {
        out("warn", `No Linear webhook points to ${expected} — create one (or rerun with --create-linear-webhook)`);
      }
    } catch (err) {
      out("fail", `Linear API error: ${(err as Error).message}`);
    }
  } else {
    out("info", "OAuth mode: open /oauth/linear/install in a browser as a workspace admin to authorize the app.");
  }

  // ── 5. 公网可达 ──
  section("Reachability");
  try {
    const res = await fetch(`${config.PUBLIC_URL.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(8000) });
    const j = (await res.json()) as { status?: string; version?: string };
    out(res.ok && j.status === "ok" ? "ok" : "fail", `GET ${config.PUBLIC_URL}/health → ${res.status} ${JSON.stringify(j)}`);
  } catch (err) {
    out("fail", `Cannot reach ${config.PUBLIC_URL}/health: ${(err as Error).message}`);
  }

  console.log(`\nDone: ${failures} failure(s), ${warnings} warning(s).`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
