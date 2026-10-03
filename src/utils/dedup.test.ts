import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { closeDb, getDb, schema } from "../db/index.js";
import {
  acquireIssueExpansion,
  cleanupOldEvents,
  isDuplicate,
} from "./dedup.js";

// 需要真实 Postgres：TEST_DATABASE_URL=postgres://… npm test（已执行过 db:migrate）
const url = process.env.TEST_DATABASE_URL;

describe("dedup (postgres)", { skip: !url }, () => {
  const db = getDb(url ?? "postgres://localhost/none");

  before(async () => {
    await db.execute(
      sql`truncate processed_events, issue_expansions restart identity`,
    );
  });
  after(async () => closeDb());

  test("isDuplicate：并发下只有一个调用算首次", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => isDuplicate(db, "evt-1", "feishu")),
    );
    assert.equal(results.filter((d) => !d).length, 1);
    assert.equal(await isDuplicate(db, "evt-1", "feishu"), true);
    assert.equal(await isDuplicate(db, "evt-2", "feishu"), false);
  });

  test("acquireIssueExpansion：冷却窗口内只放行一次，窗口过后可再次放行", async () => {
    const hour = 60 * 60 * 1000;
    const got = await Promise.all(
      Array.from({ length: 5 }, () =>
        acquireIssueExpansion(db, "chat-a", "ENG-1", hour),
      ),
    );
    assert.equal(got.filter(Boolean).length, 1);
    // 不同群 / 不同 Issue 互不影响
    assert.equal(await acquireIssueExpansion(db, "chat-b", "ENG-1", hour), true);
    assert.equal(await acquireIssueExpansion(db, "chat-a", "ENG-2", hour), true);
    // 冷却为 0：立刻可再放行
    assert.equal(await acquireIssueExpansion(db, "chat-a", "ENG-1", 0), true);
  });

  test("cleanupOldEvents：只清理过期记录", async () => {
    await db.insert(schema.processedEvents).values({
      eventId: "old",
      source: "linear",
      processedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
    });
    await cleanupOldEvents(db);
    assert.equal(await isDuplicate(db, "old", "linear"), false); // 已被清掉
    assert.equal(await isDuplicate(db, "evt-2", "feishu"), true); // 新记录仍在
  });
});
