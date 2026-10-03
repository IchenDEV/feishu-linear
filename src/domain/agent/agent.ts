import OpenAI from "openai";
import type { AppContext } from "../../app/context.js";
import { eq } from "drizzle-orm";
import { schema } from "../../db/index.js";
import * as linearApi from "../../adapters/linear/api.js";
import * as feishu from "../../adapters/feishu/client.js";
import { buildIssueCard } from "../../cards/issue.js";
import { autoBindFromFeishuUser } from "../users/mapping.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("agent");

const SYSTEM_PROMPT = `你是 Linear 助手，运行在飞书群聊中。你可以帮用户直接操作 Linear。
可用能力：创建/查询/更新 Issue、列出团队与项目、搜索工作区信息。
回复使用简洁中文。若有 Agent Guidance，严格遵循。`;

function tools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: "function",
      function: {
        name: "create_issue",
        description: "创建 Linear Issue",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            teamName: { type: "string" },
            priority: { type: "number", enum: [1, 2, 3, 4] },
            assignToSelf: { type: "boolean" },
          },
          required: ["title"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_issues",
        description: "搜索 Issue",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_teams",
        description: "列出团队",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "list_projects",
        description: "列出项目",
        parameters: { type: "object", properties: {} },
      },
    },
  ];
}

export async function handleAgentMessage(
  ctx: AppContext,
  input: {
    chatId: string;
    messageId: string;
    threadId?: string;
    senderOpenId: string;
    senderName: string;
    messageText: string;
  },
) {
  if (!ctx.config.OPENAI_API_KEY) {
    await feishu.replyText(
      ctx.lark,
      input.messageId,
      "⚠️ AI Agent 未配置 OPENAI_API_KEY",
    );
    return;
  }

  const openai = new OpenAI({
    apiKey: ctx.config.OPENAI_API_KEY,
    baseURL: ctx.config.OPENAI_BASE_URL,
  });

  const guidance = ctx.db
    .select()
    .from(schema.agentGuidance)
    .where(eq(schema.agentGuidance.feishuChatId, input.chatId))
    .get();

  const system = guidance
    ? `${SYSTEM_PROMPT}\n\n## Agent Guidance\n${guidance.guidance}`
    : SYSTEM_PROMPT;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    {
      role: "user",
      content: `[发送者: ${input.senderName}]\n\n${input.messageText}`,
    },
  ];

  try {
    let response = await openai.chat.completions.create({
      model: ctx.config.OPENAI_MODEL,
      messages,
      tools: tools(),
      tool_choice: "auto",
    });

    let iterations = 0;
    while (
      response.choices[0]?.finish_reason === "tool_calls" &&
      iterations < 5
    ) {
      iterations++;
      const toolCalls = response.choices[0].message.tool_calls;
      if (!toolCalls) break;
      messages.push(response.choices[0].message);

      for (const call of toolCalls) {
        const args = JSON.parse(call.function.arguments);
        let result: string;
        try {
          result = await runTool(ctx, input, call.function.name, args);
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
        model: ctx.config.OPENAI_MODEL,
        messages,
        tools: tools(),
        tool_choice: "auto",
      });
    }

    const reply = response.choices[0]?.message?.content;
    if (reply) {
      await feishu.replyText(
        ctx.lark,
        input.messageId,
        reply,
        !!input.threadId,
      );
    }
  } catch (err) {
    log.error({ err }, "Agent 处理失败");
    await feishu.replyText(ctx.lark, input.messageId, "❌ 处理失败，请稍后重试");
  }
}

async function runTool(
  ctx: AppContext,
  input: {
    chatId: string;
    messageId: string;
    threadId?: string;
    senderOpenId: string;
    senderName: string;
  },
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const linear = await ctx.getLinear();

  switch (name) {
    case "create_issue": {
      const teams = await linearApi.getTeams(linear);
      let teamId = teams[0]?.id;
      if (args.teamName) {
        const match = teams.find((t) =>
          t.name.toLowerCase().includes(String(args.teamName).toLowerCase()),
        );
        if (match) teamId = match.id;
      }
      if (!teamId) return "未找到团队";

      let assigneeId: string | undefined;
      if (args.assignToSelf) {
        assigneeId =
          (await autoBindFromFeishuUser(ctx, input.senderOpenId)) ?? undefined;
      }

      const issue = await linearApi.createIssue(linear, {
        teamId,
        title: String(args.title),
        description: args.description as string | undefined,
        assigneeId,
        priority: args.priority as number | undefined,
        createAsUser: input.senderName,
      });

      const state = await issue.state;
      const assignee = await issue.assignee;
      const team = await issue.team;

      await feishu.replyCard(
        ctx.lark,
        input.messageId,
        buildIssueCard({
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description ?? undefined,
          status: state?.name ?? "Unknown",
          assignee: assignee?.name,
          priority: issue.priority,
          url: issue.url,
          teamName: team?.name ?? "Unknown",
          createdAt: issue.createdAt.toISOString().split("T")[0],
        }),
        !!input.threadId,
      );

      return JSON.stringify({
        identifier: issue.identifier,
        url: issue.url,
      });
    }

    case "search_issues": {
      const results = await linearApi.searchIssues(
        linear,
        String(args.query),
        5,
      );
      if (!results.nodes.length) return "未找到匹配 Issue";
      const lines = await Promise.all(
        results.nodes.map(async (issue) => {
          const state = await issue.state;
          return `• ${issue.identifier} | ${issue.title} | ${state?.name ?? "-"}`;
        }),
      );
      return lines.join("\n");
    }

    case "list_teams": {
      const teams = await linearApi.getTeams(linear);
      return teams.map((t) => `• ${t.name} (${t.key})`).join("\n");
    }

    case "list_projects": {
      const projects = await linearApi.getProjects(linear);
      return projects
        .slice(0, 10)
        .map((p) => `• ${p.name}`)
        .join("\n");
    }

    default:
      return `未知工具: ${name}`;
  }
}
