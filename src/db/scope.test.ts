import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

// 需要真实 Postgres：TEST_DATABASE_URL=postgres://… pnpm test
const url = process.env.TEST_DATABASE_URL;
process.env.DB_MODE = "per-request";

describe("per-request 数据库作用域（Workers 模式）", { skip: !url }, () => {
  const load = async () => ({
    ...(await import("./index.js")),
    ...(await import("./scope.js")),
  });

  after(() => undefined);

  test("请求作用域外使用数据库会明确报错", async () => {
    const { getDb } = await load();
    const db = getDb(url!);
    assert.throws(() => db.select(), /per-request/);
  });

  test("作用域内可查询，并发请求各自使用独立连接池", async () => {
    const { getDb, withRequestDb, currentDbScope } = await load();
    const db = getDb(url!);

    const run = (n: number) =>
      withRequestDb(url!, async () => {
        const scope = currentDbScope();
        const res = await db.execute(sql`select ${n}::int as n, pg_backend_pid() as pid`);
        return { n: (res.rows[0] as { n: number }).n, scope };
      });

    const [a, b] = await Promise.all([run(1), run(2)]);
    assert.equal(a.n, 1);
    assert.equal(b.n, 2);
    assert.notEqual(a.scope, b.scope);
  });

  test("runInBackground 的任务登记到当前请求，后台任务内仍可访问同一个数据库作用域", async () => {
    const { getDb, withRequestDb } = await load();
    const { runInBackground } = await import("../utils/background.js");
    const db = getDb(url!);

    let seen: number | undefined;
    await withRequestDb(url!, async () => {
      runInBackground("t", async () => {
        const res = await db.execute(sql`select 42::int as n`);
        seen = (res.rows[0] as { n: number }).n;
      });
      // 请求处理函数返回前，任务应已登记
      const { currentDbScope } = await import("./index.js");
      assert.equal(currentDbScope()!.tasks.length, 1);
      await Promise.all(currentDbScope()!.tasks);
    });
    assert.equal(seen, 42);
  });
});
