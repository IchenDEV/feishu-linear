import { eq, lt } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

export function isDuplicate(
  db: Db,
  eventId: string,
  source: "feishu" | "linear",
): boolean {
  const existing = db
    .select()
    .from(schema.processedEvents)
    .where(eq(schema.processedEvents.eventId, eventId))
    .get();

  if (existing) return true;

  db.insert(schema.processedEvents).values({ eventId, source }).run();
  return false;
}

export function cleanupOldEvents(db: Db) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  db.delete(schema.processedEvents)
    .where(lt(schema.processedEvents.processedAt, cutoff))
    .run();
}
