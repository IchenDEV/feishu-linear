import type { Context } from "koa";
import "../types.js";
import type { LinearClient } from "@linear/sdk";
import type { Client as LarkClient } from "@larksuiteoapi/node-sdk";
import type { Db } from "../db/index.js";
import type { Env } from "../config.js";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { isDuplicate } from "../utils/dedup.js";
import {
  extractTextFromFeishuContent,
  removeBotMention,
  detectIssueIdentifiers,
  parseLinearUrl,
} from "../utils/text.js";
import { handleAgentMessage } from "../agent/agent.js";
import { syncFeishuToLinear } from "../sync/thread-sync.js";
import * as linearOps from "../linear/client.js";
import * as feishuOps from "../feishu/client.js";
import {
  buildIssueCard,
  getStatusColor,
  getPriorityIcon,
  buildCreateIssueFormCard,
} from "../cards/issue-card.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("feishu-event");

// Issue ID 自动回复的冷却记录
const issueIdCooldown = new Map<string, number>();
const COOLDOWN_MS = 60 * 60 * 1000;

export function createFeishuEventHandler(
  config: Env,
  db: Db,
  lark: LarkClient,
  linear: LinearClient,
) {
  return async (ctx: Context) => {
    const body = ctx.request.body as Record<string, unknown>;

    // URL 验证（飞书初始配置时的 challenge 校验）
    if (body.type === "url_verification") {
      log.info("飞书 URL 验证");
      ctx.body = { challenge: body.challenge };
      return;
    }

    // Schema 2.0 事件
    if (body.schema === "2.0") {
      ctx.body = { code: 0 };

      const header = body.header as Record<string, unknown> | undefined;
      const event = body.event as Record<string, unknown> | undefined;
      if (!header || !event) return;

      if (isDuplicate(db, header.event_id as string, "feishu")) {
        log.debug({ eventId: header.event_id }, "重复事件，跳过");
        return;
      }

      // 异步处理，不阻塞响应
      setImmediate(async () => {
        try {
          switch (header.event_type) {
            case "im.message.receive_v1":
              await handleMessageReceived(config, db, lark, linear, event);
              break;
            case "application.bot.menu_v6":
              await handleBotMenu(config, db, lark, linear, event);
              break;
            default:
              log.debug({ type: header.event_type }, "未处理的事件类型");
          }
        } catch (err) {
          log.error({ err, eventType: header.event_type }, "事件处理失败");
        }
      });
      return;
    }

    // Legacy v1.0
    if (body.token) {
      ctx.body = { code: 0 };
      return;
    }

    ctx.status = 400;
    ctx.body = { error: "Unknown event format" };
  };
}

async function handleMessageReceived(
  config: Env,
  db: Db,
  lark: LarkClient,
  linear: LinearClient,
  event: Record<string, unknown>,
) {
  const message = event.message as Record<string, unknown>;
  if (!message) return;

  const chatId = message.chat_id as string;
  const msgType = message.msg_type as string;
  const messageId = message.message_id as string;
  const threadId = message.thread_id as string | undefined;
  const content = message.content as string;

  const sender = event.sender as Record<string, unknown>;
  const senderId = (sender?.sender_id as Record<string, unknown>)?.open_id as string;
  const senderType = sender?.sender_type as string;

  if (senderType === "app") return;

  const textContent = extractTextFromFeishuContent(content, msgType);

  // 1. 同步线程 → Linear
  if (threadId) {
    const syncThread = db
      .select()
      .from(schema.syncThreads)
      .where(eq(schema.syncThreads.feishuThreadId, threadId))
      .get();

    if (syncThread?.syncEnabled) {
      await syncFeishuToLinear(db, linear, {
        feishuThreadId: threadId,
        feishuMsgId: messageId,
        senderName: "飞书用户",
        content: textContent,
      });
      return;
    }
  }

  // 2. @机器人 → Agent
  const mentions = message.mentions as Array<Record<string, unknown>> | undefined;
  const isMentioned = mentions?.some(
    (m) => (m as Record<string, unknown>).id?.toString().startsWith("cli_"),
  );

  if (isMentioned) {
    const cleanText = removeBotMention(textContent);
    await handleAgentMessage(config, db, lark, linear, {
      chatId,
      messageId,
      threadId,
      senderOpenId: senderId,
      senderName: "飞书用户",
      messageText: cleanText,
    });
    return;
  }

  // 3. Issue ID 自动展开（ENG-482）
  if (msgType === "text") {
    const identifiers = detectIssueIdentifiers(textContent);
    for (const id of identifiers) {
      const cooldownKey = `${chatId}:${id}`;
      const lastTime = issueIdCooldown.get(cooldownKey);
      if (lastTime && Date.now() - lastTime < COOLDOWN_MS) continue;

      try {
        const results = await linearOps.searchIssues(linear, id, { first: 1 });
        const issue = results.nodes[0];
        if (!issue || issue.identifier !== id) continue;

        issueIdCooldown.set(cooldownKey, Date.now());

        const state = await issue.state;
        const assignee = await issue.assignee;
        const team = await issue.team;

        const card = buildIssueCard({
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description ?? undefined,
          status: state?.name ?? "Unknown",
          statusColor: getStatusColor(state?.name ?? ""),
          assignee: assignee?.name,
          priority: String(issue.priority),
          priorityIcon: getPriorityIcon(issue.priority),
          url: issue.url,
          teamName: team?.name ?? "Unknown",
          createdAt: issue.createdAt.toISOString().split("T")[0],
        });

        await feishuOps.replyWithCard(lark, messageId, card, true);
      } catch (err) {
        log.error({ err, id }, "Issue ID 自动展开失败");
      }
    }
  }

  // 4. Linear URL 展开
  const linearUrlRegex = /https?:\/\/linear\.app\/[^\s]+/g;
  const urls = textContent.match(linearUrlRegex);
  if (urls) {
    for (const url of urls) {
      const parsed = parseLinearUrl(url);
      if (parsed?.type === "issue" && parsed.identifier) {
        try {
          const results = await linearOps.searchIssues(linear, parsed.identifier, {
            first: 1,
          });
          const issue = results.nodes[0];
          if (!issue) continue;

          const state = await issue.state;
          const assignee = await issue.assignee;
          const team = await issue.team;

          const card = buildIssueCard({
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description ?? undefined,
            status: state?.name ?? "Unknown",
            statusColor: getStatusColor(state?.name ?? ""),
            assignee: assignee?.name,
            priority: String(issue.priority),
            priorityIcon: getPriorityIcon(issue.priority),
            url: issue.url,
            teamName: team?.name ?? "Unknown",
            createdAt: issue.createdAt.toISOString().split("T")[0],
          });

          await feishuOps.replyWithCard(lark, messageId, card, true);
        } catch (err) {
          log.error({ err, url }, "Linear URL 展开失败");
        }
      }
    }
  }
}

async function handleBotMenu(
  _config: Env,
  db: Db,
  lark: LarkClient,
  linear: LinearClient,
  event: Record<string, unknown>,
) {
  const eventKey = event.event_key as string;
  const chatId = (event.operator as Record<string, unknown>)?.operator_id as string;

  log.info({ eventKey }, "机器人菜单事件");

  if (eventKey === "create_issue") {
    try {
      const teams = await linearOps.getTeams(linear);
      const card = buildCreateIssueFormCard({
        teams: teams.map((t) => ({ id: t.id, name: t.name })),
        chatId,
        messageId: "",
      });
      await feishuOps.sendCardMessage(lark, chatId, card);
    } catch (err) {
      log.error({ err }, "发送创建表单失败");
    }
  }
}
