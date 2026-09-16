import "dotenv/config";
import "./types.js";
import Koa from "koa";
import Router from "@koa/router";
import { loadConfig } from "./config.js";
import { getDb, schema } from "./db/index.js";
import { getFeishuClient } from "./feishu/client.js";
import { getLinearClient } from "./linear/client.js";
import { verifyLinearSignature } from "./linear/webhook.js";
import { createFeishuEventHandler } from "./feishu/event-handler.js";
import { createCardActionHandler } from "./feishu/card-handler.js";
import { createLinkPreviewHandler } from "./feishu/link-preview-handler.js";
import { createLinearEventHandler } from "./linear/event-handler.js";
import { cleanupOldEvents } from "./utils/dedup.js";
import { logger } from "./logger.js";

const config = loadConfig();
const db = getDb(config.DATABASE_URL);
const lark = getFeishuClient(config);
const linear = getLinearClient(config);

const app = new Koa();
const router = new Router();

// ── 中间件 ──

// 先拦截原始 body 再交给 bodyParser 解析
app.use(async (ctx, next) => {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    ctx.req.on("data", (chunk: Buffer) => chunks.push(chunk));
    ctx.req.on("end", resolve);
    ctx.req.on("error", reject);
  });
  const raw = Buffer.concat(chunks);
  const req = ctx.request as unknown as Record<string, unknown>;
  req.rawBody = raw;

  // 手动解析 JSON body
  if (raw.length && ctx.is("json")) {
    try {
      req.body = JSON.parse(raw.toString());
    } catch {
      ctx.throw(422, "Invalid JSON");
    }
  }

  await next();
});

// ── 路由 ──

// 健康检查
router.get("/health", (ctx) => {
  ctx.body = {
    status: "ok",
    version: "0.1.0",
    uptime: process.uptime(),
  };
});

// 飞书事件回调
router.post("/webhook/feishu/event", createFeishuEventHandler(config, db, lark, linear));

// 飞书卡片交互回调
router.post("/webhook/feishu/card", createCardActionHandler(config, db, lark, linear));

// 飞书链接预览回调
router.post("/webhook/feishu/link-preview", createLinkPreviewHandler(config, linear));

// Linear Webhook 回调
router.post(
  "/webhook/linear",
  verifyLinearSignature(config.LINEAR_WEBHOOK_SECRET),
  createLinearEventHandler(config, db, lark, linear),
);

// ── 管理 API ──

router.post("/api/bind", async (ctx) => {
  const { feishuOpenId, linearEmail } = ctx.request.body as Record<string, string>;
  if (!feishuOpenId || !linearEmail) {
    ctx.status = 400;
    ctx.body = { error: "需要 feishuOpenId 和 linearEmail" };
    return;
  }

  try {
    const users = await linear.users();
    const user = users.nodes.find((u) => u.email === linearEmail);
    if (!user) {
      ctx.status = 404;
      ctx.body = { error: `未找到 Linear 用户: ${linearEmail}` };
      return;
    }

    db.insert(schema.userMappings)
      .values({
        feishuOpenId,
        linearUserId: user.id,
        linearEmail: user.email,
        linearName: user.name,
      })
      .onConflictDoUpdate({
        target: schema.userMappings.feishuOpenId,
        set: {
          linearUserId: user.id,
          linearEmail: user.email,
          linearName: user.name,
          updatedAt: new Date().toISOString(),
        },
      })
      .run();

    ctx.body = { success: true, linearUser: user.name };
  } catch (err) {
    logger.error({ err }, "用户绑定失败");
    ctx.status = 500;
    ctx.body = { error: "绑定失败" };
  }
});

router.post("/api/notification", async (ctx) => {
  const body = ctx.request.body as Record<string, unknown>;
  const { type, linearEntityId, linearEntityName, feishuChatId, onCreated, onUpdated, onCompleted, onComment } = body;

  if (!type || !linearEntityId) {
    ctx.status = 400;
    ctx.body = { error: "需要 type 和 linearEntityId" };
    return;
  }

  try {
    const [result] = db
      .insert(schema.notificationConfigs)
      .values({
        type: type as "team" | "project" | "initiative" | "view" | "personal",
        linearEntityId: linearEntityId as string,
        linearEntityName: linearEntityName as string | undefined,
        feishuChatId: feishuChatId as string | undefined,
        onCreated: (onCreated as boolean) ?? true,
        onUpdated: (onUpdated as boolean) ?? true,
        onCompleted: (onCompleted as boolean) ?? false,
        onComment: (onComment as boolean) ?? true,
      })
      .returning()
      .all();

    ctx.body = { success: true, config: result };
  } catch (err) {
    logger.error({ err }, "通知配置失败");
    ctx.status = 500;
    ctx.body = { error: "配置失败" };
  }
});

router.post("/api/guidance", async (ctx) => {
  const body = ctx.request.body as Record<string, unknown>;
  const { feishuChatId, guidance, defaultTeamId, defaultProjectId } = body;

  if (!feishuChatId || !guidance) {
    ctx.status = 400;
    ctx.body = { error: "需要 feishuChatId 和 guidance" };
    return;
  }

  try {
    db.insert(schema.agentGuidance)
      .values({
        feishuChatId: feishuChatId as string,
        guidance: guidance as string,
        defaultTeamId: defaultTeamId as string | undefined,
        defaultProjectId: defaultProjectId as string | undefined,
      })
      .onConflictDoUpdate({
        target: schema.agentGuidance.feishuChatId,
        set: {
          guidance: guidance as string,
          defaultTeamId: defaultTeamId as string | undefined,
          defaultProjectId: defaultProjectId as string | undefined,
          updatedAt: new Date().toISOString(),
        },
      })
      .run();

    ctx.body = { success: true };
  } catch (err) {
    logger.error({ err }, "Guidance 配置失败");
    ctx.status = 500;
    ctx.body = { error: "配置失败" };
  }
});

// ── 挂载路由 ──
app.use(router.routes());
app.use(router.allowedMethods());

// ── 定时清理 ──
setInterval(() => {
  try {
    cleanupOldEvents(db);
    logger.info("已清理过期事件记录");
  } catch (err) {
    logger.error({ err }, "清理过期事件失败");
  }
}, 6 * 60 * 60 * 1000);

// ── 启动 ──
app.listen(config.PORT, config.HOST, () => {
  logger.info(
    { host: config.HOST, port: config.PORT },
    `🚀 Feishu-Linear 连接器已启动 (Koa)`,
  );
  logger.info(`  飞书事件回调: ${config.PUBLIC_URL}/webhook/feishu/event`);
  logger.info(`  飞书卡片回调: ${config.PUBLIC_URL}/webhook/feishu/card`);
  logger.info(`  飞书链接预览: ${config.PUBLIC_URL}/webhook/feishu/link-preview`);
  logger.info(`  Linear Webhook: ${config.PUBLIC_URL}/webhook/linear`);
  logger.info(`  健康检查: ${config.PUBLIC_URL}/health`);
});
