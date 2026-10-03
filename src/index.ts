import "dotenv/config";
import "./types.js";
import Koa from "koa";
import { loadConfig } from "./config.js";
import { getDb } from "./db/index.js";
import { createFeishuClient } from "./adapters/feishu/client.js";
import {
  createFeishuEventDispatcher,
  startFeishuWS,
} from "./adapters/feishu/dispatcher.js";
import { createLinearClientFactory } from "./adapters/linear/client.js";
import { createRouter } from "./transport/http/routes.js";
import { cleanupOldEvents } from "./utils/dedup.js";
import type { AppContext } from "./app/context.js";
import { logger } from "./logger.js";

async function main() {
  const config = loadConfig();
  const db = getDb(config.DATABASE_URL);
  const lark = createFeishuClient(config);
  const linearFactory = createLinearClientFactory(config, db);

  const ctx: AppContext = {
    config,
    db,
    lark,
    getLinear: () => linearFactory.getClient(),
    getLinearAppUserId: () => linearFactory.getAppUserId(),
  };

  const feishuDispatcher = createFeishuEventDispatcher(ctx);

  const app = new Koa();

  // 统一解析 rawBody + JSON body（Linear 验签依赖 rawBody）
  app.use(async (koaCtx, next) => {
    if (koaCtx.method === "POST" || koaCtx.method === "PUT" || koaCtx.method === "PATCH") {
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        koaCtx.req.on("data", (c: Buffer) => chunks.push(c));
        koaCtx.req.on("end", () => resolve());
        koaCtx.req.on("error", reject);
      });
      const raw = Buffer.concat(chunks);
      koaCtx.request.rawBody = raw;
      if (raw.length) {
        const ctype = koaCtx.get("content-type") || "";
        if (ctype.includes("application/json") || ctype.includes("text/json") || !ctype) {
          try {
            koaCtx.request.body = JSON.parse(raw.toString("utf8") || "{}");
          } catch {
            koaCtx.throw(422, "Invalid JSON");
          }
        }
      } else {
        koaCtx.request.body = {};
      }
    }
    await next();
  });

  // 错误兜底
  app.use(async (koaCtx, next) => {
    try {
      await next();
    } catch (err) {
      logger.error({ err, path: koaCtx.path }, "请求处理异常");
      koaCtx.status = (err as { status?: number }).status ?? 500;
      koaCtx.body = {
        error: err instanceof Error ? err.message : "Internal Error",
      };
    }
  });

  const router = createRouter(ctx, feishuDispatcher);
  app.use(router.routes());
  app.use(router.allowedMethods());

  // 飞书传输模式
  const transport = config.FEISHU_TRANSPORT;
  if (transport === "webhook" || transport === "both") {
    app.listen(config.PORT, config.HOST, () => {
      logger.info(
        { host: config.HOST, port: config.PORT },
        "🚀 Feishu-Linear (Koa) 已启动",
      );
      printEndpoints(config.PUBLIC_URL, config);
    });
  } else {
    // 仅长连接时也起一个最小 HTTP（health + linear webhook + oauth）
    app.listen(config.PORT, config.HOST, () => {
      logger.info(
        { host: config.HOST, port: config.PORT },
        "🚀 HTTP 已启动（飞书事件走长连接）",
      );
      printEndpoints(config.PUBLIC_URL, config);
    });
  }

  if (transport === "ws" || transport === "both") {
    await startFeishuWS(ctx, feishuDispatcher);
  }

  setInterval(() => {
    try {
      cleanupOldEvents(db);
    } catch (err) {
      logger.error({ err }, "清理过期事件失败");
    }
  }, 6 * 60 * 60 * 1000);
}

function printEndpoints(
  publicUrl: string,
  config: ReturnType<typeof loadConfig>,
) {
  logger.info(`  GET  ${publicUrl}/health`);
  logger.info(`  POST ${publicUrl}/webhook/feishu          ← 飞书事件/回调统一入口`);
  logger.info(`  POST ${publicUrl}/webhook/linear          ← Linear Webhook`);
  if (config.LINEAR_AUTH_MODE === "oauth") {
    logger.info(`  GET  ${publicUrl}/oauth/linear/install    ← Linear OAuth 安装`);
  }
  logger.info(`  飞书传输: ${config.FEISHU_TRANSPORT}`);
  logger.info(`  Linear 鉴权: ${config.LINEAR_AUTH_MODE}`);
}

main().catch((err) => {
  logger.fatal({ err }, "启动失败");
  process.exit(1);
});
