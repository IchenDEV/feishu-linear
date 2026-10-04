import "dotenv/config";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, getDb } from "./index.js";

/**
 * 执行 drizzle/ 目录下的 SQL 迁移。
 *   pnpm db:migrate
 * 迁移目录默认取工作目录下的 drizzle/，可用 MIGRATIONS_DIR 覆盖。
 */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is missing");
  process.exit(1);
}

const folder = path.resolve(process.env.MIGRATIONS_DIR ?? "drizzle");

await migrate(getDb(url), { migrationsFolder: folder });
console.log(`Migrations applied (${folder})`);
await closeDb();
