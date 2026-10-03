import { eq } from "drizzle-orm";
import type { AppContext } from "../../app/context.js";
import { schema } from "../../db/index.js";
import * as linearApi from "../../adapters/linear/api.js";
import * as feishu from "../../adapters/feishu/client.js";
import { buildIssueCard } from "../../cards/issue.js";
import { createSyncThread } from "../sync/threads.js";
import { autoBindFromFeishuUser } from "../users/mapping.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("issues");

export async function createIssueFromFeishu(
  ctx: AppContext,
  opts: {
    chatId: string;
    messageId?: string;
    operatorOpenId: string;
    title: string;
    description?: string;
    teamId?: string;
    priority?: number;
    sync?: boolean;
    senderName?: string;
  },
) {
  const linear = await ctx.getLinear();
  const teams = await linearApi.getTeams(linear);

  const [guidance] = await ctx.db
    .select()
    .from(schema.agentGuidance)
    .where(eq(schema.agentGuidance.feishuChatId, opts.chatId))
    .limit(1);

  const teamId =
    opts.teamId ||
    guidance?.defaultTeamId ||
    teams[0]?.id;

  if (!teamId) throw new Error("未找到可用的 Linear 团队");

  let assigneeId =
    (await autoBindFromFeishuUser(ctx, opts.operatorOpenId)) ?? undefined;

  const issue = await linearApi.createIssue(linear, {
    teamId,
    title: opts.title,
    description: opts.description,
    assigneeId,
    priority: opts.priority,
    projectId: guidance?.defaultProjectId ?? undefined,
    createAsUser: opts.senderName,
  });

  const state = await issue.state;
  const assignee = await issue.assignee;
  const team = await issue.team;

  const card = buildIssueCard({
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? undefined,
    status: state?.name ?? "Unknown",
    assignee: assignee?.name,
    priority: issue.priority,
    url: issue.url,
    teamName: team?.name ?? "Unknown",
    createdAt: issue.createdAt.toISOString().split("T")[0],
  });

  let replyMsgId: string | undefined;
  if (opts.messageId) {
    const res = await feishu.replyCard(ctx.lark, opts.messageId, card, true);
    replyMsgId = (res.data as Record<string, unknown>)?.message_id as string;
  } else {
    const res = await feishu.sendCard(ctx.lark, opts.chatId, card);
    replyMsgId = (res.data as Record<string, unknown>)?.message_id as string;
  }

  if (opts.sync && opts.messageId) {
    // 以话题形式回复创建 thread，再用该 thread 建立同步
    try {
      const threadRes = await feishu.replyText(
        ctx.lark,
        opts.messageId,
        `🔗 已建立与 ${issue.identifier} 的同步线程`,
        true,
      );
      const threadId = (threadRes.data as Record<string, unknown>)
        ?.thread_id as string | undefined;
      const rootMsgId =
        ((threadRes.data as Record<string, unknown>)?.root_id as string) ||
        opts.messageId;

      if (threadId) {
        await createSyncThread(ctx, {
          feishuChatId: opts.chatId,
          feishuThreadId: threadId,
          feishuRootMsgId: rootMsgId,
          linearIssueId: issue.id,
          linearIssueIdentifier: issue.identifier,
          linearIssueUrl: issue.url,
        });
      }
    } catch (err) {
      log.warn({ err }, "建立同步线程失败");
    }
  }

  return { issue, replyMsgId };
}

export async function assignIssueToFeishuUser(
  ctx: AppContext,
  issueIdentifier: string,
  operatorOpenId: string,
) {
  let linearUserId = await autoBindFromFeishuUser(ctx, operatorOpenId);
  if (!linearUserId) {
    return {
      success: false as const,
      message: "未绑定 Linear 账号。请私聊机器人发送：bind your@email.com",
    };
  }

  const linear = await ctx.getLinear();
  const issue = await linearApi.getIssueByIdentifier(linear, issueIdentifier);
  if (!issue) {
    return {
      success: false as const,
      message: `未找到 Issue ${issueIdentifier}`,
    };
  }

  await linearApi.updateIssue(linear, issue.id, { assigneeId: linearUserId });
  return {
    success: true as const,
    message: `已将 ${issueIdentifier} 分配给你`,
  };
}

type IssueLike = {
  identifier: string;
  title: string;
  description?: string | null;
  priority: number;
  url: string;
  createdAt: Date;
  state?: unknown;
  assignee?: unknown;
  team?: unknown;
};

export async function toIssueCardData(issue: IssueLike) {
  const state = (await Promise.resolve(issue.state)) as
    | { name?: string }
    | undefined
    | null;
  const assignee = (await Promise.resolve(issue.assignee)) as
    | { name?: string }
    | undefined
    | null;
  const team = (await Promise.resolve(issue.team)) as
    | { name?: string }
    | undefined
    | null;

  return {
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? undefined,
    status: state?.name ?? "Unknown",
    assignee: assignee?.name,
    priority: issue.priority,
    url: issue.url,
    teamName: team?.name ?? "Unknown",
    createdAt: issue.createdAt.toISOString().split("T")[0],
  };
}
