import "dotenv/config";
import "./types.js";
import Koa from "koa";
import { loadConfig } from "./config.js";
import { getDb } from "./db/index.js";
import { createFeishuClient } from "./adapters/feishu/client.js";
import { createFeishuEventDispatcher } from "./adapters/feishu/dispatcher.js";
import { createLinearClientFactory } from "./adapters/linear/client.js";
import { createRouter } from "./transport/http/routes.js";
import {
  bodyMiddleware,
  errorMiddleware,
} from "./transport/http/middleware.js";
import { cleanupOldEvents } from "./utils/dedup.js";
import type { AppContext } from "./app/context.js";
import { logger } from "./logger.js";

// 组装根：同一份代码既可在 VPS/Docker 长驻运行，也可作为 Vercel Function 部署
const config = loadConfig();
const db = getDb(config.DATABASE_URL);
const linearFactory = createLinearClientFactory(config, db);

const ctx: AppContext = {
  config,
  db,
  lark: createFeishuClient(config),
  getLinear: () => linearFactory.getClient(),
  getLinearAppUserId: () => linearFactory.getAppUserId(),
};

const app = new Koa();
app.use(errorMiddleware);
app.use(bodyMiddleware);

const router = createRouter(ctx, createFeishuEventDispatcher(ctx));
app.use(router.routes());
app.use(router.allowedMethods());

app.listen(config.PORT, config.HOST, () => {
  logger.info(
    { host: config.HOST, port: config.PORT, vercel: Boolean(process.env.VERCEL) },
    "🚀 Feishu-Linear (Koa, webhook-only) 已启动",
  );
  logger.info(`  GET  ${config.PUBLIC_URL}/health`);
  logger.info(`  POST ${config.PUBLIC_URL}/webhook/feishu   ← 飞书事件/回调统一入口`);
  logger.info(`  POST ${config.PUBLIC_URL}/webhook/linear   ← Linear Webhook`);
  if (config.LINEAR_AUTH_MODE === "oauth") {
    logger.info(`  GET  ${config.PUBLIC_URL}/oauth/linear/install`);
  }
  logger.info(`  Linear 鉴权: ${config.LINEAR_AUTH_MODE}；管理 API: ${config.ADMIN_TOKEN ? "已启用" : "未启用"}`);
});

// 长驻进程用内置定时器清理；Vercel 上由 vercel.json 的 Cron 调用 /cron/cleanup
if (!process.env.VERCEL) {
  setInterval(
    () =>
      cleanupOldEvents(db).catch((err) =>
        logger.error({ err }, "清理过期事件失败"),
      ),
    6 * 60 * 60 * 1000,
  ).unref();
}

export default app;
