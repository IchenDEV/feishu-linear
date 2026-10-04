/**
 * Cloudflare Workers 入口。
 *
 * 复用 `src/index.ts` 里的 Koa 应用：node:http 在 Workers 里由 `httpServerHandler` 桥接，
 * `app.listen(port)` 的端口只是内部路由键，并不真正监听。
 *
 * 与长驻进程的差异（都在这里 / 对应模块里适配）：
 * - 数据库：Hyperdrive 提供连接串；每个请求独立连接池（DB_MODE=per-request）
 * - 后台任务：使用 `cloudflare:workers` 的 waitUntil（响应后最多再给 30 秒）
 * - 定时清理：cron trigger → scheduled()
 */
import { env, waitUntil } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";

process.env.DB_MODE = "per-request";
// 配置校验要求 DATABASE_URL 存在；使用 Hyperdrive 时这里只是占位，真实连接串在请求内解析
// （Workers 不允许在全局作用域访问 Hyperdrive 绑定）
process.env.DATABASE_URL ||= "postgres://hyperdrive.invalid/placeholder";

// ESM import 会被提升，所以环境变量就绪后再动态加载应用
const { setWaitUntil } = await import("./utils/background.js");
setWaitUntil(waitUntil);
const { patchLarkHttpForWorkers } = await import(
  "./adapters/feishu/workers-http.js"
);
patchLarkHttpForWorkers();
const { setDatabaseUrlResolver } = await import("./db/index.js");
setDatabaseUrlResolver(() => env.HYPERDRIVE?.connectionString);
await import("./index.js");

const handler = httpServerHandler({
  port: Number(process.env.PORT ?? 3000),
});

export default {
  fetch: (request: Request, workerEnv: unknown, ctx: unknown) =>
    handler.fetch(request, workerEnv, ctx),

  /**
   * Cron 触发：通过应用自己的 /cron/* 路由执行，这样 AppContext（飞书/Linear 客户端）只在一处组装。
   * - 每日一次：清理过期事件
   * - 每 10 分钟：轮询视图订阅
   */
  async scheduled(
    event: { cron?: string },
    workerEnv: unknown,
    ctx: { waitUntil(p: Promise<unknown>): void },
  ) {
    const path = event.cron === "*/10 * * * *" ? "/cron/views" : "/cron/cleanup";
    const request = new Request(`https://cron.internal${path}`, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
    });
    ctx.waitUntil(handler.fetch(request, workerEnv, ctx));
  },
};
