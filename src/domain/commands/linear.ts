import type { AppContext } from "../../app/context.js";
import * as feishu from "../../adapters/feishu/client.js";
import * as linearApi from "../../adapters/linear/api.js";
import { buildPersonalPrefsCard } from "../../cards/settings.js";
import { buildCreateForm, buildLinkForm, deliverPrivately } from "../issues/form.js";
import { linkExistingIssue } from "../issues/service.js";
import { createSyncThreadForIssue } from "../sync/threads.js";
import { fetchSourceMessage, deriveTitle } from "../messages/source.js";
import { submitAsk } from "../asks.js";
import { bindByEmail, requireLinearIdentity, NotBoundError } from "../users/mapping.js";
import { buildSettingsForChat, permissions, requireConfigurer } from "../settings/service.js";
import { createProjectChannel, getPrefs } from "../notify/engine.js";
import type { Attachment } from "../messages/content.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("commands");

export interface CommandEnv {
  chatId: string;
  chatType: string;
  messageId: string;
  threadId?: string;
  /** 话题首条消息 / 被回复的消息 */
  rootId?: string;
  parentId?: string;
  senderOpenId: string;
  /** 已去掉 @机器人 的纯文本 */
  text: string;
  attachments: Attachment[];
}

export const HELP_TEXT = [
  "Linear 连接器 · 命令（群里加 / 前缀，私聊可省略）",
  "• /linear — 打开「创建 Issue」表单；在话题内或回复某条消息时发送，会把那条消息转为 Issue",
  "• /linear create 标题 — 带标题预填表单",
  "• /linear link [ENG-123] — 把消息关联到已有 Issue",
  "• /linear sync ENG-123 — 让当前话题与 Issue 双向同步",
  "• /linear bind 邮箱 — 绑定你的 Linear 账号",
  "• /linear me — 我的通知偏好",
  "• /linear settings — 本群设置（默认团队/项目、订阅、Guidance、Asks；群主/管理员）",
  "• /linear project-channel 项目名 — 为项目创建专属群（管理员）",
  "• /ask 内容 — 向团队提需求（无需 Linear 账号，需管理员先启用 Asks）",
  "• @机器人 + 自然语言 — 智能体帮你查询、创建、更新",
].join("\n");

/** 识别命令。群里必须以 / 开头；私聊也接受裸词 */
export function parseCommand(
  text: string,
  chatType: string,
): { cmd: string; args: string } | null {
  const t = text.trim();
  const m = t.match(/^\/(linear|ask)\b\s*(.*)$/is);
  if (m) {
    if (m[1].toLowerCase() === "ask") return { cmd: "ask", args: m[2].trim() };
    const [cmd = "", ...rest] = m[2].trim().split(/\s+/);
    return { cmd: cmd.toLowerCase() || "create", args: rest.join(" ").trim() };
  }
  if (chatType === "p2p") {
    const [cmd = "", ...rest] = t.split(/\s+/);
    const known = ["help", "帮助", "bind", "create", "新建", "link", "me", "settings"];
    if (known.includes(cmd.toLowerCase())) {
      return { cmd: cmd.toLowerCase(), args: rest.join(" ").trim() };
    }
  }
  return null;
}

const say = (ctx: AppContext, env: CommandEnv, text: string) =>
  feishu.replyText(ctx.lark, env.messageId, text, Boolean(env.threadId));

/** 命令的源消息：话题内 → 话题首条；回复 → 被回复消息；否则无 */
function sourceMessageId(env: CommandEnv): string | undefined {
  if (env.threadId) return env.rootId ?? env.parentId;
  return env.parentId;
}

export async function runCommand(
  ctx: AppContext,
  env: CommandEnv,
  cmd: string,
  args: string,
) {
  try {
    switch (cmd) {
      case "help":
      case "帮助":
        return void (await say(ctx, env, HELP_TEXT));

      case "bind": {
        if (!args) return void (await say(ctx, env, "用法：/linear bind 你的Linear邮箱"));
        const name = (await feishu.getUserProfile(ctx.lark, env.senderOpenId)).name;
        const bound = await bindByEmail(ctx, {
          feishuOpenId: env.senderOpenId,
          linearEmail: args,
          feishuName: name,
        });
        return void (await say(ctx, env, `✅ 已绑定 Linear 用户：${bound.linearName}（${bound.linearEmail}）`));
      }

      case "create":
      case "new":
      case "新建":
      case "": {
        await requireLinearIdentity(ctx, env.senderOpenId);
        const srcId = sourceMessageId(env);
        const src = srcId ? await fetchSourceMessage(ctx, srcId) : null;
        const card = await buildCreateForm(ctx, {
          chatId: env.chatId,
          messageId: srcId ?? (env.chatType === "p2p" ? undefined : env.messageId),
          threadId: env.threadId,
          title: args || (src ? deriveTitle(src.text) : undefined),
          description: src?.text,
        });
        return void (await deliverPrivately(ctx, {
          chatId: env.chatId,
          openId: env.senderOpenId,
          card,
          chatType: env.chatType,
        }));
      }

      case "link": {
        await requireLinearIdentity(ctx, env.senderOpenId);
        const srcId = sourceMessageId(env) ?? env.messageId;
        if (args) {
          const src = await fetchSourceMessage(ctx, srcId);
          await linkExistingIssue(ctx, {
            issueKey: args,
            chatId: env.chatId,
            operatorOpenId: env.senderOpenId,
            messageId: srcId,
            threadId: env.threadId,
            excerpt: src?.text,
            attachments: src?.attachments,
            replyInThread: Boolean(env.threadId),
          });
          return;
        }
        return void (await deliverPrivately(ctx, {
          chatId: env.chatId,
          openId: env.senderOpenId,
          card: buildLinkForm({ chatId: env.chatId, messageId: srcId, threadId: env.threadId }),
          chatType: env.chatType,
        }));
      }

      case "sync": {
        await requireLinearIdentity(ctx, env.senderOpenId);
        if (!args) return void (await say(ctx, env, "用法：/linear sync ENG-123"));
        const root = sourceMessageId(env) ?? env.messageId;
        const row = await createSyncThreadForIssue(ctx, {
          issueKey: args,
          chatId: env.chatId,
          rootMessageId: root,
        });
        return void log.info({ issue: row?.linearIssueIdentifier }, "命令建立同步线程");
      }

      case "me":
      case "notify": {
        const prefs = await getPrefs(ctx, env.senderOpenId);
        return void (await feishu.sendP2PCard(ctx.lark, env.senderOpenId, buildPersonalPrefsCard(prefs)));
      }

      case "settings":
      case "设置": {
        if (env.chatType === "p2p") {
          return void (await say(ctx, env, "请在需要配置的群里发送 /linear settings。"));
        }
        const perms = await permissions(ctx, env.chatId, env.senderOpenId);
        if (!perms.canConfigure) {
          return void (await say(ctx, env, "仅群主 / 群管理员 / Linear 管理员可以打开设置。"));
        }
        const card = await buildSettingsForChat(ctx, env.chatId, env.senderOpenId);
        return void (await deliverPrivately(ctx, {
          chatId: env.chatId,
          openId: env.senderOpenId,
          card,
          chatType: env.chatType,
        }));
      }

      case "project-channel": {
        await requireConfigurer(ctx, env.chatId, env.senderOpenId);
        if (!args) return void (await say(ctx, env, "用法：/linear project-channel 项目名"));
        const linear = await ctx.getLinear();
        const projects = await linearApi.getProjects(linear, 100);
        const p =
          projects.find((x) => x.name.toLowerCase() === args.toLowerCase()) ??
          projects.find((x) => x.name.toLowerCase().includes(args.toLowerCase()));
        if (!p) return void (await say(ctx, env, `未找到项目「${args}」`));
        const row = await createProjectChannel(ctx, { projectId: p.id, autoCreated: false });
        return void (await say(ctx, env, `✅ 项目「${p.name}」的专属群已就绪（chat_id: ${row?.feishuChatId}）`));
      }

      case "ask":
        return void (await submitAsk(ctx, {
          chatId: env.chatId,
          messageId: env.messageId,
          threadId: env.threadId,
          openId: env.senderOpenId,
          text: args,
          attachments: env.attachments,
        }));

      default:
        return void (await say(ctx, env, `不认识的命令「${cmd}」。\n\n${HELP_TEXT}`));
    }
  } catch (err) {
    const msg =
      err instanceof NotBoundError || (err instanceof Error && err.name === "ForbiddenError")
        ? err.message
        : `❌ ${err instanceof Error ? err.message : String(err)}`;
    if (!(err instanceof NotBoundError)) log.error({ err, cmd }, "命令执行失败");
    await say(ctx, env, msg).catch(() => {});
  }
}
