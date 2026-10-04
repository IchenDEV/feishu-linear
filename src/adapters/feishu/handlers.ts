import type { AppContext } from "../../app/context.js";
import {
  removeMentions,
  detectIssueIdentifiers,
  isBotMentioned,
  type FeishuMention,
} from "../../utils/text.js";
import { acquireIssueExpansion, isDuplicate } from "../../utils/dedup.js";
import {
  findByFeishuThread,
  syncFeishuMessageToLinear,
} from "../../domain/sync/threads.js";
import { handleAgentMessage } from "../../domain/agent/agent.js";
import { issueCard } from "../../domain/issues/service.js";
import { parseCommand, runCommand, helpText } from "../../domain/commands/linear.js";
import { parseMessage } from "../../domain/messages/content.js";
import { getFeishuUserName } from "../../domain/users/mapping.js";
import { unfurlLinearUrl } from "../../domain/unfurl.js";
import { toPreview } from "../../cards/issue.js";
import { buildCreateForm } from "../../domain/issues/form.js";
import { getPrefs } from "../../domain/notify/engine.js";
import { buildPersonalPrefsCard } from "../../cards/settings.js";
import * as linearApi from "../linear/api.js";
import * as feishu from "./client.js";
import { handleCardAction } from "./card-actions.js";
import { withLocale } from "../../i18n/index.js";
import { resolveLocale } from "../../i18n/resolve.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("feishu-handlers");

const COOLDOWN_MS = 60 * 60 * 1000;

function normalizeMentions(
  raw: Array<Record<string, unknown>> | undefined,
): FeishuMention[] {
  if (!raw) return [];
  return raw.map((m) => {
    const id = m.id as Record<string, unknown> | undefined;
    return {
      key: String(m.key ?? ""),
      openId: id?.open_id as string | undefined,
      mentionedType: m.mentioned_type as string | undefined,
      name: m.name as string | undefined,
    };
  });
}

export function createFeishuHandlers(ctx: AppContext) {
  const handleMessage = async (data: Record<string, unknown>) => {
      const message = (data.message ?? data) as Record<string, unknown>;
      const sender = (data.sender ?? {}) as Record<string, unknown>;
      if (!message?.message_id) {
        log.debug({ data }, "Malformed message event");
        return;
      }

      const senderType = sender.sender_type as string | undefined;
      if (senderType === "app" || senderType === "bot") return;

      const senderId = (sender.sender_id as Record<string, unknown>)?.open_id as string;
      const messageId = message.message_id as string;
      const chatId = message.chat_id as string;
      const chatType = message.chat_type as string;
      const messageType = (message.message_type ?? message.msg_type) as string;
      const threadId = message.thread_id as string | undefined;
      const rootId = message.root_id as string | undefined;
      const parentId = message.parent_id as string | undefined;
      const content = message.content as string;
      const rawMentions = message.mentions as Array<Record<string, unknown>> | undefined;
      const mentions = normalizeMentions(rawMentions);

      // 去重用 message_id（官方建议）
      if (await isDuplicate(ctx.db, `feishu:msg:${messageId}`, "feishu")) return;

      // 纯净文本（去掉 @）用于命令 / Agent；保留 @ 名字的版本用于同步
      const plain = parseMessage(messageId, messageType, content);
      const text = removeMentions(plain.text);

      // 1. 命令（/linear、/ask；私聊可省略前缀）
      const cmd = parseCommand(text, chatType);
      if (cmd) {
        await runCommand(
          ctx,
          {
            chatId,
            chatType,
            messageId,
            threadId,
            rootId,
            parentId,
            senderOpenId: senderId,
            text,
            attachments: plain.attachments,
          },
          cmd.cmd,
          cmd.args,
        );
        return;
      }

      // 2. @机器人 / 私聊 → AI 智能体（即使在同步线程里，@ 机器人也不当作评论同步）
      if (chatType === "p2p" || isBotMentioned(mentions)) {
        await handleAgentMessage(ctx, {
          chatId,
          chatType,
          messageId,
          threadId,
          senderOpenId: senderId,
          senderName: await getFeishuUserName(ctx, senderId),
          messageText: text,
          attachments: plain.attachments,
        });
        return;
      }

      // 3. 同步线程：话题里的每条消息（文字 / 图片 / 文件）→ Linear 评论
      if (threadId) {
        const sync = await findByFeishuThread(ctx, threadId);
        if (sync?.syncEnabled) {
          const names: Record<string, string> = {};
          for (const m of mentions) if (m.key && m.name) names[m.key] = m.name;
          await syncFeishuMessageToLinear(ctx, {
            feishuThreadId: threadId,
            feishuMsgId: messageId,
            senderName: await getFeishuUserName(ctx, senderId),
            messageType,
            content,
            mentionNames: names,
          });
          return;
        }
      }

      // 4. Issue ID 自动展开（ENG-123）；链接在未配置飞书原生预览时由机器人回复展开
      if (messageType === "text" || messageType === "post") {
        await expandReferences(ctx, { chatId, messageId, threadId, text: plain.text });
      }
  };

  return {
    /** 按发送者 / 会话解析界面语言，其后的处理都在该语言下进行 */
    async onMessageReceive(data: Record<string, unknown>) {
      const message = (data.message ?? data) as Record<string, unknown>;
      const sender = (data.sender ?? {}) as Record<string, unknown>;
      const openId = (sender.sender_id as Record<string, unknown> | undefined)?.open_id as
        | string
        | undefined;
      const locale = await resolveLocale(ctx, {
        openId,
        chatId: message.chat_id as string | undefined,
      });
      return withLocale(locale, () => handleMessage(data));
    },

    async onCardAction(data: Record<string, unknown>) {
      return handleCardAction(ctx, data);
    },

    /** url.preview.get：3 秒内返回；私有团队内容不展开 */
    async onLinkPreview(data: Record<string, unknown>) {
      const url = (data.context as Record<string, unknown> | undefined)?.url as
        | string
        | undefined;
      if (!url) return {};
      const operator = data.operator as Record<string, any> | undefined;
      const locale = await resolveLocale(ctx, { openId: operator?.open_id });
      return withLocale(locale, async () => {
        const unfurl = await unfurlLinearUrl(ctx, url, { compact: true });
        return unfurl ? toPreview(unfurl.title, unfurl.card) : {};
      });
    },

    async onBotMenu(data: Record<string, unknown>) {
      const eventKey = data.event_key as string;
      const operator = data.operator as Record<string, any> | undefined;
      const openId: string | undefined =
        operator?.operator_id?.open_id ?? (typeof operator?.operator_id === "string" ? operator.operator_id : undefined);
      if (!openId) return;

      const locale = await resolveLocale(ctx, { openId });
      await withLocale(locale, async () => {
      try {
        switch (eventKey) {
          case "create_issue": {
            const card = await buildCreateForm(ctx, { chatId: openId });
            await feishu.sendP2PCard(ctx.lark, openId, card);
            break;
          }
          case "my_notifications":
            await feishu.sendP2PCard(
              ctx.lark,
              openId,
              buildPersonalPrefsCard(await getPrefs(ctx, openId)),
            );
            break;
          case "help":
          default:
            await feishu.sendText(ctx.lark, openId, helpText());
        }
      } catch (err) {
        log.error({ err, eventKey }, "Bot menu event failed");
      }
      });
    },
  };
}

/** 消息中的 Issue 编号 / Linear 链接 → 回复一张卡片（带评论、改负责人、订阅、同步线程等操作） */
async function expandReferences(
  ctx: AppContext,
  opts: { chatId: string; messageId: string; threadId?: string; text: string },
) {
  const cardCtx = { chatId: opts.chatId, messageId: opts.messageId, threadId: opts.threadId };

  // Issue 编号
  for (const id of detectIssueIdentifiers(opts.text).slice(0, 3)) {
    try {
      const linear = await ctx.getLinear();
      const issue = await linearApi.getIssue(linear, id);
      if (!issue) continue;
      if ((await issue.team)?.private) continue; // 私有团队不展开
      // 冷却窗口内展开过则跳过（DB 原子占位，跨实例共享）
      if (!(await acquireIssueExpansion(ctx.db, opts.chatId, id, COOLDOWN_MS))) continue;
      await feishu.replyCard(
        ctx.lark,
        opts.messageId,
        await issueCard(ctx, issue, cardCtx),
        Boolean(opts.threadId),
      );
    } catch (err) {
      log.error({ err, id }, "Issue key unfurl failed");
    }
  }

  // 链接：已配置原生链接预览时交给飞书，避免重复
  if (ctx.config.FEISHU_LINK_PREVIEW) return;
  const urls = opts.text.match(/https?:\/\/linear\.app\/[^\s)>]+/g) ?? [];
  for (const url of urls.slice(0, 2)) {
    try {
      const unfurl = await unfurlLinearUrl(ctx, url, { card: cardCtx });
      if (!unfurl) continue;
      if (!(await acquireIssueExpansion(ctx.db, opts.chatId, url, COOLDOWN_MS))) continue;
      await feishu.replyCard(ctx.lark, opts.messageId, unfurl.card, Boolean(opts.threadId));
    } catch (err) {
      log.error({ err, url }, "Link unfurl failed");
    }
  }
}
