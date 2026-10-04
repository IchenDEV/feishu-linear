import { timingSafeEqual } from "node:crypto";
import type { Context, Middleware, Next } from "koa";
import { logger } from "../../logger.js";

/** 读取 rawBody 并解析 JSON（Linear 验签依赖 rawBody） */
export const bodyMiddleware: Middleware = async (koaCtx, next) => {
  if (["POST", "PUT", "PATCH"].includes(koaCtx.method)) {
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
      if (
        ctype.includes("application/json") ||
        ctype.includes("text/json") ||
        !ctype
      ) {
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
};

/** 访问日志 + Server-Timing：用于观察飞书卡片回调 / 链接预览（3 秒限制）的耗时 */
export const accessLogMiddleware: Middleware = async (koaCtx, next) => {
  const start = Date.now();
  try {
    await next();
  } finally {
    const ms = Date.now() - start;
    if (!koaCtx.headerSent) koaCtx.set("server-timing", `app;dur=${ms}`);
    if (koaCtx.path !== "/health") {
      const body = koaCtx.request.body as
        | { header?: { event_type?: string }; type?: string }
        | undefined;
      logger.info(
        {
          method: koaCtx.method,
          path: koaCtx.path,
          status: koaCtx.status,
          ms,
          event: body?.header?.event_type ?? body?.type,
        },
        "request",
      );
    }
  }
};

export const errorMiddleware: Middleware = async (koaCtx, next) => {
  try {
    await next();
  } catch (err) {
    logger.error({ err, path: koaCtx.path }, "请求处理异常");
    koaCtx.status = (err as { status?: number }).status ?? 500;
    koaCtx.body = {
      error: err instanceof Error ? err.message : "Internal Error",
    };
  }
};

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Bearer Token 校验；token 为空表示该能力未启用，一律拒绝 */
export function requireBearer(getToken: () => string, feature: string) {
  return async (koaCtx: Context, next: Next) => {
    const token = getToken();
    if (!token) {
      koaCtx.status = 503;
      koaCtx.body = { error: `${feature} 未启用（未配置对应 token）` };
      return;
    }
    const header = koaCtx.get("authorization");
    const given = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!given || !safeEqual(given, token)) {
      koaCtx.status = 401;
      koaCtx.body = { error: "Unauthorized" };
      return;
    }
    await next();
  };
}
