import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { attachDatabasePool } from "@vercel/functions";
import * as schema from "./schema.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("db");

let _db: ReturnType<typeof createDb> | null = null;
let _pool: pg.Pool | null = null;

function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

/**
 * 连接 Postgres。
 * - Vercel：使用 Neon 的 pooled 连接串，`attachDatabasePool` 保证函数挂起前释放空闲连接
 * - VPS / Docker：直接连自建或托管 Postgres
 */
export function getDb(databaseUrl: string) {
  if (_db) return _db;

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    // Fluid compute 下单实例并发处理多请求；连接数保持较小，避免打满数据库
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", (err) => log.error({ err }, "Postgres 连接池异常"));
  if (process.env.VERCEL) attachDatabasePool(pool);

  _pool = pool;
  _db = createDb(pool);
  log.info("数据库连接池已创建");
  return _db;
}

export async function closeDb() {
  await _pool?.end();
  _pool = null;
  _db = null;
}

export type Db = ReturnType<typeof createDb>;
export { schema };
