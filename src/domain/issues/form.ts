import type { AppContext } from "../../app/context.js";
import * as linearApi from "../../adapters/linear/api.js";
import * as feishu from "../../adapters/feishu/client.js";
import { buildCreateIssueForm, buildLinkIssueForm } from "../../cards/issue.js";
import { resolveChatDefaults } from "../settings/store.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("issue-form");

export interface FormInput {
  chatId: string;
  messageId?: string;
  threadId?: string;
  title?: string;
  description?: string;
  teamId?: string;
}

export async function buildCreateForm(ctx: AppContext, input: FormInput) {
  const linear = await ctx.getLinear();
  const [teams, defaults] = await Promise.all([
    linearApi.getTeams(linear),
    resolveChatDefaults(ctx, input.chatId),
  ]);
  const team =
    teams.find((t) => t.id === (input.teamId ?? defaults.teamId)) ?? teams[0];
  if (!team) throw new Error("工作区里没有可用的团队");
  const opts = await linearApi.getTeamFormOptions(linear, team.id);
  return buildCreateIssueForm({
    team: { id: team.id, name: team.name },
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    ...opts,
    defaults: {
      title: input.title,
      description: input.description,
      projectId: defaults.projectId,
      templateId: defaults.templateId,
    },
    chatId: input.chatId,
    messageId: input.messageId,
    threadId: input.threadId,
    allowSync: Boolean(input.messageId),
  });
}

export function buildLinkForm(input: FormInput) {
  return buildLinkIssueForm({
    chatId: input.chatId,
    messageId: input.messageId,
    threadId: input.threadId,
    allowSync: Boolean(input.messageId),
  });
}

/**
 * 把「仅自己可见」的卡片交给操作者：
 * 1. 普通群 → 临时卡片（ephemeral）
 * 2. 话题群 / 单聊 / 临时卡片失败 → 回退为机器人私聊卡片
 * 返回实际使用的投递方式。
 */
export async function deliverPrivately(
  ctx: AppContext,
  opts: {
    chatId: string;
    openId: string;
    card: Record<string, unknown>;
    chatType?: string;
  },
): Promise<"ephemeral" | "p2p" | "inline"> {
  if (opts.chatType === "p2p") {
    await feishu.sendCard(ctx.lark, opts.chatId, opts.card);
    return "inline";
  }
  try {
    await feishu.sendEphemeralCard(ctx.lark, {
      chatId: opts.chatId,
      openId: opts.openId,
      card: opts.card,
    });
    return "ephemeral";
  } catch (err) {
    log.debug({ err }, "临时卡片不可用，回退私聊");
    await feishu.sendP2PCard(ctx.lark, opts.openId, opts.card);
    return "p2p";
  }
}
