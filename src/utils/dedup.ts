import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

/**
 * 原子去重：INSERT … ON CONFLICT DO NOTHING，插入成功才算首次处理。
 * 多实例 / 并发重试下也不会重复处理。
 */
export async function isDuplicate(
  db: Db,
  eventId: string,
  source: "feishu" | "linear",
): Promise<boolean> {
  const inserted = await db
    .insert(schema.processedEvents)
    .values({ eventId, source })
    .onConflictDoNothing({ target: schema.processedEvents.eventId })
    .returning({ id: schema.processedEvents.id });
  return inserted.length === 0;
}

/**
 * 冷却检查（跨实例共享）：窗口内已展开过返回 false，否则占位并返回 true。
 */
export async function acquireIssueExpansion(
  db: Db,
  chatId: string,
  issueIdentifier: string,
  cooldownMs: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - cooldownMs);
  const rows = await db
    .insert(schema.issueExpansions)
    .values({ chatId, issueIdentifier })
    .onConflictDoUpdate({
      target: [
        schema.issueExpansions.chatId,
        schema.issueExpansions.issueIdentifier,
      ],
      set: { expandedAt: new Date() },
      setWhere: lt(schema.issueExpansions.expandedAt, cutoff),
    })
    .returning({ id: schema.issueExpansions.id });
  return rows.length > 0;
}

export async function cleanupOldEvents(db: Db) {
  const eventCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dayCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db
    .delete(schema.processedEvents)
    .where(lt(schema.processedEvents.processedAt, eventCutoff));
  await db
    .delete(schema.issueExpansions)
    .where(lt(schema.issueExpansions.expandedAt, dayCutoff));
  await db
    .delete(schema.oauthStates)
    .where(lt(schema.oauthStates.createdAt, dayCutoff));
}

// 供测试 / 调试使用
export async function hasEvent(db: Db, eventId: string) {
  const [row] = await db
    .select()
    .from(schema.processedEvents)
    .where(and(eq(schema.processedEvents.eventId, eventId)));
  return Boolean(row);
}
