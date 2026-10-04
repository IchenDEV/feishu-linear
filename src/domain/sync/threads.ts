import { and, eq } from "drizzle-orm";
import type { AppContext } from "../../app/context.js";
import { schema } from "../../db/index.js";
import * as feishu from "../../adapters/feishu/client.js";
import * as linearApi from "../../adapters/linear/api.js";
import {
  downloadLinearAsset,
  extractLinearAssets,
  parseMessage,
  uploadAttachmentsToLinear,
} from "../messages/content.js";
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
    const link = `${feishu.feishuChatAppLink(opts.feishuChatId)}&threadId=${encodeURIComponent(opts.feishuThreadId)}`;
    const payload = await linearApi.linkUrlAttachment(
      linear,
      opts.linearIssueId,
      link,
      `飞书同步线程 · ${opts.linearIssueIdentifier}`,
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
    { threadId: opts.feishuThreadId, issue: opts.linearIssueIdentifier },
    "同步线程已建立",
  );
  return row;
}

/** API / 命令入口：为已有 Issue 与飞书话题建立同步（对标 Slack 的「通过 API 创建同步线程」） */
export async function createSyncThreadForIssue(
  ctx: AppContext,
  opts: { issueKey: string; chatId: string; rootMessageId: string },
) {
  const linear = await ctx.getLinear();
  const issue = await linearApi.getIssue(linear, opts.issueKey);
  if (!issue) throw new Error(`未找到 Issue ${opts.issueKey}`);
  const res = await feishu.replyText(
    ctx.lark,
    opts.rootMessageId,
    `🔗 已与 Linear ${issue.identifier} 建立同步`,
    true,
  );
  const data = (res as { data?: Record<string, unknown> }).data ?? {};
  const threadId = data.thread_id as string | undefined;
  if (!threadId) throw new Error("未能创建话题（回复未返回 thread_id）");
  return createSyncThread(ctx, {
    feishuChatId: opts.chatId,
    feishuThreadId: threadId,
    feishuRootMsgId: opts.rootMessageId,
    linearIssueId: issue.id,
    linearIssueIdentifier: issue.identifier,
    linearIssueUrl: issue.url,
  });
}

// ───────────────────────── 飞书 → Linear ─────────────────────────

/** 把话题中的一条消息（文字 / 图片 / 文件）同步为 Issue 评论 */
export async function syncFeishuMessageToLinear(
  ctx: AppContext,
  opts: {
    feishuThreadId: string;
    feishuMsgId: string;
    senderName: string;
    messageType: string;
    content: string;
    mentionNames?: Record<string, string>;
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

  const parsed = parseMessage(
    opts.feishuMsgId,
    opts.messageType,
    opts.content,
    opts.mentionNames,
  );
  const attachmentMd = await uploadAttachmentsToLinear(ctx, parsed.attachments);
  const text = [parsed.text, ...attachmentMd].filter(Boolean).join("\n\n");
  if (!text) return null;

  const linear = await ctx.getLinear();
  const oauth = ctx.config.LINEAR_AUTH_MODE === "oauth";
  const comment = await linearApi.createComment(linear, {
    issueId: thread.linearIssueId,
    body: oauth ? text : `**${opts.senderName}**（来自飞书）：\n\n${text}`,
    createAsUser: oauth ? opts.senderName : undefined,
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

// ───────────────────────── Linear → 飞书 ─────────────────────────

export const FROM_FEISHU_MARK = "（来自飞书）";

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
  // 我们自己从飞书写入的评论（api_key 模式没有机器人身份可过滤）
  if (opts.body.slice(0, 200).includes(FROM_FEISHU_MARK)) return null;

  const [existing] = await ctx.db
    .select()
    .from(schema.syncComments)
    .where(eq(schema.syncComments.linearCommentId, opts.linearCommentId))
    .limit(1);
  if (existing) return existing;

  const { text, assets } = extractLinearAssets(opts.body);
  const head = `💬 **${opts.actorName}**（来自 Linear）`;
  const res = await feishu.replyMarkdown(
    ctx.lark,
    thread.feishuRootMsgId,
    text ? `${head}\n\n${text}` : head,
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

  // 图片 / 文件另发
  for (const asset of assets.slice(0, 10)) {
    try {
      const got = await downloadLinearAsset(ctx, asset.url);
      if (!got) {
        await feishu.replyMarkdown(
          ctx.lark,
          thread.feishuRootMsgId,
          `📎 [${asset.name}](${asset.url})`,
          true,
        );
        continue;
      }
      if (asset.kind === "image" && got.contentType.startsWith("image/")) {
        const key = await feishu.uploadImage(ctx.lark, got.data);
        await feishu.replyImage(ctx.lark, thread.feishuRootMsgId, key, true);
      } else {
        const key = await feishu.uploadFile(ctx.lark, {
          data: got.data,
          fileName: asset.name,
        });
        await feishu.replyFile(ctx.lark, thread.feishuRootMsgId, key, true);
      }
    } catch (err) {
      log.warn({ err, asset: asset.name }, "同步 Linear 附件到飞书失败");
    }
  }
  return row;
}

// ───────────────────────── 状态 / 重复 ─────────────────────────

/** Issue 状态变化 → 在同步线程里发布提示（完成 / 取消 / 重复 / 其它） */
export async function notifyStatusChange(
  ctx: AppContext,
  opts: {
    linearIssueId: string;
    status: string;
    statusType?: string;
    actor: string;
  },
) {
  const thread = await findByLinearIssue(ctx, opts.linearIssueId);
  if (!thread) return;

  let emoji = "🔄";
  let verb = `状态变更为 **${opts.status}**`;
  if (/duplicate/i.test(opts.status)) {
    emoji = "♻️";
    verb = "被标记为 **重复**";
  } else if (opts.statusType === "completed") {
    emoji = "✅";
    verb = "已 **完成**";
  } else if (opts.statusType === "canceled") {
    emoji = "❌";
    verb = "已 **取消**";
  }
  await feishu.replyMarkdown(
    ctx.lark,
    thread.feishuRootMsgId,
    `${emoji} Issue [${thread.linearIssueIdentifier}](${thread.linearIssueUrl}) ${verb}（${opts.actor}）`,
    true,
  );
}

/**
 * Issue 被标记为另一个 Issue 的重复：
 * - 记录关系
 * - 若原 Issue 还没有同步线程，则把该线程转移到原 Issue，让对话继续在同一处进行
 * - 否则只在线程里提示
 */
export async function handleDuplicate(
  ctx: AppContext,
  opts: { duplicateIssueId: string; originalIssueId: string; actor: string },
) {
  await ctx.db
    .insert(schema.issueDuplicates)
    .values({
      duplicateIssueId: opts.duplicateIssueId,
      originalIssueId: opts.originalIssueId,
    })
    .onConflictDoNothing();

  const dupThread = await findByLinearIssue(ctx, opts.duplicateIssueId);
  if (!dupThread) return;

  const linear = await ctx.getLinear();
  const original = await linearApi.getIssue(linear, opts.originalIssueId);
  if (!original) return;

  const originalThread = await findByLinearIssue(ctx, original.id);
  if (!originalThread) {
    await ctx.db
      .update(schema.syncThreads)
      .set({
        linearIssueId: original.id,
        linearIssueIdentifier: original.identifier,
        linearIssueUrl: original.url,
      })
      .where(eq(schema.syncThreads.id, dupThread.id));
    await feishu.replyMarkdown(
      ctx.lark,
      dupThread.feishuRootMsgId,
      `♻️ ${dupThread.linearIssueIdentifier} 被 ${opts.actor} 标记为 [${original.identifier}](${original.url}) 的重复。此话题已改为与 **${original.identifier}** 同步。`,
      true,
    );
  } else {
    await feishu.replyMarkdown(
      ctx.lark,
      dupThread.feishuRootMsgId,
      `♻️ ${dupThread.linearIssueIdentifier} 被 ${opts.actor} 标记为 [${original.identifier}](${original.url}) 的重复（原 Issue 已有同步线程，此话题保持原同步）。`,
      true,
    );
  }
}

export async function listDuplicatesOf(ctx: AppContext, originalIssueId: string) {
  return ctx.db
    .select()
    .from(schema.issueDuplicates)
    .where(eq(schema.issueDuplicates.originalIssueId, originalIssueId));
}

export async function unlinkThread(ctx: AppContext, threadId: string) {
  await ctx.db
    .delete(schema.syncThreads)
    .where(and(eq(schema.syncThreads.feishuThreadId, threadId)));
}
