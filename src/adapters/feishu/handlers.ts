import type { AppContext } from "../../app/context.js";
import {
  extractTextFromFeishuContent,
  removeMentions,
  detectIssueIdentifiers,
  parseLinearUrl,
  isBotMentioned,
  type FeishuMention,
} from "../../utils/text.js";
import { isDuplicate } from "../../utils/dedup.js";
import { findByFeishuThread, syncFeishuMessageToLinear } from "../../domain/sync/threads.js";
import { handleAgentMessage } from "../../domain/agent/agent.js";
import {
  assignIssueToFeishuUser,
  createIssueFromFeishu,
  toIssueCardData,
} from "../../domain/issues/service.js";
import { bindByEmail } from "../../domain/users/mapping.js";
import * as linearApi from "../linear/api.js";
import * as feishu from "./client.js";
import { buildCreateIssueForm, buildIssueCard } from "../../cards/issue.js";
import {
  buildIssueLinkPreview,
  buildProjectLinkPreview,
} from "../../cards/link-preview.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("feishu-handlers");

const issueIdCooldown = new Map<string, number>();
const COOLDOWN_MS = 60 * 60 * 1000;

async function resolveFeishuUserName(
  ctx: AppContext,
  openId: string,
  fallback = "飞书用户",
): Promise<string> {
  try {
    const u = await feishu.getUser(ctx.lark, openId);
    const data = u.data as { user?: { name?: string } } | undefined;
    return data?.user?.name || fallback;
  } catch {
    return fallback;
  }
}

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
  return {
    async onMessageReceive(data: Record<string, unknown>) {
      // EventDispatcher 传入的是 event 体（或含 message 的结构）
      const message = (data.message ?? data) as Record<string, unknown>;
      const sender = (data.sender ?? {}) as Record<string, unknown>;

      if (!message?.message_id) {
        log.debug({ data }, "消息事件结构异常");
        return;
      }

      const senderType = sender.sender_type as string | undefined;
      if (senderType === "app" || senderType === "bot") return;

      const senderId = (sender.sender_id as Record<string, unknown>)
        ?.open_id as string;
      const messageId = message.message_id as string;
      const chatId = message.chat_id as string;
      const chatType = message.chat_type as string;
      // 事件字段是 message_type，不是 msg_type
      const messageType = (message.message_type ??
        message.msg_type) as string;
      const threadId = message.thread_id as string | undefined;
      const content = message.content as string;
      const text = extractTextFromFeishuContent(content, messageType);
      const mentions = normalizeMentions(
        message.mentions as Array<Record<string, unknown>> | undefined,
      );

      // 去重用 message_id（官方建议）
      if (isDuplicate(ctx.db, `feishu:msg:${messageId}`, "feishu")) return;

      // 1. 同步线程
      if (threadId) {
        const sync = findByFeishuThread(ctx, threadId);
        if (sync?.syncEnabled) {
          const senderName = await resolveFeishuUserName(ctx, senderId);

          await syncFeishuMessageToLinear(ctx, {
            feishuThreadId: threadId,
            feishuMsgId: messageId,
            senderName,
            content: text,
          });
          return;
        }
      }

      // 2. 私聊命令：bind / create / help
      if (chatType === "p2p") {
        await handleP2PCommand(ctx, {
          chatId,
          messageId,
          senderOpenId: senderId,
          text,
        });
        return;
      }

      // 3. @机器人 → Agent
      if (isBotMentioned(mentions)) {
        const senderName = await resolveFeishuUserName(ctx, senderId);

        await handleAgentMessage(ctx, {
          chatId,
          messageId,
          threadId,
          senderOpenId: senderId,
          senderName,
          messageText: removeMentions(text),
        });
        return;
      }

      // 4. Issue ID 自动展开
      if (messageType === "text") {
        await expandIssueIds(ctx, chatId, messageId, text);
      }

      // 5. Linear URL 展开（消息内粘贴，作为补充；正式预览走 url.preview.get）
      const urls = text.match(/https?:\/\/linear\.app\/[^\s]+/g);
      if (urls) {
        for (const url of urls.slice(0, 2)) {
          await expandLinearUrl(ctx, messageId, url);
        }
      }
    },

    async onCardAction(data: Record<string, unknown>) {
      const action = data.action as Record<string, unknown> | undefined;
      const operator = data.operator as Record<string, unknown> | undefined;
      const operatorOpenId = operator?.open_id as string;
      const valueRaw = action?.value;
      const formValue = (action?.form_value ?? {}) as Record<string, unknown>;

      let value: Record<string, unknown> = {};
      try {
        value =
          typeof valueRaw === "string"
            ? JSON.parse(valueRaw)
            : ((valueRaw as Record<string, unknown>) ?? {});
      } catch {
        value = {};
      }

      const actionName = value.action as string | undefined;

      try {
        switch (actionName) {
          case "assign_to_me": {
            const result = await assignIssueToFeishuUser(
              ctx,
              String(value.issueId),
              operatorOpenId,
            );
            return {
              toast: {
                type: result.success ? "success" : "error",
                content: result.message,
              },
            };
          }

          case "subscribe_issue": {
            const linear = await ctx.getLinear();
            const issue = await linearApi.getIssueByIdentifier(
              linear,
              String(value.issueId),
            );
            if (!issue) {
              return {
                toast: { type: "error", content: "未找到 Issue" },
              };
            }
            await linearApi.subscribeIssue(linear, issue.id);
            return {
              toast: { type: "success", content: `已订阅 ${issue.identifier}` },
            };
          }

          case "submit_create_issue": {
            const title = String(formValue.title ?? "").trim();
            if (!title) {
              return {
                toast: { type: "error", content: "请填写标题" },
              };
            }

            const senderName = await resolveFeishuUserName(ctx, operatorOpenId);

            await createIssueFromFeishu(ctx, {
              chatId: String(value.chatId),
              messageId: String(value.messageId || "") || undefined,
              operatorOpenId,
              title,
              description: formValue.description
                ? String(formValue.description)
                : undefined,
              teamId: formValue.teamId
                ? String(formValue.teamId)
                : undefined,
              priority: formValue.priority
                ? Number(formValue.priority)
                : undefined,
              sync: Boolean(value.sync),
              senderName,
            });

            return {
              toast: {
                type: "success",
                content: value.sync
                  ? "Issue 已创建，同步线程已建立"
                  : "Issue 已创建",
              },
            };
          }

          case "open_create_issue_form": {
            const linear = await ctx.getLinear();
            const teams = await linearApi.getTeams(linear);
            const chatId = String(value.chatId);
            const messageId = String(value.messageId || "");
            let defaultTitle = "";
            if (messageId) {
              try {
                const msg = await feishu.getMessage(ctx.lark, messageId);
                const body = (msg.data as Record<string, unknown>)
                  ?.body as Record<string, unknown>;
                const content = body?.content as string;
                if (content) {
                  const parsed = JSON.parse(content);
                  defaultTitle = String(parsed.text ?? "").slice(0, 200);
                }
              } catch {}
            }

            const card = buildCreateIssueForm({
              teams: teams.map((t) => ({ id: t.id, name: t.name })),
              defaultTitle,
              chatId,
              messageId,
              enableSync: true,
            });

            if (messageId) {
              await feishu.replyCard(ctx.lark, messageId, card);
            } else {
              await feishu.sendCard(ctx.lark, chatId, card);
            }

            return {
              toast: { type: "info", content: "请填写表单" },
            };
          }

          default:
            return {};
        }
      } catch (err) {
        log.error({ err, actionName }, "卡片交互失败");
        return {
          toast: { type: "error", content: "操作失败，请稍后重试" },
        };
      }
    },

    async onLinkPreview(data: Record<string, unknown>) {
      const context = data.context as Record<string, unknown> | undefined;
      const url = context?.url as string | undefined;
      if (!url) return {};

      const parsed = parseLinearUrl(url);
      if (!parsed) return {};

      try {
        const linear = await ctx.getLinear();

        if (parsed.type === "issue" && parsed.identifier) {
          const issue = await linearApi.getIssueByIdentifier(
            linear,
            parsed.identifier,
          );
          if (!issue) return {};
          const cardData = await toIssueCardData(issue);
          return buildIssueLinkPreview(cardData);
        }

        if (parsed.type === "project" && parsed.id) {
          const project = await linearApi.getProject(linear, parsed.id);
          return buildProjectLinkPreview({
            name: project.name,
            description: project.description ?? undefined,
            status: String(project.state ?? ""),
            targetDate: project.targetDate ?? undefined,
            url: project.url,
          });
        }
      } catch (err) {
        log.error({ err, url }, "链接预览失败");
      }

      return {
        inline: {
          i18n_title: {
            zh_cn: `Linear: ${url}`,
            en_us: `Linear: ${url}`,
          },
        },
      };
    },

    async onBotMenu(data: Record<string, unknown>) {
      const eventKey = data.event_key as string;
      const operator = data.operator as Record<string, unknown> | undefined;
      const openId =
        (operator?.operator_id as string) ||
        ((operator?.operator_id as Record<string, unknown>)?.open_id as string);

      if (eventKey === "create_issue" && openId) {
        const linear = await ctx.getLinear();
        const teams = await linearApi.getTeams(linear);
        // 菜单事件里通常只有 operator，发到私聊
        await feishu.sendP2PCard(
          ctx.lark,
          openId,
          buildCreateIssueForm({
            teams: teams.map((t) => ({ id: t.id, name: t.name })),
            chatId: openId,
            enableSync: false,
          }),
        );
      }
    },
  };
}

async function handleP2PCommand(
  ctx: AppContext,
  opts: {
    chatId: string;
    messageId: string;
    senderOpenId: string;
    text: string;
  },
) {
  const trimmed = opts.text.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "help" || lower === "帮助") {
    await feishu.replyText(
      ctx.lark,
      opts.messageId,
      [
        "Linear 连接器命令：",
        "• bind email@company.com — 绑定 Linear 账号",
        "• create — 打开创建 Issue 表单",
        "• 在群里 @我 用自然语言操作 Linear",
      ].join("\n"),
    );
    return;
  }

  if (lower.startsWith("bind ")) {
    const email = trimmed.slice(5).trim();
    try {
      const bound = await bindByEmail(ctx, {
        feishuOpenId: opts.senderOpenId,
        linearEmail: email,
      });
      await feishu.replyText(
        ctx.lark,
        opts.messageId,
        `✅ 已绑定 Linear 用户：${bound.linearName} (${bound.linearEmail})`,
      );
    } catch (err) {
      await feishu.replyText(
        ctx.lark,
        opts.messageId,
        `❌ 绑定失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  if (lower === "create" || lower === "新建") {
    const linear = await ctx.getLinear();
    const teams = await linearApi.getTeams(linear);
    await feishu.replyCard(
      ctx.lark,
      opts.messageId,
      buildCreateIssueForm({
        teams: teams.map((t) => ({ id: t.id, name: t.name })),
        chatId: opts.chatId,
        messageId: opts.messageId,
        enableSync: false,
      }),
    );
    return;
  }

  // 默认走 Agent
  await handleAgentMessage(ctx, {
    chatId: opts.chatId,
    messageId: opts.messageId,
    senderOpenId: opts.senderOpenId,
    senderName: "飞书用户",
    messageText: trimmed,
  });
}

async function expandIssueIds(
  ctx: AppContext,
  chatId: string,
  messageId: string,
  text: string,
) {
  const ids = detectIssueIdentifiers(text);
  for (const id of ids.slice(0, 3)) {
    const key = `${chatId}:${id}`;
    const last = issueIdCooldown.get(key);
    if (last && Date.now() - last < COOLDOWN_MS) continue;

    try {
      const linear = await ctx.getLinear();
      const issue = await linearApi.getIssueByIdentifier(linear, id);
      if (!issue) continue;
      issueIdCooldown.set(key, Date.now());
      const cardData = await toIssueCardData(issue);
      await feishu.replyCard(
        ctx.lark,
        messageId,
        buildIssueCard(cardData),
        true,
      );
    } catch (err) {
      log.error({ err, id }, "Issue ID 展开失败");
    }
  }
}

async function expandLinearUrl(
  ctx: AppContext,
  messageId: string,
  url: string,
) {
  const parsed = parseLinearUrl(url);
  if (parsed?.type !== "issue" || !parsed.identifier) return;
  try {
    const linear = await ctx.getLinear();
    const issue = await linearApi.getIssueByIdentifier(
      linear,
      parsed.identifier,
    );
    if (!issue) return;
    const cardData = await toIssueCardData(issue);
    await feishu.replyCard(ctx.lark, messageId, buildIssueCard(cardData), true);
  } catch (err) {
    log.error({ err, url }, "URL 展开失败");
  }
}
