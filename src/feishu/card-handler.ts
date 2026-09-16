import type { Request, Response } from "express";
import type { LinearClient } from "@linear/sdk";
import type { Client as LarkClient } from "@larksuiteoapi/node-sdk";
import type { Db } from "../db/index.js";
import type { Env } from "../config.js";
import { eq } from "drizzle-orm";
import * as linearOps from "../linear/client.js";
import * as feishuOps from "../feishu/client.js";
import { schema } from "../db/index.js";
import { createSyncThread } from "../sync/thread-sync.js";
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
  return async (req: Request, res: Response) => {
    const body = req.body;

    // URL 验证
    if (body.type === "url_verification") {
      res.json({ challenge: body.challenge });
      return;
    }

    const event = body.event;
    if (!event?.action) {
      res.json({});
      return;
    }

    const actionValue = event.action?.value;
    if (!actionValue) {
      res.json({});
      return;
    }

    let action: Record<string, unknown>;
    try {
      action = typeof actionValue === "string" ? JSON.parse(actionValue) : actionValue;
    } catch {
      res.json({});
      return;
    }

    const operatorOpenId = event.operator?.open_id as string;

    try {
      switch (action.action) {
        case "assign_to_me":
        case "assign_to_me_from_preview": {
          const issueIdentifier = action.issueId as string;
          const result = await handleAssignToMe(
            db,
            linear,
            operatorOpenId,
            issueIdentifier,
          );
          res.json({
            toast: {
              type: result.success ? "success" : "error",
              content: result.message,
            },
          });
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
          res.json({
            toast: { type: "success", content: "Issue 创建中..." },
          });
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
          res.json({
            toast: { type: "success", content: "Issue 创建中，同步线程将建立..." },
          });
          return;
        }

        case "add_comment": {
          res.json({
            toast: {
              type: "info",
              content: "请在话题中直接回复，评论会自动同步到 Linear",
            },
          });
          return;
        }

        default:
          res.json({});
      }
    } catch (err) {
      log.error({ err, action: action.action }, "卡片交互处理失败");
      res.json({
        toast: { type: "error", content: "操作失败，请稍后重试" },
      });
    }
  };
}

async function handleAssignToMe(
  db: Db,
  linear: LinearClient,
  operatorOpenId: string,
  issueIdentifier: string,
): Promise<{ success: boolean; message: string }> {
  // 查找用户映射
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

  // 搜索 Issue
  const results = await linearOps.searchIssues(linear, issueIdentifier, {
    first: 1,
  });
  const issue = results.nodes[0];
  if (!issue) {
    return { success: false, message: `未找到 Issue ${issueIdentifier}` };
  }

  await linearOps.updateIssue(linear, issue.id, {
    assigneeId: userMapping.linearUserId,
  });

  return {
    success: true,
    message: `已将 ${issueIdentifier} 分配给你`,
  };
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

  // 使用第一个团队（或从 Agent Guidance 获取默认团队）
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

  // 获取源消息内容作为标题
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
  // 先创建 Issue
  await handleQuickCreateIssue(db, lark, linear, chatId, messageId, operatorOpenId);

  // TODO: 获取刚创建的 Issue ID，创建同步线程
  // 需要配合飞书话题 API 实现
}
