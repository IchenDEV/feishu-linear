import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import * as feishuClient from "../feishu/client.js";
import * as linearClient from "../linear/client.js";
import { buildIssueNotifyCard } from "../cards/issue-card.js";
import { createChildLogger } from "../logger.js";
import type { Client as LarkClient } from "@larksuiteoapi/node-sdk";
import type { LinearClient as LinearSdkClient } from "@linear/sdk";

const log = createChildLogger("thread-sync");

// ── 创建同步线程 ──
export async function createSyncThread(
  db: Db,
  opts: {
    feishuChatId: string;
    feishuThreadId: string;
    feishuRootMsgId: string;
    linearIssueId: string;
    linearIssueIdentifier: string;
    linearIssueUrl: string;
  },
) {
  const existing = db
    .select()
    .from(schema.syncThreads)
    .where(eq(schema.syncThreads.feishuThreadId, opts.feishuThreadId))
    .get();

  if (existing) {
    log.info({ threadId: opts.feishuThreadId }, "同步线程已存在");
    return existing;
  }

  const [result] = db
    .insert(schema.syncThreads)
    .values(opts)
    .returning()
    .all();

  log.info(
    { threadId: opts.feishuThreadId, issueId: opts.linearIssueIdentifier },
    "同步线程已建立",
  );
  return result;
}

// ── 飞书消息 → Linear 评论 ──
export async function syncFeishuToLinear(
  db: Db,
  linear: LinearSdkClient,
  opts: {
    feishuThreadId: string;
    feishuMsgId: string;
    senderName: string;
    content: string;
  },
) {
  const syncThread = db
    .select()
    .from(schema.syncThreads)
    .where(eq(schema.syncThreads.feishuThreadId, opts.feishuThreadId))
    .get();

  if (!syncThread || !syncThread.syncEnabled) {
    return null;
  }

  // 检查是否已同步（防重复）
  const existingComment = db
    .select()
    .from(schema.syncComments)
    .where(eq(schema.syncComments.feishuMsgId, opts.feishuMsgId))
    .get();

  if (existingComment) {
    log.debug({ msgId: opts.feishuMsgId }, "消息已同步，跳过");
    return existingComment;
  }

  const body = `**${opts.senderName}** (via 飞书):\n\n${opts.content}`;

  const comment = await linearClient.createComment(
    linear,
    syncThread.linearIssueId,
    body,
  );

  const [syncComment] = db
    .insert(schema.syncComments)
    .values({
      syncThreadId: syncThread.id,
      feishuMsgId: opts.feishuMsgId,
      linearCommentId: comment.id,
      direction: "feishu_to_linear",
    })
    .returning()
    .all();

  log.info(
    {
      msgId: opts.feishuMsgId,
      commentId: comment.id,
      issue: syncThread.linearIssueIdentifier,
    },
    "飞书消息已同步到 Linear",
  );

  return syncComment;
}

// ── Linear 评论 → 飞书话题 ──
export async function syncLinearToFeishu(
  db: Db,
  lark: LarkClient,
  opts: {
    linearIssueId: string;
    linearCommentId: string;
    actorName: string;
    body: string;
  },
) {
  const syncThread = db
    .select()
    .from(schema.syncThreads)
    .where(eq(schema.syncThreads.linearIssueId, opts.linearIssueId))
    .get();

  if (!syncThread || !syncThread.syncEnabled) {
    return null;
  }

  // 检查是否已同步（防回声）
  const existingComment = db
    .select()
    .from(schema.syncComments)
    .where(eq(schema.syncComments.linearCommentId, opts.linearCommentId))
    .get();

  if (existingComment) {
    log.debug({ commentId: opts.linearCommentId }, "评论已同步，跳过");
    return existingComment;
  }

  const text = `💬 **${opts.actorName}** (via Linear):\n\n${opts.body}`;

  const res = await feishuClient.replyMessage(
    lark,
    syncThread.feishuRootMsgId,
    JSON.stringify({ text }),
    "text",
    true, // reply_in_thread
  );

  const feishuMsgId = (res.data as Record<string, unknown>)?.message_id as string;

  if (feishuMsgId) {
    const [syncComment] = db
      .insert(schema.syncComments)
      .values({
        syncThreadId: syncThread.id,
        feishuMsgId,
        linearCommentId: opts.linearCommentId,
        direction: "linear_to_feishu",
      })
      .returning()
      .all();

    log.info(
      {
        commentId: opts.linearCommentId,
        msgId: feishuMsgId,
        issue: syncThread.linearIssueIdentifier,
      },
      "Linear 评论已同步到飞书",
    );
    return syncComment;
  }

  return null;
}

// ── Issue 状态变更通知到飞书同步线程 ──
export async function notifySyncThreadStatusChange(
  db: Db,
  lark: LarkClient,
  opts: {
    linearIssueId: string;
    status: string;
    actor: string;
  },
) {
  const syncThread = db
    .select()
    .from(schema.syncThreads)
    .where(eq(schema.syncThreads.linearIssueId, opts.linearIssueId))
    .get();

  if (!syncThread) return;

  const statusEmoji =
    opts.status.toLowerCase() === "done" || opts.status.toLowerCase() === "completed"
      ? "✅"
      : opts.status.toLowerCase() === "cancelled" || opts.status.toLowerCase() === "canceled"
        ? "❌"
        : "🔄";

  const text = `${statusEmoji} Issue ${syncThread.linearIssueIdentifier} 状态变更为 **${opts.status}** (by ${opts.actor})`;

  await feishuClient.replyMessage(
    lark,
    syncThread.feishuRootMsgId,
    JSON.stringify({ text }),
    "text",
    true,
  );
}
