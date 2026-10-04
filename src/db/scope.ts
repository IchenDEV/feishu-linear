import type { Middleware } from "koa";
import {
  createRequestDbScope,
  isPerRequestDb,
  requestDbStorage,
  type RequestDbScope,
} from "./index.js";
import { waitUntil } from "../utils/background.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("db-scope");

/** 响应发出后，等该请求的后台任务都结束，再关闭连接池 */
export function closeScopeLater(scope: RequestDbScope) {
  waitUntil(
    (async () => {
      // 任务内部又触发新的后台任务时，循环等待直到队列稳定
      let seen = 0;
      while (seen < scope.tasks.length) {
        const batch = scope.tasks.slice(seen);
        seen = scope.tasks.length;
        await Promise.allSettled(batch);
      }
      await scope.pool.end().catch((err) => log.warn({ err }, "关闭连接池失败"));
    })(),
  );
}

/**
 * per-request 模式下，为每个请求创建独立的数据库连接池并放入 AsyncLocalStorage。
 * shared 模式下是空操作。
 */
export function requestDbScope(databaseUrl: string): Middleware {
  if (!isPerRequestDb()) return (_ctx, next) => next();

  return async (_ctx, next) => {
    const scope = createRequestDbScope(databaseUrl);
    try {
      await requestDbStorage.run(scope, next);
    } finally {
      if (scope.tasks.length === 0) {
        // 没有后台任务：响应前直接关闭，避免连接在请求结束后被运行时回收成"已关闭的 socket"
        await scope.pool.end().catch(() => undefined);
      } else {
        closeScopeLater(scope);
      }
    }
  };
}

/** 非 HTTP 入口（如 Workers 的 scheduled）使用 */
export async function withRequestDb<T>(
  databaseUrl: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isPerRequestDb()) return fn();
  const scope = createRequestDbScope(databaseUrl);
  try {
    return await requestDbStorage.run(scope, fn);
  } finally {
    await scope.pool.end().catch(() => undefined);
  }
}
