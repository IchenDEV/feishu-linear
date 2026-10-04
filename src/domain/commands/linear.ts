import type { AppContext } from "../../app/context.js";
import * as feishu from "../../adapters/feishu/client.js";
import * as linearApi from "../../adapters/linear/api.js";
import { buildPersonalPrefsCard } from "../../cards/settings.js";
import { buildCreateForm, buildLinkForm, deliverPrivately } from "../issues/form.js";
import { linkExistingIssue } from "../issues/service.js";
import { createSyncThreadForIssue } from "../sync/threads.js";
import { fetchSourceMessage, deriveTitle } from "../messages/source.js";
import { submitAsk } from "../asks.js";
import { bindVerified, requireLinearIdentity, NotBoundError } from "../users/mapping.js";
import { buildSettingsForChat, permissions, requireConfigurer } from "../settings/service.js";
import { createProjectChannel, getPrefs } from "../notify/engine.js";
import type { Attachment } from "../messages/content.js";
import { t, normalizeLocale, currentLocale, withLocale } from "../../i18n/index.js";
import { setUserLocale } from "../../i18n/resolve.js";
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

export const helpText = () => t("help.text");

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
    const known = ["help", "帮助", "bind", "create", "新建", "link", "me", "settings", "lang"];
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
        return void (await say(ctx, env, helpText()));

      case "bind": {
        if (!args) return void (await say(ctx, env, t("cmd.bind.usage")));
        const bound = await bindVerified(ctx, env.senderOpenId, args);
        return void (await say(ctx, env, t("cmd.bind.done", { name: bound.linearName, email: bound.linearEmail })));
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
        if (!args) return void (await say(ctx, env, t("cmd.sync.usage")));
        const root = sourceMessageId(env) ?? env.messageId;
        const row = await createSyncThreadForIssue(ctx, {
          issueKey: args,
          chatId: env.chatId,
          rootMessageId: root,
        });
        return void log.info({ issue: row?.linearIssueIdentifier }, "Synced thread set up via command");
      }

      case "me":
      case "notify": {
        const prefs = await getPrefs(ctx, env.senderOpenId);
        return void (await feishu.sendP2PCard(ctx.lark, env.senderOpenId, buildPersonalPrefsCard(prefs)));
      }

      case "settings":
      case "设置": {
        if (env.chatType === "p2p") {
          return void (await say(ctx, env, t("cmd.settings.groupOnly")));
        }
        const perms = await permissions(ctx, env.chatId, env.senderOpenId);
        if (!perms.canConfigure) {
          return void (await say(ctx, env, t("cmd.settings.forbidden")));
        }
        const card = await buildSettingsForChat(ctx, env.chatId, env.senderOpenId);
        return void (await deliverPrivately(ctx, {
          chatId: env.chatId,
          openId: env.senderOpenId,
          card,
          chatType: env.chatType,
        }));
      }

      case "lang":
      case "language":
      case "语言": {
        const arg = args.trim().toLowerCase();
        if (arg === "auto" || arg === "default") {
          await setUserLocale(ctx, env.senderOpenId, null);
          return void (await say(ctx, env, t("cmd.lang.auto")));
        }
        const l = normalizeLocale(arg);
        if (!l) {
          return void (await say(ctx, env, t("cmd.lang.usage", { current: currentLocale() })));
        }
        await setUserLocale(ctx, env.senderOpenId, l);
        // 用新语言回复确认
        return void (await withLocale(l, () => say(ctx, env, t("cmd.lang.done", { lang: t(`locale.${l}`) }))));
      }

      case "project-channel": {
        await requireConfigurer(ctx, env.chatId, env.senderOpenId);
        if (!args) return void (await say(ctx, env, t("cmd.projectChannel.usage")));
        const linear = await ctx.getLinear();
        const projects = await linearApi.getProjects(linear, 100);
        const p =
          projects.find((x) => x.name.toLowerCase() === args.toLowerCase()) ??
          projects.find((x) => x.name.toLowerCase().includes(args.toLowerCase()));
        if (!p) return void (await say(ctx, env, t("cmd.projectChannel.notFound", { name: args })));
        const row = await createProjectChannel(ctx, { projectId: p.id, autoCreated: false });
        return void (await say(ctx, env, t("cmd.projectChannel.done", { name: p.name, chatId: row?.feishuChatId })));
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
        return void (await say(ctx, env, t("cmd.unknown", { cmd, help: helpText() })));
    }
  } catch (err) {
    const msg =
      err instanceof NotBoundError || (err instanceof Error && err.name === "ForbiddenError")
        ? err.message
        : t("cmd.error", { message: err instanceof Error ? err.message : String(err) });
    if (!(err instanceof NotBoundError)) log.error({ err, cmd }, "Command failed");
    await say(ctx, env, msg).catch(() => {});
  }
}
