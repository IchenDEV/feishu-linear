import "dotenv/config";
import express from "express";
import { loadConfig } from "./config.js";
import { getDb } from "./db/index.js";
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

const app = express();

// ── 中间件 ──

// 保留原始 body 用于签名验证
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

// ── 健康检查 ──
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "0.1.0",
    uptime: process.uptime(),
  });
});

// ── 飞书事件回调 ──
app.post(
  "/webhook/feishu/event",
  createFeishuEventHandler(config, db, lark, linear),
);

// ── 飞书卡片交互回调 ──
app.post(
  "/webhook/feishu/card",
  createCardActionHandler(config, db, lark, linear),
);

// ── 飞书链接预览回调 ──
app.post(
  "/webhook/feishu/link-preview",
  createLinkPreviewHandler(config, linear),
);

// ── Linear Webhook 回调 ──
app.post(
  "/webhook/linear",
  verifyLinearSignature(config.LINEAR_WEBHOOK_SECRET),
  createLinearEventHandler(config, db, lark, linear),
);

// ── 管理 API（配置通知、用户绑定等）──
app.post("/api/bind", async (req, res) => {
  const { feishuOpenId, linearEmail } = req.body;
  if (!feishuOpenId || !linearEmail) {
    res.status(400).json({ error: "需要 feishuOpenId 和 linearEmail" });
    return;
  }

  try {
    const users = await linear.users();
    const user = users.nodes.find((u) => u.email === linearEmail);
    if (!user) {
      res.status(404).json({ error: `未找到 Linear 用户: ${linearEmail}` });
      return;
    }

    const { schema } = await import("./db/index.js");
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

    res.json({ success: true, linearUser: user.name });
  } catch (err) {
    logger.error({ err }, "用户绑定失败");
    res.status(500).json({ error: "绑定失败" });
  }
});

app.post("/api/notification", async (req, res) => {
  const { type, linearEntityId, linearEntityName, feishuChatId, onCreated, onUpdated, onCompleted, onComment } =
    req.body;

  if (!type || !linearEntityId) {
    res.status(400).json({ error: "需要 type 和 linearEntityId" });
    return;
  }

  try {
    const { schema } = await import("./db/index.js");
    const [result] = db
      .insert(schema.notificationConfigs)
      .values({
        type,
        linearEntityId,
        linearEntityName,
        feishuChatId,
        onCreated: onCreated ?? true,
        onUpdated: onUpdated ?? true,
        onCompleted: onCompleted ?? false,
        onComment: onComment ?? true,
      })
      .returning()
      .all();

    res.json({ success: true, config: result });
  } catch (err) {
    logger.error({ err }, "通知配置失败");
    res.status(500).json({ error: "配置失败" });
  }
});

app.post("/api/guidance", async (req, res) => {
  const { feishuChatId, guidance, defaultTeamId, defaultProjectId } = req.body;

  if (!feishuChatId || !guidance) {
    res.status(400).json({ error: "需要 feishuChatId 和 guidance" });
    return;
  }

  try {
    const { schema } = await import("./db/index.js");
    db.insert(schema.agentGuidance)
      .values({ feishuChatId, guidance, defaultTeamId, defaultProjectId })
      .onConflictDoUpdate({
        target: schema.agentGuidance.feishuChatId,
        set: {
          guidance,
          defaultTeamId,
          defaultProjectId,
          updatedAt: new Date().toISOString(),
        },
      })
      .run();

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Guidance 配置失败");
    res.status(500).json({ error: "配置失败" });
  }
});

// ── 定时清理 ──
setInterval(() => {
  try {
    cleanupOldEvents(db);
    logger.info("已清理过期事件记录");
  } catch (err) {
    logger.error({ err }, "清理过期事件失败");
  }
}, 6 * 60 * 60 * 1000); // 每 6 小时

// ── 启动 ──
app.listen(config.PORT, config.HOST, () => {
  logger.info(
    { host: config.HOST, port: config.PORT },
    `🚀 Feishu-Linear 连接器已启动`,
  );
  logger.info(`  飞书事件回调: ${config.PUBLIC_URL}/webhook/feishu/event`);
  logger.info(`  飞书卡片回调: ${config.PUBLIC_URL}/webhook/feishu/card`);
  logger.info(`  飞书链接预览: ${config.PUBLIC_URL}/webhook/feishu/link-preview`);
  logger.info(`  Linear Webhook: ${config.PUBLIC_URL}/webhook/linear`);
  logger.info(`  健康检查: ${config.PUBLIC_URL}/health`);
});
