import { eq } from "drizzle-orm";
import type { AppContext } from "../../app/context.js";
import { schema } from "../../db/index.js";
import * as feishu from "../../adapters/feishu/client.js";
import * as linearApi from "../../adapters/linear/api.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("sync-threads");

export async function findByFeishuThread(ctx: AppContext, threadId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.syncThreads)
    .where(eq(schema.syncThreads.feishuThreadId, threadId))
    .limit(1);
  return row;
}

export async function findByLinearIssue(ctx: AppContext, issueId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.syncThreads)
    .where(eq(schema.syncThreads.linearIssueId, issueId))
    .limit(1);
  return row;
}

export async function createSyncThread(
  ctx: AppContext,
  opts: {
    feishuChatId: string;
    feishuThreadId: string;
    feishuRootMsgId: string;
    linearIssueId: string;
    linearIssueIdentifier: string;
    linearIssueUrl: string;
  },
) {
  const existing = await findByFeishuThread(ctx, opts.feishuThreadId);
  if (existing) return existing;

  // 在 Linear Issue 上挂飞书会话回链
  let attachmentId: string | undefined;
  try {
    const linear = await ctx.getLinear();
    const link = feishu.feishuChatAppLink(opts.feishuChatId);
    const payload = await linearApi.linkUrlAttachment(
      linear,
      opts.linearIssueId,
      link,
      `飞书同步 · ${opts.linearIssueIdentifier}`,
    );
    attachmentId = (await payload.attachment)?.id;
  } catch (err) {
    log.warn({ err }, "创建 Linear attachment 失败（非致命）");
  }

  const [row] = await ctx.db
    .insert(schema.syncThreads)
    .values({
      ...opts,
      linearAttachmentId: attachmentId,
      syncEnabled: true,
    })
    .returning();

  log.info(
    {
      threadId: opts.feishuThreadId,
      issue: opts.linearIssueIdentifier,
    },
    "同步线程已建立",
  );
  return row;
}

export async function syncFeishuMessageToLinear(
  ctx: AppContext,
  opts: {
    feishuThreadId: string;
    feishuMsgId: string;
    senderName: string;
    content: string;
  },
) {
  const thread = await findByFeishuThread(ctx, opts.feishuThreadId);
  if (!thread?.syncEnabled) return null;

  const [existing] = await ctx.db
    .select()
    .from(schema.syncComments)
    .where(eq(schema.syncComments.feishuMsgId, opts.feishuMsgId))
    .limit(1);
  if (existing) return existing;

  const linear = await ctx.getLinear();
  const body = `**${opts.senderName}** (via 飞书):\n\n${opts.content}`;

  const comment = await linearApi.createComment(linear, {
    issueId: thread.linearIssueId,
    body,
    createAsUser: opts.senderName,
  });

  const [row] = await ctx.db
    .insert(schema.syncComments)
    .values({
      syncThreadId: thread.id,
      feishuMsgId: opts.feishuMsgId,
      linearCommentId: comment.id,
      direction: "feishu_to_linear",
    })
    .returning();

  return row;
}

export async function syncLinearCommentToFeishu(
  ctx: AppContext,
  opts: {
    linearIssueId: string;
    linearCommentId: string;
    actorName: string;
    body: string;
  },
) {
  const thread = await findByLinearIssue(ctx, opts.linearIssueId);
  if (!thread?.syncEnabled) return null;

  const [existing] = await ctx.db
    .select()
    .from(schema.syncComments)
    .where(eq(schema.syncComments.linearCommentId, opts.linearCommentId))
    .limit(1);
  if (existing) return existing;

  const text = `💬 **${opts.actorName}** (via Linear):\n\n${opts.body}`;
  const res = await feishu.replyText(
    ctx.lark,
    thread.feishuRootMsgId,
    text,
    true,
  );

  const feishuMsgId = (res.data as Record<string, unknown>)?.message_id as
    | string
    | undefined;

  if (!feishuMsgId) return null;

  const [row] = await ctx.db
    .insert(schema.syncComments)
    .values({
      syncThreadId: thread.id,
      feishuMsgId,
      linearCommentId: opts.linearCommentId,
      direction: "linear_to_feishu",
    })
    .returning();

  return row;
}

export async function notifyStatusChange(
  ctx: AppContext,
  opts: { linearIssueId: string; status: string; actor: string },
) {
  const thread = await findByLinearIssue(ctx, opts.linearIssueId);
  if (!thread) return;

  const emoji =
    /done|completed/i.test(opts.status)
      ? "✅"
      : /cancel/i.test(opts.status)
        ? "❌"
        : "🔄";

  await feishu.replyText(
    ctx.lark,
    thread.feishuRootMsgId,
    `${emoji} Issue ${thread.linearIssueIdentifier} 状态变更为 **${opts.status}** (by ${opts.actor})`,
    true,
  );
}
