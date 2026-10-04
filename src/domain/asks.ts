import type { AppContext } from "../app/context.js";
import * as feishu from "../adapters/feishu/client.js";
import * as linearApi from "../adapters/linear/api.js";
import { buildIssueCard } from "../cards/issue.js";
import { toIssueCardData, attribute, upgradeToSyncThread } from "./issues/service.js";
import { getAsks } from "./settings/service.js";
import { getFeishuUserName } from "./users/mapping.js";
import { deriveTitle } from "./messages/source.js";
import { uploadAttachmentsToLinear, type Attachment } from "./messages/content.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("asks");

/**
 * Asks 等价实现：群里任何人（不需要 Linear 账号）发 `/ask 内容`，
 * 在群配置的团队里创建 Issue，并把该话题与 Issue 同步，进展自动回到话题里。
 */
export async function submitAsk(
  ctx: AppContext,
  opts: {
    chatId: string;
    messageId: string;
    threadId?: string;
    openId: string;
    text: string;
    attachments?: Attachment[];
  },
) {
  const asks = await getAsks(ctx, opts.chatId);
  if (!asks) {
    await feishu.replyText(
      ctx.lark,
      opts.messageId,
      "本群还没有启用 Asks。群主 / 管理员可发送 /linear settings 启用。",
    );
    return null;
  }
  if (!opts.text.trim() && !opts.attachments?.length) {
    await feishu.replyText(ctx.lark, opts.messageId, "用法：/ask 你的需求或问题（可附图片 / 文件）");
    return null;
  }

  const name = await getFeishuUserName(ctx, opts.openId);
  const linear = await ctx.getLinear();
  const who = attribute(ctx, name);
  const att = await uploadAttachmentsToLinear(ctx, opts.attachments ?? []);

  const issue = await linearApi.createIssue(linear, {
    teamId: asks.teamId,
    title: deriveTitle(opts.text, `${name} 的请求`),
    description:
      [`**${name}** 通过飞书提交的请求：`, opts.text, ...att].filter(Boolean).join("\n\n") +
      who.footer,
    templateId: asks.templateId,
    createAsUser: who.createAsUser,
  });

  const synced = await upgradeToSyncThread(ctx, {
    issue,
    chatId: opts.chatId,
    messageId: opts.messageId,
    threadId: opts.threadId,
  });
  log.info({ issue: issue.identifier, synced: Boolean(synced) }, "Asks 已创建");

  await feishu.replyCard(
    ctx.lark,
    opts.messageId,
    buildIssueCard(await toIssueCardData(issue, { synced: Boolean(synced) })),
    true,
  );
  return issue;
}
