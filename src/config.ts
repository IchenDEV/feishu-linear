import { z } from "zod";

const envSchema = z.object({
  // ── 飞书 ──
  FEISHU_APP_ID: z.string().min(1),
  FEISHU_APP_SECRET: z.string().min(1),
  /** webhook-only：必须配置，用于校验飞书推送来源 */
  FEISHU_VERIFICATION_TOKEN: z.string().min(1),
  /** 开发者后台开启「加密」时填写，否则留空 */
  FEISHU_ENCRYPT_KEY: z.string().default(""),

  // ── Linear ──
  /** api_key 适合自用；oauth(actor=app) 才支持 createAsUser / Agent 身份 */
  LINEAR_AUTH_MODE: z.enum(["api_key", "oauth"]).default("api_key"),
  LINEAR_API_KEY: z.string().default(""),
  LINEAR_CLIENT_ID: z.string().default(""),
  LINEAR_CLIENT_SECRET: z.string().default(""),
  LINEAR_REDIRECT_URI: z.string().default(""),
  LINEAR_WEBHOOK_SECRET: z.string().default(""),
  /** Linear App User ID，用于过滤自身 webhook（防回声） */
  LINEAR_APP_USER_ID: z.string().default(""),
  LINEAR_ORG_ID: z.string().default(""),
  /** OAuth scopes，逗号分隔 */
  LINEAR_SCOPES: z
    .string()
    .default("read,write,issues:create,comments:create,app:assignable,app:mentionable"),

  // ── 界面语言 ──
  /** 默认界面语言：zh-CN | en。可被工作区、群、个人设置覆盖（/linear lang） */
  DEFAULT_LOCALE: z.enum(["zh-CN", "en"]).default("zh-CN"),

  // ── 链接展开 ──
  /** 飞书后台已配置「链接预览」时保持 true（链接由飞书原生展开）；否则设为 false，由机器人回复卡片展开 */
  FEISHU_LINK_PREVIEW: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() !== "false"),

  // ── MCP ──
  /** 对外 MCP 端点（/mcp）的 Bearer Token；留空则 MCP 端点禁用 */
  MCP_TOKEN: z.string().default(""),

  // ── AI（@机器人自然语言）──
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-4o"),

  // ── 服务 ──
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  /** Postgres 连接串（Vercel 上请用 Neon 的 pooled 连接串） */
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a postgres:// or postgresql:// connection string"),
  /** Admin API（/api/*）的 Bearer Token；留空则Admin API 整体禁用 */
  ADMIN_TOKEN: z.string().default(""),
  /** Vercel Cron 调用 /cron/* 时携带的 Bearer Token（Vercel 自动注入 CRON_SECRET） */
  CRON_SECRET: z.string().default(""),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  PUBLIC_URL: z.string().default("http://localhost:3000"),
}).superRefine((val, ctx) => {
  if (process.env.NODE_ENV === "production" && !val.LINEAR_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LINEAR_WEBHOOK_SECRET"],
      message: "LINEAR_WEBHOOK_SECRET is required in production; otherwise Linear webhooks cannot be verified",
    });
  }
  if (val.LINEAR_AUTH_MODE === "api_key" && !val.LINEAR_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LINEAR_API_KEY"],
      message: "LINEAR_API_KEY is required when LINEAR_AUTH_MODE=api_key",
    });
  }
  if (val.LINEAR_AUTH_MODE === "oauth") {
    if (!val.LINEAR_CLIENT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["LINEAR_CLIENT_ID"],
        message: "LINEAR_CLIENT_ID is required when LINEAR_AUTH_MODE=oauth",
      });
    }
    if (!val.LINEAR_CLIENT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["LINEAR_CLIENT_SECRET"],
        message: "LINEAR_CLIENT_SECRET is required when LINEAR_AUTH_MODE=oauth",
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export type ConfigResult =
  | { ok: true; config: Env }
  | { ok: false; issues: Array<{ path: string; message: string }> };

/** 校验环境变量但不退出进程（供 doctor 等工具使用） */
export function loadConfigResult(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const result = envSchema.safeParse(env);
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Env {
  const result = loadConfigResult(env);
  if (!result.ok) {
    console.error("❌ Invalid environment configuration:");
    for (const issue of result.issues) {
      console.error(`  ${issue.path}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.config;
}
