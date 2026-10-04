import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { attachDatabasePool } from "@vercel/functions";
import * as schema from "./schema.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("db");

function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;

/**
 * 两种连接模式（由 DB_MODE 决定）：
 * - shared（默认，VPS / Vercel）：进程内单例连接池
 * - per-request（Cloudflare Workers）：Workers 禁止跨请求复用 I/O 对象，
 *   每个请求创建独立连接池（经 Hyperdrive 复用到源库的真实连接），请求结束后关闭。
 *   业务代码仍然只使用同一个 `ctx.db`，由 AsyncLocalStorage 解析到当前请求的连接。
 */
export const isPerRequestDb = () => process.env.DB_MODE === "per-request";

export interface RequestDbScope {
  db: Db;
  pool: pg.Pool;
  /** 响应后仍在使用该连接的后台任务；全部结束后才能关闭连接池 */
  tasks: Promise<unknown>[];
}

export const requestDbStorage = new AsyncLocalStorage<RequestDbScope>();

export function currentDbScope() {
  return requestDbStorage.getStore();
}

let urlResolver: (() => string | undefined) | undefined;

/**
 * 连接串需要在请求内才能取到时使用（Workers 的 Hyperdrive 绑定在全局作用域访问会被运行时拒绝）。
 * 返回 undefined 时回退到 config 里的 DATABASE_URL。
 */
export function setDatabaseUrlResolver(fn: () => string | undefined) {
  urlResolver = fn;
}

export function createRequestDbScope(databaseUrl: string): RequestDbScope {
  const pool = new pg.Pool({
    connectionString: urlResolver?.() ?? databaseUrl,
    // Workers 单次调用同时外连上限约 6 个
    max: Number(process.env.DB_POOL_MAX ?? 4),
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", (err) => {
    // pg-cloudflare 的读循环在我们主动 pool.end() 关闭 socket 后会抛出这个错误，属于正常收尾
    if (/socket has been closed/i.test(err.message)) {
      log.debug("Postgres socket closed");
      return;
    }
    log.error({ err }, "Postgres connection error");
  });
  return { db: createDb(pool), pool, tasks: [] };
}

let _db: Db | null = null;
let _pool: pg.Pool | null = null;

export function getDb(databaseUrl: string): Db {
  if (_db) return _db;

  if (isPerRequestDb()) {
    // 代理到当前请求的 db；脱离请求上下文使用会明确报错而不是悄悄复用陈旧连接
    _db = new Proxy({} as Db, {
      get(_target, prop) {
        const scope = requestDbStorage.getStore();
        if (!scope) {
          throw new Error(
            "In per-request mode the database can only be used inside a request (or its background tasks)",
          );
        }
        const value = Reflect.get(scope.db, prop);
        return typeof value === "function" ? value.bind(scope.db) : value;
      },
    });
    return _db;
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    // Fluid compute 下单实例并发处理多请求；连接数保持较小，避免打满数据库
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", (err) => log.error({ err }, "Postgres pool error"));
  if (process.env.VERCEL) attachDatabasePool(pool);

  _pool = pool;
  _db = createDb(pool);
  log.info("Database pool created");
  return _db;
}

export async function closeDb() {
  await _pool?.end();
  _pool = null;
  _db = null;
}

export { schema };
