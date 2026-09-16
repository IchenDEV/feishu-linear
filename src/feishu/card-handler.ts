import type { Context } from "koa";
import "../types.js";
import type { LinearClient } from "@linear/sdk";
import type { Client as LarkClient } from "@larksuiteoapi/node-sdk";
import type { Db } from "../db/index.js";
import type { Env } from "../config.js";
import { eq } from "drizzle-orm";
import * as linearOps from "../linear/client.js";
import * as feishuOps from "../feishu/client.js";
import { schema } from "../db/index.js";
import {
  buildIssueCard,
  getStatusColor,
  getPriorityIcon,
} from "../cards/issue-card.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("card-handler");

export function createCardActionHandler(
  config: Env,
  db: Db,
  lark: LarkClient,
  linear: LinearClient,
) {
  return async (ctx: Context) => {
    const body = ctx.request.body as Record<string, unknown>;

    // URL 验证
    if (body.type === "url_verification") {
      ctx.body = { challenge: body.challenge };
      return;
    }

    const event = body.event as Record<string, unknown> | undefined;
    if (!event?.action) {
      ctx.body = {};
      return;
    }

    const actionObj = event.action as Record<string, unknown> | undefined;
    const actionValue = actionObj?.value;
    if (!actionValue) {
      ctx.body = {};
      return;
    }

    let action: Record<string, unknown>;
    try {
      action = typeof actionValue === "string" ? JSON.parse(actionValue) : actionValue;
    } catch {
      ctx.body = {};
      return;
    }

    const operator = event.operator as Record<string, unknown> | undefined;
    const operatorOpenId = operator?.open_id as string;

    try {
      switch (action.action) {
        case "assign_to_me":
        case "assign_to_me_from_preview": {
          const result = await handleAssignToMe(
            db,
            linear,
            operatorOpenId,
            action.issueId as string,
          );
          ctx.body = {
            toast: {
              type: result.success ? "success" : "error",
              content: result.message,
            },
          };
          return;
        }

        case "quick_create_issue": {
          await handleQuickCreateIssue(
            db,
            lark,
            linear,
            action.chatId as string,
            action.messageId as string,
            operatorOpenId,
          );
          ctx.body = {
            toast: { type: "success", content: "Issue 创建中..." },
          };
          return;
        }

        case "create_issue_with_sync": {
          await handleCreateIssueWithSync(
            db,
            lark,
            linear,
            action.chatId as string,
            action.messageId as string,
            operatorOpenId,
          );
          ctx.body = {
            toast: { type: "success", content: "Issue 创建中，同步线程将建立..." },
          };
          return;
        }

        case "add_comment": {
          ctx.body = {
            toast: {
              type: "info",
              content: "请在话题中直接回复，评论会自动同步到 Linear",
            },
          };
          return;
        }

        default:
          ctx.body = {};
      }
    } catch (err) {
      log.error({ err, action: action.action }, "卡片交互处理失败");
      ctx.body = {
        toast: { type: "error", content: "操作失败，请稍后重试" },
      };
    }
  };
}

async function handleAssignToMe(
  db: Db,
  linear: LinearClient,
  operatorOpenId: string,
  issueIdentifier: string,
): Promise<{ success: boolean; message: string }> {
  const userMapping = db
    .select()
    .from(schema.userMappings)
    .where(eq(schema.userMappings.feishuOpenId, operatorOpenId))
    .get();

  if (!userMapping) {
    return {
      success: false,
      message: "未绑定 Linear 账号，请先使用 /bind 命令绑定",
    };
  }

  const results = await linearOps.searchIssues(linear, issueIdentifier, { first: 1 });
  const issue = results.nodes[0];
  if (!issue) {
    return { success: false, message: `未找到 Issue ${issueIdentifier}` };
  }

  await linearOps.updateIssue(linear, issue.id, {
    assigneeId: userMapping.linearUserId,
  });

  return { success: true, message: `已将 ${issueIdentifier} 分配给你` };
}

async function handleQuickCreateIssue(
  db: Db,
  lark: LarkClient,
  linear: LinearClient,
  chatId: string,
  messageId: string,
  operatorOpenId: string,
) {
  const teams = await linearOps.getTeams(linear);
  if (teams.length === 0) {
    await feishuOps.sendTextMessage(lark, chatId, "❌ 未找到 Linear 团队");
    return;
  }

  const guidance = db
    .select()
    .from(schema.agentGuidance)
    .where(eq(schema.agentGuidance.feishuChatId, chatId))
    .get();

  const teamId = guidance?.defaultTeamId ?? teams[0].id;

  let assigneeId: string | undefined;
  const userMapping = db
    .select()
    .from(schema.userMappings)
    .where(eq(schema.userMappings.feishuOpenId, operatorOpenId))
    .get();
  if (userMapping) assigneeId = userMapping.linearUserId;

  let title = "来自飞书的 Issue";
  if (messageId) {
    try {
      const msgRes = await feishuOps.getMessage(lark, messageId);
      const body = (msgRes.data as Record<string, unknown>)?.body as Record<string, unknown>;
      const content = body?.content as string;
      if (content) {
        const parsed = JSON.parse(content);
        title = parsed.text?.slice(0, 100) ?? title;
      }
    } catch {}
  }

  const issue = await linearOps.createIssue(linear, {
    teamId,
    title,
    assigneeId,
  });

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

  await feishuOps.sendCardMessage(lark, chatId, card);
}

async function handleCreateIssueWithSync(
  db: Db,
  lark: LarkClient,
  linear: LinearClient,
  chatId: string,
  messageId: string,
  operatorOpenId: string,
) {
  await handleQuickCreateIssue(db, lark, linear, chatId, messageId, operatorOpenId);
}
