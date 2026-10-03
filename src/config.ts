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

  // ── AI（@机器人自然语言）──
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-4o"),

  // ── 服务 ──
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().default("./data/feishu-linear.db"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  PUBLIC_URL: z.string().default("http://localhost:3000"),
}).superRefine((val, ctx) => {
  if (val.LINEAR_AUTH_MODE === "api_key" && !val.LINEAR_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LINEAR_API_KEY"],
      message: "LINEAR_AUTH_MODE=api_key 时必须提供 LINEAR_API_KEY",
    });
  }
  if (val.LINEAR_AUTH_MODE === "oauth") {
    if (!val.LINEAR_CLIENT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["LINEAR_CLIENT_ID"],
        message: "LINEAR_AUTH_MODE=oauth 时必须提供 LINEAR_CLIENT_ID",
      });
    }
    if (!val.LINEAR_CLIENT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["LINEAR_CLIENT_SECRET"],
        message: "LINEAR_AUTH_MODE=oauth 时必须提供 LINEAR_CLIENT_SECRET",
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    console.error("❌ 环境变量校验失败:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}
