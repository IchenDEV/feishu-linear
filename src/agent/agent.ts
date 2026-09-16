import OpenAI from "openai";
import type { LinearClient } from "@linear/sdk";
import type { Client as LarkClient } from "@larksuiteoapi/node-sdk";
import type { Db } from "../db/index.js";
import type { Env } from "../config.js";
import * as linearOps from "../linear/client.js";
import * as feishuOps from "../feishu/client.js";
import { buildIssueCard, getStatusColor, getPriorityIcon } from "../cards/issue-card.js";
import { createSyncThread } from "../sync/thread-sync.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("agent");

interface AgentContext {
  chatId: string;
  messageId: string;
  threadId?: string;
  senderOpenId: string;
  senderName: string;
  chatName?: string;
  messageText: string;
}

const SYSTEM_PROMPT = `你是 Linear 助手，运行在飞书群聊中。你可以帮用户直接操作 Linear（项目管理工具）。

你可以执行以下操作：
1. 创建 Issue（Bug、Feature Request、Task 等）
2. 查询 Issue 信息
3. 修改 Issue（状态、负责人、优先级等）
4. 查询团队和项目信息
5. 搜索 Issue
6. 从整个对话线程提炼需求、创建 Issue
7. 总结讨论内容
8. 查询谁通常负责某类工作

回复时使用简洁的中文，保持专业但友好的语气。
当用户要求创建 Issue 时，从上下文推断合适的团队和项目。

如果有 Agent Guidance（管理员配置的引导规则），严格遵循其中的指示。`;

// 定义工具列表
function getTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: "function",
      function: {
        name: "create_issue",
        description: "在 Linear 中创建一个新的 Issue",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Issue 标题" },
            description: { type: "string", description: "Issue 描述" },
            teamName: { type: "string", description: "团队名称（会自动匹配）" },
            priority: { type: "number", description: "优先级 1-4（1最高）", enum: [1, 2, 3, 4] },
            assignToSelf: { type: "boolean", description: "是否分配给发起者" },
          },
          required: ["title"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_issues",
        description: "搜索 Linear Issue",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_issue",
        description: "获取指定 Issue 的详细信息",
        parameters: {
          type: "object",
          properties: {
            identifier: { type: "string", description: "Issue 标识符，如 ENG-482" },
          },
          required: ["identifier"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_issue",
        description: "更新 Issue 的属性",
        parameters: {
          type: "object",
          properties: {
            identifier: { type: "string", description: "Issue 标识符" },
            status: { type: "string", description: "新状态名称" },
            assigneeEmail: { type: "string", description: "新负责人邮箱" },
            priority: { type: "number", description: "新优先级 1-4" },
          },
          required: ["identifier"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_teams",
        description: "列出所有团队",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "list_projects",
        description: "列出所有项目",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "query_workspace",
        description: "查询工作区信息，如谁通常做什么工作",
        parameters: {
          type: "object",
          properties: {
            question: { type: "string", description: "要查询的问题" },
          },
          required: ["question"],
        },
      },
    },
  ];
}

export async function handleAgentMessage(
  config: Env,
  db: Db,
  lark: LarkClient,
  linear: LinearClient,
  context: AgentContext,
) {
  if (!config.OPENAI_API_KEY) {
    await feishuOps.replyMessage(
      lark,
      context.messageId,
      JSON.stringify({ text: "⚠️ AI Agent 未配置，请设置 OPENAI_API_KEY" }),
    );
    return;
  }

  const openai = new OpenAI({
    apiKey: config.OPENAI_API_KEY,
    baseURL: config.OPENAI_BASE_URL,
  });

  // 获取 Agent Guidance
  const guidance = db
    .select()
    .from((await import("../db/schema.js")).agentGuidance)
    .where(
      (await import("drizzle-orm")).eq(
        (await import("../db/schema.js")).agentGuidance.feishuChatId,
        context.chatId,
      ),
    )
    .get();

  const systemPrompt = guidance
    ? `${SYSTEM_PROMPT}\n\n## Agent Guidance（管理员配置）\n${guidance.guidance}`
    : SYSTEM_PROMPT;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `[群聊: ${context.chatName ?? "未知"}] [发送者: ${context.senderName}]\n\n${context.messageText}`,
    },
  ];

  try {
    let response = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages,
      tools: getTools(),
      tool_choice: "auto",
    });

    // 工具调用循环
    let iterations = 0;
    while (response.choices[0]?.finish_reason === "tool_calls" && iterations < 5) {
      iterations++;
      const toolCalls = response.choices[0].message.tool_calls;
      if (!toolCalls) break;

      messages.push(response.choices[0].message);

      for (const call of toolCalls) {
        const args = JSON.parse(call.function.arguments);
        let result: string;

        try {
          result = await executeToolCall(
            db,
            lark,
            linear,
            context,
            call.function.name,
            args,
          );
        } catch (err) {
          result = `错误: ${err instanceof Error ? err.message : String(err)}`;
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }

      response = await openai.chat.completions.create({
        model: config.OPENAI_MODEL,
        messages,
        tools: getTools(),
        tool_choice: "auto",
      });
    }

    const reply = response.choices[0]?.message?.content;
    if (reply) {
      await feishuOps.replyMessage(
        lark,
        context.messageId,
        JSON.stringify({ text: reply }),
        "text",
        !!context.threadId,
      );
    }
  } catch (err) {
    log.error({ err }, "Agent 处理失败");
    await feishuOps.replyMessage(
      lark,
      context.messageId,
      JSON.stringify({ text: "❌ 处理消息时出错，请稍后重试" }),
    );
  }
}

async function executeToolCall(
  db: Db,
  lark: LarkClient,
  linear: LinearClient,
  context: AgentContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (toolName) {
    case "create_issue": {
      const teams = await linearOps.getTeams(linear);
      let teamId = teams[0]?.id;

      if (args.teamName) {
        const match = teams.find((t) =>
          t.name.toLowerCase().includes((args.teamName as string).toLowerCase()),
        );
        if (match) teamId = match.id;
      }

      if (!teamId) return "未找到匹配的团队";

      let assigneeId: string | undefined;
      if (args.assignToSelf) {
        const { eq } = await import("drizzle-orm");
        const { userMappings } = await import("../db/schema.js");
        const mapping = db
          .select()
          .from(userMappings)
          .where(eq(userMappings.feishuOpenId, context.senderOpenId))
          .get();
        if (mapping) assigneeId = mapping.linearUserId;
      }

      const issue = await linearOps.createIssue(linear, {
        teamId,
        title: args.title as string,
        description: args.description as string | undefined,
        assigneeId,
        priority: args.priority as number | undefined,
      });

      const team = await issue.team;
      const state = await issue.state;
      const assignee = await issue.assignee;

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

      await feishuOps.replyWithCard(lark, context.messageId, card, !!context.threadId);

      return JSON.stringify({
        success: true,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
      });
    }

    case "search_issues": {
      const results = await linearOps.searchIssues(linear, args.query as string);
      const issues = results.nodes.slice(0, 5);
      if (issues.length === 0) return "未找到匹配的 Issue";

      const items = await Promise.all(
        issues.map(async (issue) => {
          const state = await issue.state;
          const assignee = await issue.assignee;
          return `• ${issue.identifier} | ${issue.title} | ${state?.name ?? "-"} | ${assignee?.name ?? "未分配"}`;
        }),
      );
      return items.join("\n");
    }

    case "get_issue": {
      const issues = await linearOps.searchIssues(
        linear,
        args.identifier as string,
        { first: 1 },
      );
      const issue = issues.nodes[0];
      if (!issue) return `未找到 Issue: ${args.identifier}`;

      const state = await issue.state;
      const assignee = await issue.assignee;
      const team = await issue.team;
      return JSON.stringify({
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description?.slice(0, 500),
        status: state?.name,
        assignee: assignee?.name,
        priority: issue.priority,
        team: team?.name,
        url: issue.url,
      });
    }

    case "update_issue": {
      const issues = await linearOps.searchIssues(
        linear,
        args.identifier as string,
        { first: 1 },
      );
      const issue = issues.nodes[0];
      if (!issue) return `未找到 Issue: ${args.identifier}`;

      const updateInput: Record<string, unknown> = {};

      if (args.status) {
        const team = await issue.team;
        if (team) {
          const states = await linearOps.getWorkflowStates(linear, team.id);
          const match = states.find((s) =>
            s.name.toLowerCase().includes((args.status as string).toLowerCase()),
          );
          if (match) updateInput.stateId = match.id;
        }
      }

      if (args.priority) updateInput.priority = args.priority;

      if (args.assigneeEmail) {
        const users = await linearOps.getUsers(linear);
        const match = users.find((u) => u.email === args.assigneeEmail);
        if (match) updateInput.assigneeId = match.id;
      }

      await linearOps.updateIssue(linear, issue.id, updateInput);
      return `已更新 ${issue.identifier}`;
    }

    case "list_teams": {
      const teams = await linearOps.getTeams(linear);
      return teams.map((t) => `• ${t.name} (${t.key})`).join("\n");
    }

    case "list_projects": {
      const projects = await linearOps.getProjects(linear);
      return projects
        .slice(0, 10)
        .map((p) => `• ${p.name} | ${p.state}`)
        .join("\n");
    }

    case "query_workspace": {
      const users = await linearOps.getUsers(linear);
      const teams = await linearOps.getTeams(linear);
      return JSON.stringify({
        question: args.question,
        teams: teams.map((t) => ({ name: t.name, key: t.key })),
        members: users.slice(0, 20).map((u) => ({
          name: u.name,
          email: u.email,
          active: u.active,
        })),
      });
    }

    default:
      return `未知工具: ${toolName}`;
  }
}
